package ca.lumen.brightspace

/*
 * Native, read-only Brightspace (Valence) API client.
 * Auth is the session cookie Android's CookieManager holds after you sign in on the
 * official Brightspace page (the only WebView in the app). Native HTTP isn't bound by
 * the browser's CORS rules, so this works where a website can't. Read-only throughout.
 */

import android.webkit.CookieManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class BrightspaceApi(
    host: String,
    private val cookieProvider: (String) -> String? = { CookieManager.getInstance().getCookie(it) },
) {
    private val host = host.trimEnd('/')
    // Concurrent: several screens (e.g. the Grades overview) fetch in parallel on IO threads.
    private val versions = java.util.concurrent.ConcurrentHashMap<String, String>()
    private val cache = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, Any>>()

    fun clearCache() = cache.clear()

    // MARK: core GET
    private suspend fun getJson(path: String, useCache: Boolean = true): Any = withContext(Dispatchers.IO) {
        if (useCache) cache[path]?.let { if (System.currentTimeMillis() - it.first < 300_000) return@withContext it.second }
        val url = URL(host + path)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            cookieProvider(host)?.let { setRequestProperty("Cookie", it) }
            connectTimeout = 15000; readTimeout = 20000
        }
        val status = conn.responseCode
        val type = conn.contentType ?: ""
        if (status == 401 || status == 403) throw ApiException(ApiException.Kind.SIGNED_OUT)
        if (status in 300..399 || type.contains("text/html")) throw ApiException(ApiException.Kind.SIGNED_OUT) // login redirect
        if (status !in 200..299) throw ApiException(ApiException.Kind.HTTP, status)
        val text = conn.inputStream.bufferedReader().use { it.readText() }
        val parsed: Any = if (text.trimStart().startsWith("[")) JSONArray(text) else JSONObject(text)
        if (useCache) cache[path] = Pair(System.currentTimeMillis(), parsed)
        parsed
    }

    private suspend fun version(product: String): String {
        versions[product]?.let { return it }
        runCatching {
            val list = getJson("/d2l/api/versions/") as JSONArray
            for (i in 0 until list.length()) {
                val v = list.getJSONObject(i)
                versions[v.getString("ProductCode")] = v.getString("LatestVersion")
            }
        }
        return versions[product] ?: if (product == "lp") "1.35" else "1.60"
    }
    private suspend fun lp(p: String) = "/d2l/api/lp/${version("lp")}$p"
    private suspend fun le(p: String) = "/d2l/api/le/${version("le")}$p"

    // MARK: endpoints
    suspend fun whoami(): Me {
        val d = getJson(lp("/users/whoami")) as JSONObject
        return Me(d.s("FirstName"), d.s("LastName"), d.s("UniqueName"))
    }

    suspend fun courses(): List<Course> {
        var path: String? = lp("/enrollments/myenrollments/?orgUnitTypeId=3&sortBy=-StartDate")
        val items = ArrayList<JSONObject>()
        var guard = 0
        while (path != null && guard < 15) {
            guard++
            val page = getJson(path) as JSONObject
            page.optJSONArray("Items")?.let { for (i in 0 until it.length()) items.add(it.getJSONObject(i)) }
            val pi = page.optJSONObject("PagingInfo")
            path = if (pi != null && pi.optBoolean("HasMoreItems") && pi.s("Bookmark").isNotEmpty())
                lp("/enrollments/myenrollments/?orgUnitTypeId=3&sortBy=-StartDate&bookmark=" + URLEncoder.encode(pi.getString("Bookmark"), "UTF-8"))
            else null
        }
        return items.mapNotNull { e ->
            val ou = e.optJSONObject("OrgUnit") ?: return@mapNotNull null
            val access = e.optJSONObject("Access")
            if (access?.has("CanAccess") == true && !access.optBoolean("CanAccess", true)) return@mapNotNull null
            Course(
                id = ou.optInt("Id"),
                name = ou.s("Name", "Course"),
                code = ou.s("Code", ""),
                start = Dates.parse(access?.s("StartDate")),
                end = Dates.parse(access?.s("EndDate")),
                pinned = e.optJSONObject("PinSettings")?.optBoolean("IsPinned") ?: false,
                hasImage = ou.has("ImageUrl") && !ou.isNull("ImageUrl"),
            )
        }
    }

    suspend fun news(ou: Int): List<Announcement> {
        val list = getJson(le("/$ou/news/")) as JSONArray
        val out = ArrayList<Announcement>()
        for (i in 0 until list.length()) {
            val n = list.getJSONObject(i)
            if (n.optBoolean("IsHidden")) continue
            val atts = ArrayList<Attachment>()
            n.optJSONArray("Attachments")?.let {
                for (j in 0 until it.length()) {
                    val a = it.getJSONObject(j)
                    atts.add(Attachment(a.s("FileName", "file"), "$host/d2l/le/news/$ou/${n.optInt("Id")}/attachment/${a.opt("FileId")}"))
                }
            }
            out.add(Announcement(n.optInt("Id"), n.s("Title"), Rich.html(n.opt("Body")),
                Dates.parse(n.s("StartDate")) ?: Dates.parse(n.s("CreatedDate")), atts))
        }
        return out.sortedByDescending { it.date?.time ?: 0 }
    }

    suspend fun toc(ou: Int): List<Module> {
        val data = getJson(le("/$ou/content/toc")) as JSONObject
        fun mapModule(m: JSONObject): Module {
            val subs = ArrayList<Module>()
            m.optJSONArray("Modules")?.let { for (i in 0 until it.length()) { val s = it.getJSONObject(i); if (!s.optBoolean("IsHidden")) subs.add(mapModule(s)) } }
            val tops = ArrayList<Topic>()
            m.optJSONArray("Topics")?.let {
                for (i in 0 until it.length()) {
                    val t = it.getJSONObject(i); if (t.optBoolean("IsHidden")) continue
                    tops.add(Topic(t.optInt("TopicId"), t.s("Title"),
                        Kind.ofTopic(t.s("Url"), t.s("TypeIdentifier")),
                        "$host/d2l/le/content/$ou/viewContent/${t.optInt("TopicId")}/View",
                        t.optBoolean("Unread"), Dates.parse(t.s("DueDateTime")), t.optBoolean("IsLocked")))
                }
            }
            return Module(m.optInt("ModuleId"), m.s("Title"), Rich.html(m.opt("Description")), subs, tops)
        }
        val mods = ArrayList<Module>()
        data.optJSONArray("Modules")?.let { for (i in 0 until it.length()) { val m = it.getJSONObject(i); if (!m.optBoolean("IsHidden")) mods.add(mapModule(m)) } }
        return mods
    }

    suspend fun grades(ou: Int): Grades {
        val values = runCatching { getJson(le("/$ou/grades/values/myGradeValues/")) as JSONArray }.getOrNull()
        val final = runCatching { getJson(le("/$ou/grades/final/values/myGradeValue")) as JSONObject }.getOrNull()
        val items = ArrayList<GradeItem>()
        if (values != null) for (i in 0 until values.length()) {
            val g = values.getJSONObject(i)
            items.add(GradeItem(
                g.s("GradeObjectIdentifier", i.toString()), g.s("GradeObjectName"),
                g.s("DisplayedGrade").ifEmpty { null },
                Nums.d(g.opt("PointsNumerator")), Nums.d(g.opt("PointsDenominator")),
                Nums.d(g.opt("WeightedDenominator")), Nums.d(g.opt("WeightedNumerator")), Rich.text(g.opt("Comments"))))
        }
        var fp: Double? = null
        val fn = Nums.d(final?.opt("PointsNumerator")); val fd = Nums.d(final?.opt("PointsDenominator"))
        if (fn != null && fd != null && fd > 0) fp = fn / fd * 100
        return Grades(items, final?.s("DisplayedGrade")?.ifEmpty { null }, fp)
    }

    suspend fun workItems(courseIds: List<Int>): List<WorkItem> {
        if (courseIds.isEmpty()) return emptyList()
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val start = iso.format(Date(System.currentTimeMillis() - 45L * 86400_000))
        val end = iso.format(Date(System.currentTimeMillis() + 120L * 86400_000))
        val csv = courseIds.joinToString(",")
        val path = le("/content/myItems/?orgUnitIdsCSV=$csv&startDateTime=$start&endDateTime=$end")
        runCatching {
            val objs = getJson(path) as JSONObject
            val list = objs.optJSONArray("Objects") ?: JSONArray()
            val out = ArrayList<WorkItem>()
            for (i in 0 until list.length()) {
                val it = list.getJSONObject(i)
                val kind = Kind.ofScheduled(it.s("ItemUrl"))
                val oid = it.optInt("OrgUnitId")
                val completed = (it.has("DateCompleted") && !it.isNull("DateCompleted")) || it.optBoolean("IsExempt")
                out.add(WorkItem("s:$oid:${it.optInt("ItemId")}:${kind.name}", oid, kind, it.s("ItemName"),
                    Dates.parse(it.s("DueDate")) ?: Dates.parse(it.s("EndDate")),
                    it.s("ItemUrl").ifEmpty { null }?.let { u -> host + u }, completed))
            }
            return out
        }
        // Fallback: assignments + quizzes per course.
        val out = ArrayList<WorkItem>()
        for (ou in courseIds) {
            runCatching {
                val folders = getJson(le("/$ou/dropbox/folders/")) as JSONArray
                for (i in 0 until folders.length()) {
                    val f = folders.getJSONObject(i); if (f.optBoolean("IsHidden")) continue
                    out.add(WorkItem("a:$ou:${f.optInt("Id")}", ou, WorkKind.ASSIGNMENT, f.s("Name"),
                        Dates.parse(f.s("DueDate")) ?: Dates.parse(f.optJSONObject("Availability")?.s("EndDate")),
                        "$host/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${f.optInt("Id")}&ou=$ou", false))
                }
            }
            runCatching {
                val q = getJson(le("/$ou/quizzes/")) as JSONObject
                val objs = q.optJSONArray("Objects") ?: JSONArray()
                for (i in 0 until objs.length()) {
                    val quiz = objs.getJSONObject(i)
                    out.add(WorkItem("q:$ou:${quiz.optInt("QuizId")}", ou, WorkKind.QUIZ, quiz.s("Name"),
                        Dates.parse(quiz.s("DueDate")) ?: Dates.parse(quiz.s("EndDate")),
                        "$host/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${quiz.optInt("QuizId")}&ou=$ou", false))
                }
            }
        }
        return out
    }
}

// MARK: decoding helpers

/**
 * Null-safe string read. Android's org.json returns the literal text "null" from optString()
 * for a JSON null (the reference implementation returns the default), which would leak
 * "null" into titles, codes and URLs. This returns the default for missing AND null values.
 */
internal fun JSONObject.s(key: String, default: String = ""): String = if (isNull(key)) default else optString(key, default)

object Dates {
    private val formats = listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX")
    fun parse(s: String?): Date? {
        if (s.isNullOrEmpty()) return null
        for (f in formats) runCatching {
            val sdf = SimpleDateFormat(f, Locale.US)
            if (f.endsWith("'Z'")) sdf.timeZone = TimeZone.getTimeZone("UTC")
            return sdf.parse(s)
        }
        return null
    }
}
object Nums {
    fun d(any: Any?): Double? = when (any) {
        is Double -> any; is Int -> any.toDouble(); is Number -> any.toDouble()
        is String -> any.toDoubleOrNull(); else -> null
    }
}
object Rich {
    fun html(any: Any?): String {
        val o = any as? JSONObject ?: return ""
        return o.s("Html").ifEmpty { o.s("Text") }
    }
    fun text(any: Any?): String? {
        val o = any as? JSONObject ?: return null
        val s = o.s("Text").ifEmpty { o.s("Html") }
        return if (s.isEmpty()) null else s.replace(Regex("<[^>]+>"), "")
    }
}
object Kind {
    fun ofTopic(url: String, typeId: String): WorkKind {
        val u = url.lowercase()
        return when {
            u.contains("quiz") -> WorkKind.QUIZ
            u.contains("dropbox") -> WorkKind.ASSIGNMENT
            u.contains("discussion") -> WorkKind.DISCUSSION
            Regex("\\.pdf($|\\?)").containsMatchIn(u) -> WorkKind.PDF
            Regex("\\.(pptx?|key)($|\\?)").containsMatchIn(u) -> WorkKind.SLIDES
            Regex("\\.(xlsx?|csv)($|\\?)").containsMatchIn(u) -> WorkKind.SHEET
            Regex("\\.(png|jpe?g|gif|svg|webp)($|\\?)").containsMatchIn(u) -> WorkKind.IMAGE
            Regex("\\.(mp4|mov|webm|m4v)($|\\?)|youtube|youtu\\.be|vimeo|kaltura|mediaspace").containsMatchIn(u) -> WorkKind.VIDEO
            u.contains("zoom.us") || u.contains("teams.microsoft") -> WorkKind.MEETING
            typeId.lowercase() == "link" || u.startsWith("http") -> WorkKind.LINK
            else -> WorkKind.DOC
        }
    }
    fun ofScheduled(url: String): WorkKind {
        val u = url.lowercase()
        return when {
            u.contains("dropbox") || u.contains("assignment") -> WorkKind.ASSIGNMENT
            u.contains("quiz") -> WorkKind.QUIZ
            u.contains("discussion") -> WorkKind.DISCUSSION
            u.contains("survey") -> WorkKind.SURVEY
            else -> WorkKind.CONTENT
        }
    }
}

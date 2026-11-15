package ca.lumen.brightspace

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateMapOf
import kotlinx.coroutines.launch
import org.json.JSONObject

data class School(val id: String, val name: String, val host: String, val hue: Double) {
    companion object {
        val catalog = listOf(
            School("carleton", "Carleton University", "https://brightspace.carleton.ca", 25.0),
            School("uwaterloo", "University of Waterloo", "https://learn.uwaterloo.ca", 85.0),
        )
    }
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("lumen", Context.MODE_PRIVATE)

    var host by mutableStateOf<String?>(prefs.getString("host", null))
        private set
    var schoolName by mutableStateOf(prefs.getString("schoolName", "") ?: "")
        private set
    var me by mutableStateOf<Me?>(null)
    var courses by mutableStateOf<List<Course>>(emptyList())
    var work by mutableStateOf<List<WorkItem>>(emptyList())
    var loading by mutableStateOf(false)
    var loadError by mutableStateOf<String?>(null)
    var themeMode by mutableStateOf(prefs.getString("themeMode", "system") ?: "system")

    private val doneOverrides = mutableStateMapOf<String, Boolean>().apply {
        prefs.getString("done", null)?.let { runCatching { val o = JSONObject(it); o.keys().forEach { k -> put(k, o.getBoolean(k)) } } }
    }
    private val hidden = mutableStateMapOf<Int, Boolean>().apply {
        prefs.getString("hidden", "")?.split(",")?.mapNotNull { it.toIntOrNull() }?.forEach { put(it, true) }
    }

    var api: BrightspaceApi? = host?.let { BrightspaceApi(it) }
        private set

    val connected get() = host != null

    fun connect(host: String, schoolName: String) {
        this.host = host; this.schoolName = schoolName
        prefs.edit().putString("host", host).putString("schoolName", schoolName).apply()
        api = BrightspaceApi(host)
        load()
    }
    fun signOut() {
        host = null; api = null; me = null; courses = emptyList(); work = emptyList(); loadError = null
        prefs.edit().remove("host").remove("schoolName").apply()
    }
    fun setTheme(mode: String) { themeMode = mode; prefs.edit().putString("themeMode", mode).apply() }

    fun load(force: Boolean = false) {
        val api = api ?: return
        viewModelScope.launch {
            loading = true; loadError = null
            if (force) api.clearCache()
            try {
                me = runCatching { api.whoami() }.getOrNull()
                courses = withDistinctHues(api.courses())
                val ids = currentCourses().map { it.id }
                work = dedupe(runCatching { api.workItems(ids) }.getOrElse { emptyList() })
            } catch (e: ApiException) {
                loadError = if (e.isSignedOut) "signed_out" else (e.message ?: "Couldn’t load")
            } catch (e: Exception) {
                loadError = e.message ?: "Couldn’t load"
            }
            loading = false
        }
    }

    /** Stable by course id, so a class keeps its color across launches. */
    private fun withDistinctHues(cs: List<Course>): List<Course> {
        val palette = listOf(265.0, 150.0, 30.0, 230.0, 340.0, 85.0, 195.0, 300.0, 10.0, 120.0, 250.0, 60.0)
        val order = cs.sortedBy { it.id }.map { it.id }
        return cs.map { it.copy(hueOverride = palette[order.indexOf(it.id) % palette.size]) }
    }

    private fun dedupe(items: List<WorkItem>): List<WorkItem> {
        val seen = HashSet<String>(); val out = ArrayList<WorkItem>()
        for (w in items) { val k = "${w.courseId}:${w.kind}:${w.title}:${w.due?.time ?: 0}"; if (seen.add(k)) out.add(w) }
        return out
    }

    fun visibleCourses() = courses.filter { hidden[it.id] != true }
    fun currentCourses() = visibleCourses().filter { it.isCurrent }
    fun course(id: Int) = courses.firstOrNull { it.id == id }
    fun workFor(id: Int) = work.filter { it.courseId == id }

    fun status(item: WorkItem) = item.status(doneOverrides[item.id])
    fun toggleDone(item: WorkItem) {
        val now = status(item) != WorkStatus.DONE
        if (now == item.completed) doneOverrides.remove(item.id) else doneOverrides[item.id] = now
        val o = JSONObject(); doneOverrides.forEach { (k, v) -> o.put(k, v) }
        prefs.edit().putString("done", o.toString()).apply()
    }

    fun isHidden(id: Int) = hidden[id] == true
    fun setHidden(id: Int, value: Boolean) {
        if (value) hidden[id] = true else hidden.remove(id)
        prefs.edit().putString("hidden", hidden.keys.joinToString(",")).apply()
    }
}

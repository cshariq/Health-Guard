package ca.lumen.brightspace

// Plain Kotlin models for the Brightspace data Lumen shows.

import java.util.Date

enum class WorkKind(val label: String) {
    ASSIGNMENT("Assignment"), QUIZ("Quiz"), DISCUSSION("Discussion"), SURVEY("Survey"),
    CONTENT("Material"), PDF("PDF"), SLIDES("Slides"), SHEET("Spreadsheet"),
    IMAGE("Image"), VIDEO("Video"), MEETING("Meeting"), LINK("Link"), DOC("Document");
}

enum class WorkStatus { ASSIGNED, MISSING, DONE }

data class Me(val firstName: String, val lastName: String, val uniqueName: String)

data class Course(
    val id: Int,
    val name: String,
    val code: String,
    val start: Date?,
    val end: Date?,
    val pinned: Boolean,
    val hasImage: Boolean,
) {
    val hue: Double get() = Palette.hue(if (code.isNotEmpty()) code else name)

    val termLabel: String
        get() {
            val d = start ?: return Regex("(?i)(fall|winter|summer|spring)\\s*(20\\d\\d)")
                .find("$name $code")?.let { "${it.groupValues[1].replaceFirstChar { c -> c.uppercase() }} ${it.groupValues[2]}" } ?: "Other"
            val c = java.util.Calendar.getInstance().apply { time = d }
            val y = c.get(java.util.Calendar.YEAR); val mo = c.get(java.util.Calendar.MONTH) + 1
            return when { mo >= 9 -> "Fall $y"; mo >= 5 -> "Summer $y"; else -> "Winter $y" }
        }
    val termSort: Int
        get() {
            val d = start ?: return 0
            val c = java.util.Calendar.getInstance().apply { time = d }
            val y = c.get(java.util.Calendar.YEAR); val mo = c.get(java.util.Calendar.MONTH) + 1
            return y * 10 + if (mo >= 9) 3 else if (mo >= 5) 2 else 1
        }
    val isCurrent: Boolean
        get() {
            val now = System.currentTimeMillis()
            start?.let { if (it.time > now + 21L * 86400_000) return false }
            end?.let { if (it.time < now - 7L * 86400_000) return false }
            return true
        }
}

data class WorkItem(
    val id: String,
    val courseId: Int,
    val kind: WorkKind,
    val title: String,
    val due: Date?,
    val url: String?,
    val completed: Boolean,
) {
    fun status(doneOverride: Boolean?): WorkStatus {
        if (doneOverride ?: completed) return WorkStatus.DONE
        val d = due
        if (d != null && d.before(Date())) return WorkStatus.MISSING
        return WorkStatus.ASSIGNED
    }
}

data class Attachment(val name: String, val url: String)
data class Announcement(val id: Int, val title: String, val html: String, val date: Date?, val attachments: List<Attachment>)

data class Topic(val id: Int, val title: String, val kind: WorkKind, val url: String, val unread: Boolean, val due: Date?, val locked: Boolean)
data class Module(val id: Int, val title: String, val descriptionHtml: String, val submodules: List<Module>, val topics: List<Topic>) {
    val totalCount: Int get() = topics.size + submodules.sumOf { it.totalCount }
    val unreadCount: Int get() = topics.count { it.unread } + submodules.sumOf { it.unreadCount }
}

data class GradeItem(
    val id: String, val name: String, val displayed: String?,
    val numerator: Double?, val denominator: Double?, val weight: Double?, val weightedAchieved: Double?, val comment: String?,
) {
    val percent: Double? get() = if (numerator != null && denominator != null && denominator > 0) numerator / denominator * 100 else null
}

data class Grades(val items: List<GradeItem>, val finalDisplay: String?, val finalPercent: Double?) {
    /** Weighted current grade when every released item has a weight, else a plain average. */
    val current: Pair<Double, Boolean>?
        get() {
            val graded = items.filter { it.percent != null }
            if (graded.isEmpty()) return null
            val weighted = graded.filter { (it.weight ?: 0.0) > 0 && it.weightedAchieved != null }
            if (weighted.size == graded.size) {
                val total = weighted.sumOf { it.weight ?: 0.0 }
                val got = weighted.sumOf { it.weightedAchieved ?: 0.0 }
                return if (total > 0) Pair(got / total * 100, true) else null
            }
            return Pair(graded.sumOf { it.percent ?: 0.0 } / graded.size, false)
        }
}

class ApiException(val kind: Kind, val code: Int = 0, message: String = "") : Exception(message) {
    enum class Kind { SIGNED_OUT, HTTP, NETWORK, BAD_URL }
    val isSignedOut get() = kind == Kind.SIGNED_OUT
}

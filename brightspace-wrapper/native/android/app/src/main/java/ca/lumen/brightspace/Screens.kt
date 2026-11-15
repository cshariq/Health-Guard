package ca.lumen.brightspace

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

// ---------------- formatting ----------------
object Format {
    private fun cal(d: Date) = Calendar.getInstance().apply { time = d; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
    fun daysFromToday(d: Date): Int {
        val a = cal(Date()).timeInMillis; val b = cal(d).timeInMillis
        return Math.round((b - a) / 86400000.0).toInt()
    }
    fun time(d: Date): String = SimpleDateFormat("h:mm a", Locale.getDefault()).format(d)
    fun day(d: Date): String = SimpleDateFormat("EEE, MMM d", Locale.getDefault()).format(d)
    fun short(d: Date): String = SimpleDateFormat("MMM d", Locale.getDefault()).format(d)
    fun due(d: Date?, prefix: String = "Due"): String {
        if (d == null) return "No due date"
        val n = daysFromToday(d)
        return when {
            n == 0 -> "$prefix today, ${time(d)}"
            n == 1 -> "$prefix tomorrow, ${time(d)}"
            n == -1 -> "$prefix yesterday, ${time(d)}"
            n in 2..6 -> "$prefix ${SimpleDateFormat("EEEE", Locale.getDefault()).format(d)}, ${time(d)}"
            else -> "$prefix ${day(d)}"
        }
    }
    fun plainHtml(html: String): String = html
        .replace(Regex("(?i)<br\\s*/?>"), "\n")
        .replace(Regex("(?i)</p>|</li>|</div>|</h[1-6]>"), "\n")
        .replace(Regex("(?i)<li[^>]*>"), "• ")
        .replace(Regex("<[^>]+>"), "")
        .replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&#39;", "'").replace("&quot;", "\"")
        .replace(Regex("\n{3,}"), "\n\n").trim()
}

fun kindIcon(k: WorkKind): ImageVector = when (k) {
    WorkKind.ASSIGNMENT -> Icons.AutoMirrored.Filled.Assignment
    WorkKind.QUIZ -> Icons.Default.Quiz
    WorkKind.DISCUSSION -> Icons.Default.Forum
    WorkKind.SURVEY -> Icons.Default.Checklist
    WorkKind.PDF -> Icons.Default.PictureAsPdf
    WorkKind.SLIDES -> Icons.Default.Slideshow
    WorkKind.SHEET -> Icons.Default.TableChart
    WorkKind.IMAGE -> Icons.Default.Image
    WorkKind.VIDEO -> Icons.Default.PlayCircle
    WorkKind.MEETING -> Icons.Default.Videocam
    WorkKind.LINK -> Icons.Default.Link
    else -> Icons.Default.Description
}

@Composable fun dark() = isDarkTheme()

// ---------------- Classes ----------------
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClassesScreen(vm: AppViewModel, openCourse: (Int) -> Unit) {
    var filter by remember { mutableStateOf("current") }
    val upcoming = vm.work.filter { vm.status(it) == WorkStatus.ASSIGNED && it.due?.let { d -> Format.daysFromToday(d) <= 7 } == true }
        .sortedBy { it.due?.time ?: Long.MAX_VALUE }

    Scaffold(topBar = {
        TopAppBar(title = { Text("Lumen") }, actions = {
            IconButton(onClick = { vm.load(true) }) { Icon(Icons.Default.Refresh, "Refresh") }
        })
    }) { pad ->
        if (vm.loadError != null && vm.courses.isEmpty()) {
            LoadError(vm.loadError!!, Modifier.padding(pad)) { vm.load(true) }
        } else LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                val h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
                val part = if (h < 5) "Up late" else if (h < 12) "Good morning" else if (h < 18) "Good afternoon" else "Good evening"
                val name = vm.me?.firstName?.takeIf { it.isNotEmpty() }
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Palette.container(Palette.SEED, dark())).padding(20.dp)) {
                    Text(if (name != null) "$part, $name" else part, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text(if (upcoming.isEmpty()) "Nothing due this week. Nice." else "${upcoming.size} thing${if (upcoming.size == 1) "" else "s"} due in the next 7 days",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (upcoming.isNotEmpty()) item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Due soon", style = MaterialTheme.typography.titleMedium)
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(upcoming.take(10)) { w ->
                            val c = vm.course(w.courseId); val hue = c?.hue ?: Palette.SEED
                            Column(Modifier.width(220.dp).height(118.dp).clip(RoundedCornerShape(16.dp))
                                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)).padding(14.dp)) {
                                val n = w.due?.let { Format.daysFromToday(it) } ?: 0
                                Text((if (n == 0) "Today" else if (n == 1) "Tomorrow" else w.due?.let { Format.day(it) } ?: ""),
                                    style = MaterialTheme.typography.labelMedium, color = Palette.accent(hue, dark()), fontWeight = FontWeight.SemiBold)
                                Text(w.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Spacer(Modifier.weight(1f))
                                Text(c?.code ?: "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
            item {
                Text("Your classes", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                val terms = vm.visibleCourses().map { it.termLabel }.distinct()
                    .sortedByDescending { lbl -> vm.visibleCourses().filter { it.termLabel == lbl }.maxOf { it.termSort } }
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(filter == "current", { filter = "current" }, { Text("Current") })
                    terms.forEach { t -> FilterChip(filter == t, { filter = t }, { Text(t) }) }
                    FilterChip(filter == "all", { filter = "all" }, { Text("All") })
                }
            }
            val shown = vm.visibleCourses()
                .filter { if (filter == "current") it.isCurrent else if (filter == "all") true else it.termLabel == filter }
                .sortedWith(compareBy({ !it.pinned }, { it.name }))
            if (shown.isEmpty() && !vm.loading) item { EmptyState(Icons.Default.School, "No classes here") }
            items(shown) { c -> CourseCard(vm, c) { openCourse(c.id) } }
        }
    }
}

@Composable
fun CourseCard(vm: AppViewModel, c: Course, onClick: () -> Unit) {
    val due = vm.workFor(c.id).filter { vm.status(it) == WorkStatus.ASSIGNED && it.due?.let { d -> Format.daysFromToday(d) <= 14 } == true }
        .sortedBy { it.due?.time ?: Long.MAX_VALUE }
    val missing = vm.workFor(c.id).count { vm.status(it) == WorkStatus.MISSING }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick)
        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(16.dp))) {
        Box(Modifier.fillMaxWidth().height(96.dp).background(Palette.banner(c.hue, dark()))) {
            Column(Modifier.align(Alignment.TopStart).padding(14.dp)) {
                Text(c.name, style = MaterialTheme.typography.titleMedium, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(listOf(c.code, c.termLabel).filter { it.isNotEmpty() }.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.9f))
            }
        }
        Column(Modifier.padding(14.dp)) {
            if (due.isEmpty()) Text("No work due soon", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else due.take(3).forEach { w ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(w.due?.let { if (Format.daysFromToday(it) <= 0) "Today" else Format.short(it) } ?: "", style = MaterialTheme.typography.labelMedium, color = Palette.accent(c.hue, dark()), modifier = Modifier.width(52.dp))
                    Text(w.title, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (missing > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Error, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp)); Text("$missing missing", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

// ---------------- shared ----------------
@Composable
fun WorkRow(vm: AppViewModel, w: WorkItem, showCourse: Boolean = true) {
    val ctx = LocalContext.current
    val status = vm.status(w)
    val c = vm.course(w.courseId); val hue = c?.hue ?: Palette.SEED
    Row(Modifier.fillMaxWidth()
        .clickable(enabled = w.url != null) { w.url?.let { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) } }
        .padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(if (status == WorkStatus.DONE) MaterialTheme.colorScheme.surfaceVariant else Palette.accent(hue, dark())), contentAlignment = Alignment.Center) {
            Icon(kindIcon(w.kind), null, tint = if (status == WorkStatus.DONE) MaterialTheme.colorScheme.onSurfaceVariant else Color.White, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(w.title, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = if (status == WorkStatus.DONE) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
            Text((if (showCourse && c != null) "${c.code.ifEmpty { c.name }} · " else "") + w.kind.label,
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        Text(when (status) { WorkStatus.MISSING -> Format.due(w.due, "Was due"); WorkStatus.DONE -> "Done"; else -> Format.due(w.due) },
            style = MaterialTheme.typography.labelMedium,
            color = if (status == WorkStatus.MISSING) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        IconButton(onClick = { vm.toggleDone(w) }) {
            Icon(if (status == WorkStatus.DONE) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked, "Toggle done",
                tint = if (status == WorkStatus.DONE) Color(0xFF2E7D32) else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun GradeRing(percent: Double?, size: Int = 108, color: Color) {
    Box(Modifier.size(size.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = Stroke(width = 10.dp.toPx(), cap = StrokeCap.Round)
            drawArc(color.copy(alpha = 0.18f), 0f, 360f, false, style = Stroke(width = 10.dp.toPx()))
            drawArc(color, -90f, (((percent ?: 0.0).coerceIn(0.0, 100.0) / 100.0) * 360).toFloat(), false, style = stroke)
        }
        Text(if (percent == null) "—" else "${Math.round(percent)}%", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, subtitle: String? = null, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, null, Modifier.size(44.dp), tint = MaterialTheme.colorScheme.primary)
        Text(title, style = MaterialTheme.typography.titleMedium)
        if (subtitle != null) Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun LoadError(error: String, modifier: Modifier = Modifier, retry: () -> Unit) {
    val signedOut = error == "signed_out"
    Column(modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(if (signedOut) Icons.Default.Lock else Icons.Default.WifiOff, null, Modifier.size(44.dp), tint = MaterialTheme.colorScheme.primary)
        Text(if (signedOut) "Signed out of Brightspace" else "Couldn’t load", style = MaterialTheme.typography.titleMedium)
        Text(if (signedOut) "Open Settings to sign in again." else error, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = retry) { Text("Try again") }
    }
}

@Composable fun GroupHeader(title: String, count: Int? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        if (count != null) Text("$count", style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 7.dp, vertical = 1.dp))
    }
}

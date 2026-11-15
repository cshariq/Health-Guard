package ca.lumen.brightspace

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.util.Calendar
import java.util.Date

// ---------------- Course ----------------
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CourseScreen(vm: AppViewModel, courseId: Int, onBack: () -> Unit) {
    val c = vm.course(courseId)
    var tab by remember { mutableStateOf(0) }
    Scaffold(topBar = {
        TopAppBar(title = { Text(c?.code ?: "Class") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") } })
    }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (c != null) {
                Box(Modifier.fillMaxWidth().height(140.dp).background(Palette.banner(c.hue, dark()))) {
                    Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
                        Text(c.name, style = MaterialTheme.typography.headlineSmall, color = Color.White, fontWeight = FontWeight.Bold)
                        Text(listOf(c.code, c.termLabel).filter { it.isNotEmpty() }.joinToString(" · "), color = Color.White.copy(alpha = 0.9f))
                    }
                }
                TabRow(selectedTabIndex = tab) {
                    listOf("Stream", "Classwork", "Work", "Grades").forEachIndexed { i, t ->
                        Tab(tab == i, { tab = i }, text = { Text(t) })
                    }
                }
                when (tab) {
                    1 -> ClassworkTab(vm, courseId)
                    2 -> WorkTab(vm, courseId)
                    3 -> GradesTab(vm, courseId)
                    else -> StreamTab(vm, courseId)
                }
            } else EmptyState(Icons.Default.School, "Class not found")
        }
    }
}

@Composable
fun StreamTab(vm: AppViewModel, courseId: Int) {
    var news by remember { mutableStateOf<List<Announcement>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(courseId) { try { news = vm.api?.news(courseId) ?: emptyList() } catch (e: ApiException) { error = if (e.isSignedOut) "signed_out" else e.message } catch (e: Exception) { error = e.message } }
    when {
        error != null -> LoadError(error!!) {}
        news == null -> LoadingBox()
        news!!.isEmpty() -> EmptyState(Icons.Default.Campaign, "No announcements yet")
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(news!!) { n ->
                val ctx = LocalContext.current
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) { Icon(Icons.Default.Campaign, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
                        Column {
                            Text(n.title, fontWeight = FontWeight.SemiBold)
                            n.date?.let { Text("${Format.day(it)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                    Text(Format.plainHtml(n.html), style = MaterialTheme.typography.bodyMedium, maxLines = 12, overflow = TextOverflow.Ellipsis)
                    n.attachments.forEach { a ->
                        AssistChip(onClick = { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(a.url))) },
                            label = { Text(a.name) }, leadingIcon = { Icon(Icons.Default.AttachFile, null, Modifier.size(18.dp)) })
                    }
                }
            }
        }
    }
}

@Composable
fun ClassworkTab(vm: AppViewModel, courseId: Int) {
    var modules by remember { mutableStateOf<List<Module>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    LaunchedEffect(courseId) { try { modules = vm.api?.toc(courseId) ?: emptyList() } catch (e: ApiException) { error = if (e.isSignedOut) "signed_out" else e.message } catch (e: Exception) { error = e.message } }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(query, { query = it }, singleLine = true, leadingIcon = { Icon(Icons.Default.Search, null) },
            placeholder = { Text("Search this class’s content") }, modifier = Modifier.fillMaxWidth().padding(16.dp))
        when {
            error != null -> LoadError(error!!) {}
            modules == null -> LoadingBox()
            modules!!.isEmpty() -> EmptyState(Icons.Default.Book, "No content yet")
            else -> LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(modules!!) { m -> ModuleCard(m, 0, query) }
            }
        }
    }
}

@Composable
fun ModuleCard(m: Module, depth: Int, query: String) {
    fun matches(t: Topic) = query.isEmpty() || t.title.contains(query, true)
    val visibleTopics = m.topics.filter(::matches)
    val hasMatch = query.isEmpty() || m.title.contains(query, true) || visibleTopics.isNotEmpty() ||
        m.submodules.any { sm -> sm.topics.any(::matches) }
    if (!hasMatch) return
    var expanded by remember(query) { mutableStateOf(query.isNotEmpty()) }
    Column(Modifier.fillMaxWidth().then(if (depth == 0) Modifier.clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)) else Modifier).padding(horizontal = if (depth == 0) 14.dp else 0.dp)) {
        Row(Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(if (depth == 0) Icons.Default.Folder else Icons.Default.FolderOpen, null, tint = MaterialTheme.colorScheme.primary)
            Text(m.title, Modifier.weight(1f), fontWeight = if (depth == 0) FontWeight.SemiBold else FontWeight.Medium)
            if (m.unreadCount > 0) Text("${m.unreadCount} new", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            Text("${m.totalCount}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
        }
        AnimatedVisibility(expanded) {
            Column(Modifier.padding(start = if (depth == 0) 8.dp else 16.dp)) {
                visibleTopics.forEach { TopicRow(it) }
                m.submodules.forEach { ModuleCard(it, depth + 1, query) }
            }
        }
    }
}

@Composable
fun TopicRow(t: Topic) {
    val ctx = LocalContext.current
    Row(Modifier.fillMaxWidth().clickable { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(t.url))) }.padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(kindIcon(t.kind), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
        Column(Modifier.weight(1f)) {
            Text(t.title, fontWeight = if (t.unread) FontWeight.SemiBold else FontWeight.Normal)
            Text(t.kind.label + (t.due?.let { " · ${Format.due(it)}" } ?: ""), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (t.locked) Icon(Icons.Default.Lock, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun WorkTab(vm: AppViewModel, courseId: Int) {
    val items = vm.workFor(courseId)
    if (items.isEmpty()) { EmptyState(Icons.Default.Assignment, "No assignments or quizzes"); return }
    val groups = items.groupBy { vm.status(it) }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        listOf(WorkStatus.MISSING to "Missing", WorkStatus.ASSIGNED to "Upcoming", WorkStatus.DONE to "Done").forEach { (st, title) ->
            val list = groups[st]?.sortedBy { if (st == WorkStatus.MISSING) -(it.due?.time ?: 0) else (it.due?.time ?: Long.MAX_VALUE) }
            if (!list.isNullOrEmpty()) {
                item { GroupHeader(title, list.size) }
                item { Column(Modifier.clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))) { list.forEach { WorkRow(vm, it, showCourse = false); HorizontalDivider() } } }
            }
        }
    }
}

@Composable
fun GradesTab(vm: AppViewModel, courseId: Int) {
    var grades by remember { mutableStateOf<Grades?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(courseId) { try { grades = vm.api?.grades(courseId) } catch (e: ApiException) { error = if (e.isSignedOut) "signed_out" else e.message } catch (e: Exception) { error = e.message } }
    val hue = vm.course(courseId)?.hue ?: Palette.SEED
    when {
        error != null -> LoadError(error!!) {}
        grades == null -> LoadingBox()
        grades!!.items.isEmpty() && grades!!.finalDisplay == null -> EmptyState(Icons.Default.Grading, "No grades released yet")
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Palette.container(hue, dark())).padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    GradeRing(grades!!.finalPercent ?: grades!!.current?.first, color = Palette.accent(hue, dark()))
                    Column {
                        Text(if (grades!!.finalDisplay != null) "Final grade" else if (grades!!.current?.second == true) "Current weighted grade" else "Average of released grades", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(grades!!.finalDisplay ?: grades!!.current?.let { String.format("%.1f%%", it.first) } ?: "—", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Text("${grades!!.items.count { it.percent != null }} of ${grades!!.items.size} graded", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            items(grades!!.items) { g ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(g.name, fontWeight = FontWeight.Medium)
                            g.weight?.let { if (it > 0) Text("Worth ${it.toInt()}%", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                        Text(g.numerator?.let { n -> g.denominator?.let { d -> "${trim(n)}/${trim(d)}" } } ?: g.displayed ?: "—", fontWeight = FontWeight.SemiBold)
                    }
                    g.percent?.let { LinearProgressIndicator(progress = { (it / 100).toFloat().coerceIn(0f, 1f) }, color = Palette.accent(hue, dark()), modifier = Modifier.fillMaxWidth()) }
                    g.comment?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
}
private fun trim(v: Double) = if (v == Math.floor(v)) v.toInt().toString() else String.format("%.1f", v)

@Composable fun LoadingBox() { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }

// ---------------- To-do ----------------
@Composable
fun ToDoScreen(vm: AppViewModel) {
    var tab by remember { mutableStateOf(WorkStatus.ASSIGNED) }
    val items = vm.work.filter { vm.status(it) == tab }
    Column(Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = when (tab) { WorkStatus.ASSIGNED -> 0; WorkStatus.MISSING -> 1; else -> 2 }) {
            Tab(tab == WorkStatus.ASSIGNED, { tab = WorkStatus.ASSIGNED }, text = { Text("Assigned") })
            Tab(tab == WorkStatus.MISSING, { tab = WorkStatus.MISSING }, text = { Text("Missing") })
            Tab(tab == WorkStatus.DONE, { tab = WorkStatus.DONE }, text = { Text("Done") })
        }
        if (items.isEmpty()) EmptyState(if (tab == WorkStatus.MISSING) Icons.Default.Verified else Icons.Default.Checklist,
            if (tab == WorkStatus.MISSING) "Nothing missing" else if (tab == WorkStatus.DONE) "Nothing done yet" else "No work assigned")
        else {
            val sorted = items.sortedBy { it.due?.time ?: Long.MAX_VALUE }.let { if (tab == WorkStatus.ASSIGNED) it else it.reversed() }
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                items(sorted) { WorkRow(vm, it) }
            }
        }
    }
}

// ---------------- Calendar ----------------
@Composable
fun CalendarScreen(vm: AppViewModel) {
    var weekOffset by remember { mutableStateOf(0) }
    val cal = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0); add(Calendar.DAY_OF_YEAR, weekOffset * 7); add(Calendar.DAY_OF_YEAR, -(get(Calendar.DAY_OF_WEEK) - 1)) }
    val days = (0..6).map { (cal.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, it) }.time }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = { weekOffset = 0 }) { Text("Today") }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { weekOffset-- }) { Icon(Icons.Default.ChevronLeft, "Previous") }
            Text("${Format.short(days[0])} – ${Format.short(days[6])}", style = MaterialTheme.typography.titleSmall)
            IconButton(onClick = { weekOffset++ }) { Icon(Icons.Default.ChevronRight, "Next") }
        }
        LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp)) {
            items(days) { day -> DayRow(vm, day) }
        }
    }
}

@Composable
fun DayRow(vm: AppViewModel, day: Date) {
    val cal = Calendar.getInstance()
    fun sameDay(a: Date, b: Date): Boolean { val x = Calendar.getInstance().apply { time = a }; val y = Calendar.getInstance().apply { time = b }; return x.get(Calendar.YEAR) == y.get(Calendar.YEAR) && x.get(Calendar.DAY_OF_YEAR) == y.get(Calendar.DAY_OF_YEAR) }
    val isToday = sameDay(day, Date())
    val evs = vm.work.filter { it.due != null && sameDay(it.due, day) }.sortedBy { it.due?.time ?: 0 }
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.width(44.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(android.text.format.DateFormat.format("EEE", day).toString(), style = MaterialTheme.typography.labelSmall, color = if (isToday) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            Box(Modifier.size(36.dp).clip(CircleShape).background(if (isToday) MaterialTheme.colorScheme.primary else Color.Transparent), contentAlignment = Alignment.Center) {
                cal.time = day; Text("${cal.get(Calendar.DAY_OF_MONTH)}", fontWeight = FontWeight.SemiBold, color = if (isToday) Color.White else MaterialTheme.colorScheme.onSurface)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (evs.isEmpty()) Text("—", color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f))
            evs.forEach { w ->
                val c = vm.course(w.courseId); val hue = c?.hue ?: Palette.SEED; val st = vm.status(w)
                val ctx = LocalContext.current
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Palette.accent(hue, dark()).copy(alpha = 0.12f))
                    .clickable(enabled = w.url != null) { w.url?.let { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) } }.padding(8.dp)) {
                    Text(w.due?.let { Format.time(it) } ?: "", style = MaterialTheme.typography.labelSmall, color = Palette.accent(hue, dark()), fontWeight = FontWeight.Medium)
                    Text(w.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        textDecoration = if (st == WorkStatus.DONE) TextDecoration.LineThrough else null)
                    Text(c?.code ?: "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
    HorizontalDivider()
}

// ---------------- Grades overview ----------------
@Composable
fun GradesOverviewScreen(vm: AppViewModel, openCourse: (Int) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Released grades across your current classes.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(vm.currentCourses()) { c -> GradeSummaryCard(vm, c) { openCourse(c.id) } }
        if (vm.currentCourses().isEmpty()) item { EmptyState(Icons.Default.Grading, "No current classes") }
    }
}

@Composable
fun GradeSummaryCard(vm: AppViewModel, c: Course, onClick: () -> Unit) {
    var grades by remember { mutableStateOf<Grades?>(null) }
    LaunchedEffect(c.id) { grades = runCatching { vm.api?.grades(c.id) }.getOrNull() }
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)).clickable(onClick = onClick).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        GradeRing(grades?.finalPercent ?: grades?.current?.first, size = 72, color = Palette.accent(c.hue, dark()))
        Column {
            Text(c.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(c.code, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// ---------------- Settings ----------------
@Composable
fun SettingsScreen(vm: AppViewModel) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Appearance", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("system" to "System", "light" to "Light", "dark" to "Dark").forEach { (v, l) ->
                FilterChip(vm.themeMode == v, { vm.setTheme(v) }, { Text(l) })
            }
        }
        HorizontalDivider()
        Text("Account", style = MaterialTheme.typography.titleMedium)
        vm.me?.let { Text("${it.firstName} ${it.lastName}") }
        Text(vm.schoolName, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick = { vm.signOut() }) { Icon(Icons.Default.Logout, null); Spacer(Modifier.width(8.dp)); Text("Disconnect") }
        val hidden = vm.courses.filter { vm.isHidden(it.id) }
        if (hidden.isNotEmpty()) {
            HorizontalDivider()
            Text("Hidden classes", style = MaterialTheme.typography.titleMedium)
            hidden.forEach { c -> TextButton(onClick = { vm.setHidden(c.id, false) }) { Icon(Icons.Default.Visibility, null); Spacer(Modifier.width(8.dp)); Text("Show ${c.name}") } }
        }
        HorizontalDivider()
        Text("Lumen reads your classes from Brightspace using the login on this device. It only reads — it never submits or changes anything. Hidden classes and items you tick off are stored on this device.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

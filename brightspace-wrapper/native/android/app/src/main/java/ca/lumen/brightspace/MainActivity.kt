package ca.lumen.brightspace

/*
 * Lumen for Brightspace — Android (fully native, Jetpack Compose).
 * The only WebView is the official Brightspace sign-in (LoginWebView); every other
 * screen is native Compose. After login the app reads the session cookie from
 * Android's CookieManager and calls the read-only Valence API (BrightspaceApi).
 */

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().setAcceptCookie(true)
        setContent {
            val vm: AppViewModel = viewModel()
            LumenTheme(vm.themeMode) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    if (!vm.connected) ConnectScreen(vm) else MainScaffold(vm)
                }
            }
        }
    }
}

@Composable
fun ConnectScreen(vm: AppViewModel) {
    var selected by remember { mutableStateOf(School.catalog.first()) }
    var useOther by remember { mutableStateOf(false) }
    var otherHost by remember { mutableStateOf("") }
    var showLogin by remember { mutableStateOf(false) }

    val host: String? = if (!useOther) selected.host else otherHost.trim().trimEnd('/').let {
        if (it.isEmpty()) null else if (it.startsWith("http")) it else "https://$it"
    }
    val schoolLabel = if (useOther) (host ?: "") else selected.name

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).padding(0.dp)) {
                Surface(color = MaterialTheme.colorScheme.primary, modifier = Modifier.fillMaxSize()) {
                    Box(contentAlignment = Alignment.Center) { Icon(Icons.Default.School, null, tint = Color.White) }
                }
            }
            Text("Lumen", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        }
        Text("Brightspace, organized.", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("Your classes, what’s due, course content and grades in one place. Sign in on the official Brightspace page — Lumen only reads your data and your login stays on this device.",
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        Text("Choose your school", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
        School.catalog.forEach { s ->
            SchoolRow(s.name, s.host.removePrefix("https://"), s.hue, !useOther && selected.id == s.id) { selected = s; useOther = false }
        }
        SchoolRow("Another school", "Any Brightspace site", 265.0, useOther) { useOther = true }
        if (useOther) {
            OutlinedTextField(otherHost, { otherHost = it }, singleLine = true,
                placeholder = { Text("yourschool.brightspace.com") },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                modifier = Modifier.fillMaxWidth())
        }
        Button(onClick = { showLogin = true }, enabled = host != null, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Icon(Icons.Default.Login, null); Spacer(Modifier.width(8.dp)); Text("Sign in with Brightspace")
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Default.Lock, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
            Text("Read-only. Nothing leaves your device.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    if (showLogin && host != null) {
        Dialog(onDismiss = { showLogin = false }) {
            LoginWebView(host) { showLogin = false; vm.connect(host, schoolLabel) }
        }
    }
}

@Composable
fun SchoolRow(name: String, host: String, hue: Double, selected: Boolean, onClick: () -> Unit) {
    val dark = isSystemDark()
    Surface(
        onClick = onClick,
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Surface(color = Palette.accent(hue, dark), modifier = Modifier.matchParentSize()) {}
                Text(name.take(1), color = Color.White, fontWeight = FontWeight.SemiBold)
            }
            Column(Modifier.weight(1f)) {
                Text(name, fontWeight = FontWeight.Medium)
                Text(host, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (selected) Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary)
        }
    }
}

/** The only WebView in the app: the official Brightspace sign-in. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LoginWebView(host: String, onSignedIn: () -> Unit) {
    var done by remember { mutableStateOf(false) }
    AndroidView(factory = { ctx ->
        WebView(ctx).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    if (done) return
                    val cookie = CookieManager.getInstance().getCookie(host) ?: ""
                    if (cookie.contains("d2lSessionVal")) { done = true; CookieManager.getInstance().flush(); onSignedIn() }
                }
            }
            loadUrl("$host/d2l/login")
        }
    }, modifier = Modifier.fillMaxSize())
}

/** Simple full-screen dialog host. */
@Composable
fun Dialog(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column {
                TopAppBar(title = { Text("Sign in to Brightspace") },
                    navigationIcon = { IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Cancel") } })
                Box(Modifier.weight(1f)) { content() }
            }
        }
    }
}

@Composable fun isSystemDark() = androidx.compose.foundation.isSystemInDarkTheme()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScaffold(vm: AppViewModel) {
    var tab by remember { mutableStateOf(0) }
    var openCourse by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(Unit) { if (vm.courses.isEmpty()) vm.load() }

    if (openCourse != null) {
        CourseScreen(vm, openCourse!!) { openCourse = null }
        return
    }
    val missing = vm.work.count { vm.status(it) == WorkStatus.MISSING }
    Scaffold(bottomBar = {
        NavigationBar {
            NavigationBarItem(tab == 0, { tab = 0 }, { Icon(Icons.Default.Home, null) }, label = { Text("Classes") })
            NavigationBarItem(tab == 1, { tab = 1 }, {
                BadgedBox(badge = { if (missing > 0) Badge { Text("$missing") } }) { Icon(Icons.Default.Checklist, null) }
            }, label = { Text("To-do") })
            NavigationBarItem(tab == 2, { tab = 2 }, { Icon(Icons.Default.DateRange, null) }, label = { Text("Calendar") })
            NavigationBarItem(tab == 3, { tab = 3 }, { Icon(Icons.Default.BarChart, null) }, label = { Text("Grades") })
            NavigationBarItem(tab == 4, { tab = 4 }, { Icon(Icons.Default.Settings, null) }, label = { Text("Settings") })
        }
    }) { pad ->
        Box(Modifier.padding(pad)) {
            when (tab) {
                1 -> ToDoScreen(vm)
                2 -> CalendarScreen(vm)
                3 -> GradesOverviewScreen(vm) { openCourse = it }
                4 -> SettingsScreen(vm)
                else -> ClassesScreen(vm) { openCourse = it }
            }
        }
    }
}

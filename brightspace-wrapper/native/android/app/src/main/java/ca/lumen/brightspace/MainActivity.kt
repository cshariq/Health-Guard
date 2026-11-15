package ca.lumen.brightspace

/*
 * Lumen for Brightspace — Android shell.
 *
 * Hosts a WebView running the Lumen UI (assets/lumen/web/index.html, a copy of the
 * repo web UI — run native/sync-assets.sh). You sign in on the official Brightspace
 * page in a second WebView; both share Android's app-wide CookieManager, so the app
 * can read the session cookie and make the read-only Valence API calls itself.
 * Native HTTP isn't bound by the browser's CORS rules, which is what makes this work.
 */

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var loginContainer: FrameLayout
    private var loginWeb: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            webViewClient = WebViewClient()
            addJavascriptInterface(Bridge(), "LumenAndroid")
        }
        loginContainer = FrameLayout(this).apply { visibility = View.GONE }
        root.addView(web)
        root.addView(loginContainer)
        setContentView(root)

        CookieManager.getInstance().setAcceptCookie(true)
        web.loadUrl("file:///android_asset/lumen/web/index.html")
    }

    override fun onBackPressed() {
        if (loginContainer.visibility == View.VISIBLE) { dismissLogin(); return }
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    /** window.Lumen.native → app. Methods run on the WebView's JS thread. */
    inner class Bridge {
        @JavascriptInterface
        fun postMessage(payload: String) {
            val msg = JSONObject(payload)
            val id = msg.optString("id")
            when (msg.optString("type")) {
                "ping" -> resolve(id, JSONObject().put("platform", "android").put("version", appVersion()))
                "login" -> runOnUiThread { presentLogin(msg.optString("host")) { resolve(id, JSONObject().put("signedIn", true)) } }
                "get" -> thread { resolve(id, httpGet(msg.optString("url"))) }
                else -> resolve(id, JSONObject().put("status", 0).put("error", "unknown_type"))
            }
        }
    }

    private fun resolve(id: String, result: JSONObject) {
        val js = "window.Lumen && window.Lumen.native && window.Lumen.native.resolve(${JSONObject.quote(id)}, $result);"
        web.post { web.evaluateJavascript(js, null) }
    }

    /** Read-only GET with the session cookie Android holds for the host. */
    private fun httpGet(urlString: String): JSONObject {
        val result = JSONObject()
        try {
            val url = URL(urlString)
            if (!url.path.startsWith("/d2l/api/")) return result.put("status", 403).put("error", "forbidden")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                instanceFollowRedirects = false
                setRequestProperty("Accept", "application/json")
                CookieManager.getInstance().getCookie(urlString)?.let { setRequestProperty("Cookie", it) }
            }
            val status = conn.responseCode
            val type = conn.contentType ?: ""
            // Signed-out API calls redirect to the HTML login page.
            if (status in 300..399 || type.contains("text/html")) {
                return result.put("status", 401).put("contentType", "application/json").put("body", JSONObject.NULL)
            }
            val text = (if (status < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            result.put("status", status).put("contentType", type)
            if (type.contains("json")) {
                result.put("body", if (text.trimStart().startsWith("[")) org.json.JSONArray(text) else JSONObject(text))
            } else {
                result.put("body", text)
            }
        } catch (e: Exception) {
            result.put("status", 0).put("error", "network").put("message", e.message ?: "")
        }
        return result
    }

    /** Show Brightspace's own sign-in; finish when a session cookie appears. */
    @SuppressLint("SetJavaScriptEnabled")
    private fun presentLogin(host: String, onDone: () -> Unit) {
        val lw = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    val cookie = CookieManager.getInstance().getCookie(host) ?: ""
                    if (cookie.contains("d2lSessionVal")) { CookieManager.getInstance().flush(); dismissLogin(); onDone() }
                }
            }
        }
        loginWeb = lw
        loginContainer.addView(lw)
        loginContainer.visibility = View.VISIBLE
        lw.loadUrl("$host/d2l/login")
    }

    private fun dismissLogin() {
        loginContainer.visibility = View.GONE
        loginWeb?.let { loginContainer.removeView(it); it.destroy() }
        loginWeb = null
    }

    private fun appVersion(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0"
    } catch (e: Exception) { "1.0" }
}

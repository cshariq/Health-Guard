//  MainWindow.xaml.cs
//  Lumen for Brightspace — Windows shell (WPF + WebView2).
//
//  Hosts the Lumen UI in a WebView2. You sign in on the official Brightspace page in a
//  second WebView2 that shares the same user-data folder (so cookies are shared), then
//  the app reads the session cookie via CoreWebView2.CookieManager and makes the
//  read-only Valence API calls with HttpClient — not bound by the browser's CORS rules.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace Lumen
{
    public partial class MainWindow : Window
    {
        private CoreWebView2Environment _env = null!;
        private static readonly HttpClient Http = new(new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false });

        public MainWindow()
        {
            InitializeComponent();
            Loaded += OnLoaded;
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            var dataFolder = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lumen", "WebView2");
            _env = await CoreWebView2Environment.CreateAsync(null, dataFolder);
            await Web.EnsureCoreWebView2Async(_env);

            // Serve the bundled UI from an https origin so cookies/fetch behave normally.
            var assets = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WebAssets");
            Web.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "lumen.local", assets, CoreWebView2HostResourceAccessKind.Allow);
            Web.CoreWebView2.WebMessageReceived += OnWebMessage;
            Web.CoreWebView2.Navigate("https://lumen.local/web/index.html");
        }

        // window.Lumen.native → app (via window.chrome.webview.postMessage)
        private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            JsonElement msg;
            try { msg = JsonDocument.Parse(e.WebMessageAsJson).RootElement; } catch { return; }
            var id = msg.GetProperty("id").GetString() ?? "";
            var type = msg.TryGetProperty("type", out var t) ? t.GetString() : null;

            switch (type)
            {
                case "ping":
                    Reply(id, new { platform = "windows", version = "1.0" });
                    break;
                case "login":
                    var loginHost = msg.GetProperty("host").GetString() ?? "";
                    await PresentLoginAsync(loginHost);
                    Reply(id, new { signedIn = true });
                    break;
                case "get":
                    var url = msg.GetProperty("url").GetString() ?? "";
                    Reply(id, await GetAsync(url));
                    break;
                default:
                    Reply(id, new { status = 0, error = "unknown_type" });
                    break;
            }
        }

        private void Reply(string id, object result)
        {
            var payload = JsonSerializer.Serialize(new { id, result });
            Web.CoreWebView2.PostWebMessageAsJson(payload);
        }

        /// Read-only GET with the session cookies WebView2 holds for the host.
        private async Task<object> GetAsync(string url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || !uri.AbsolutePath.StartsWith("/d2l/api/"))
                return new { status = 403, error = "forbidden" };
            try
            {
                var cookies = await Web.CoreWebView2.CookieManager.GetCookiesAsync(uri.GetLeftPart(UriPartial.Authority));
                var header = string.Join("; ", cookies.Select(c => $"{c.Name}={c.Value}"));
                using var req = new HttpRequestMessage(HttpMethod.Get, uri);
                req.Headers.TryAddWithoutValidation("Accept", "application/json");
                if (header.Length > 0) req.Headers.TryAddWithoutValidation("Cookie", header);
                var res = await Http.SendAsync(req);
                var ct = res.Content.Headers.ContentType?.ToString() ?? "";
                if ((int)res.StatusCode is >= 300 and < 400 || ct.Contains("text/html"))
                    return new { status = 401, contentType = "application/json", body = (object?)null };
                var text = await res.Content.ReadAsStringAsync();
                object body = ct.Contains("json")
                    ? JsonSerializer.Deserialize<JsonElement>(text)
                    : text;
                return new { status = (int)res.StatusCode, contentType = ct, body };
            }
            catch (Exception ex)
            {
                return new { status = 0, error = "network", message = ex.Message };
            }
        }

        /// Show Brightspace's own sign-in; return once a session cookie exists.
        private async Task PresentLoginAsync(string host)
        {
            var tcs = new TaskCompletionSource();
            var win = new LoginWindow(_env, host, () => tcs.TrySetResult()) { Owner = this };
            win.Closed += (_, _) => tcs.TrySetResult();
            win.Show();
            await tcs.Task;
            if (win.IsVisible) win.Close();
        }
    }
}

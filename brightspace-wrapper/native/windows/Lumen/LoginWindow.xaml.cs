//  LoginWindow.xaml.cs — the official Brightspace sign-in, in a shared-cookie WebView2.

using System;
using System.Linq;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace Lumen
{
    public partial class LoginWindow : Window
    {
        private readonly CoreWebView2Environment _env;
        private readonly string _host;
        private readonly Action _onSignedIn;
        private bool _done;

        public LoginWindow(CoreWebView2Environment env, string host, Action onSignedIn)
        {
            InitializeComponent();
            _env = env; _host = host; _onSignedIn = onSignedIn;
            Loaded += OnLoaded;
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            await LoginWeb.EnsureCoreWebView2Async(_env);   // same env => cookies shared with MainWindow
            LoginWeb.CoreWebView2.NavigationCompleted += async (_, _) =>
            {
                if (_done) return;
                var cookies = await LoginWeb.CoreWebView2.CookieManager.GetCookiesAsync(_host);
                if (cookies.Any(c => c.Name.StartsWith("d2lSessionVal")))
                {
                    _done = true;
                    _onSignedIn();
                    Close();
                }
            };
            LoginWeb.CoreWebView2.Navigate($"{_host}/d2l/login");
        }
    }
}

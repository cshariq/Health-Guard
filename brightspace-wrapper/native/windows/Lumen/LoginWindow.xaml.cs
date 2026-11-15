//  LoginWindow.xaml.cs — the ONLY WebView in the app: the official Brightspace sign-in.
//  On success it hands back the session cookie as a header string (nothing is stored here).
using System;
using System.Linq;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace Lumen;

public partial class LoginWindow : Window
{
    private readonly string _host;
    public string? CookieHeader { get; private set; }
    private bool _done;

    public LoginWindow(string host)
    {
        InitializeComponent();
        _host = host;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        var dataFolder = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lumen", "WebView2");
        var env = await CoreWebView2Environment.CreateAsync(null, dataFolder);
        await Web.EnsureCoreWebView2Async(env);
        Web.CoreWebView2.NavigationCompleted += async (_, _) =>
        {
            if (_done) return;
            var cookies = await Web.CoreWebView2.CookieManager.GetCookiesAsync(_host);
            if (cookies.Any(c => c.Name.StartsWith("d2lSessionVal")))
            {
                _done = true;
                CookieHeader = string.Join("; ", cookies.Select(c => $"{c.Name}={c.Value}"));
                DialogResult = true;
                Close();
            }
        };
        Web.CoreWebView2.Navigate($"{_host}/d2l/login");
    }
}

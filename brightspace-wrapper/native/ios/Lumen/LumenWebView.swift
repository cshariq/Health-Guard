//  LumenWebView.swift
//  The main WebView that runs the Lumen UI, plus the bridge the UI calls into.

import SwiftUI
import WebKit

#if os(macOS)
typealias ViewRepresentable = NSViewRepresentable
#else
typealias ViewRepresentable = UIViewRepresentable
#endif

struct LumenWebView: ViewRepresentable {
    func makeCoordinator() -> Bridge { Bridge() }

    #if os(macOS)
    func makeNSView(context: Context) -> WKWebView { context.coordinator.makeWebView() }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
    #else
    func makeUIView(context: Context) -> WKWebView { context.coordinator.makeWebView() }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    #endif
}

/// Implements the native half of the window.Lumen.native contract.
final class Bridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private weak var webView: WKWebView?
    private let client = BrightspaceClient()
    private var login: LoginPresenter?

    func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        // Share ONE cookie store between the UI web view, the login web view and
        // the API client, so the cookie you get by signing in is the one we send.
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "lumen")
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        #if DEBUG
        if #available(iOS 16.4, macOS 13.3, *) { web.isInspectable = true }
        #endif
        self.webView = web

        // Load the bundled Lumen UI (WebAssets/web/index.html).
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "WebAssets/web") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent().deletingLastPathComponent())
        }
        return web
    }

    // MARK: window.Lumen.native → app
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let type = body["type"] as? String else { return }

        switch type {
        case "ping":
            reply(id, ["platform": "ios", "version": appVersion()])

        case "login":
            let host = (body["host"] as? String) ?? ""
            presentLogin(host: host) { [weak self] in self?.reply(id, ["signedIn": true]) }

        case "get":
            guard let urlString = body["url"] as? String, let store = webView?.configuration.websiteDataStore else {
                reply(id, ["status": 0, "error": "bad_request"]); return
            }
            Task {
                let result = await client.get(urlString, cookieStore: store.httpCookieStore)
                await MainActor.run { self.reply(id, result) }
            }

        default:
            reply(id, ["status": 0, "error": "unknown_type"])
        }
    }

    private func reply(_ id: String, _ result: [String: Any]) {
        guard let web = webView,
              let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        // window.Lumen.native.resolve("id", { ... })
        let js = "window.Lumen && window.Lumen.native && window.Lumen.native.resolve(\(jsString(id)), \(json));"
        web.evaluateJavaScript(js)
    }

    // MARK: login
    private func presentLogin(host: String, onDone: @escaping () -> Void) {
        guard let parent = webView else { return }
        let presenter = LoginPresenter(host: host, dataStore: parent.configuration.websiteDataStore) { [weak self] in
            self?.login = nil
            onDone()
        }
        self.login = presenter
        presenter.present(over: parent)
    }

    private func appVersion() -> String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0"
    }
    private func jsString(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s])
        let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(arr.dropFirst().dropLast()) // "..." without the array brackets
    }
}

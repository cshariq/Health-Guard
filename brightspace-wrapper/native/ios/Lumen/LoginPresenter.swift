//  LoginPresenter.swift
//  Shows the official Brightspace sign-in page and finishes once a session cookie exists.
//  Targets iOS and Mac Catalyst (both UIKit). Nothing about the login is intercepted or
//  stored by the app — the student signs in on Brightspace's own page (SSO/MFA included).

#if canImport(UIKit)
import UIKit
import WebKit

final class LoginPresenter: NSObject, WKNavigationDelegate {
    private let host: String
    private let dataStore: WKWebsiteDataStore
    private let onDone: () -> Void
    private var controller: UIViewController?
    private var finished = false

    init(host: String, dataStore: WKWebsiteDataStore, onDone: @escaping () -> Void) {
        self.host = host
        self.dataStore = dataStore
        self.onDone = onDone
    }

    func present(over web: WKWebView) {
        guard let top = web.window?.rootViewController?.topMost() else { return }

        let config = WKWebViewConfiguration()
        config.websiteDataStore = dataStore          // same cookies the API client reads
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self

        let vc = UIViewController()
        vc.view = web
        vc.title = "Sign in to Brightspace"
        let nav = UINavigationController(rootViewController: vc)
        vc.navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancel))
        nav.modalPresentationStyle = .formSheet
        nav.presentationController?.delegate = nil
        self.controller = nav

        if let url = URL(string: host + "/d2l/login") { web.load(URLRequest(url: url)) }
        top.present(nav, animated: true)
    }

    @objc private func cancel() { controller?.dismiss(animated: true) }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        checkSignedIn()
    }

    private func checkSignedIn() {
        dataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self = self, !self.finished else { return }
            let signedIn = cookies.contains { c in
                c.name.hasPrefix("d2lSessionVal") &&
                (self.host.contains(c.domain) || c.domain.contains(URL(string: self.host)?.host ?? "~"))
            }
            if signedIn {
                self.finished = true
                DispatchQueue.main.async {
                    self.controller?.dismiss(animated: true) { self.onDone() }
                }
            }
        }
    }
}

private extension UIViewController {
    func topMost() -> UIViewController {
        var top = self
        while let p = top.presentedViewController { top = p }
        return top
    }
}
#endif

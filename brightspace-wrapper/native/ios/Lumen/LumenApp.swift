//  LumenApp.swift
//  Entry point, connect screen and sign-in. Runs on iOS, iPadOS and macOS.
//
//  The only web views in the app are (1) the official sign-in page and (2) an in-app browser
//  for actions that live on the school's site (handing in work, taking a quiz, opening a file).
//  Both share one cookie store with the native API client, so you sign in once.

import SwiftUI
import WebKit

@main
struct LumenApp: App {
    @StateObject private var store = AppStore()
    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(store.preferredColorScheme())
                .tint(Theme.accent(Theme.seed, false))
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 800)
        #endif
    }
}

struct RootView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        Group {
            if store.connection == nil { ConnectView() } else { MainTabView() }
        }
        // Links to the connected school open inside the app, already signed in.
        .environment(\.openURL, OpenURLAction { url in
            guard store.isSchoolURL(url) else { return .systemAction }
            store.browsing = BrowseTarget(url: url)
            return .handled
        })
        .sheet(item: $store.browsing, onDismiss: { Task { await store.load(force: true) } }) { target in
            BrowserSheet(url: target.url)
        }
    }
}

// MARK: - Connect
struct ConnectView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.colorScheme) var scheme
    @State private var selectedId = School.catalog[0].id
    @State private var otherHost = ""
    @State private var useOther = false
    @State private var showLogin = false

    private var selected: School { School.catalog.first { $0.id == selectedId } ?? School.catalog[0] }
    private var host: String? {
        if !useOther { return selected.host }
        var v = otherHost.trimmingCharacters(in: .whitespacesAndNewlines)
        while v.hasSuffix("/") { v.removeLast() }
        guard !v.isEmpty else { return nil }
        return v.hasPrefix("http://") || v.hasPrefix("https://") ? v : "https://\(v)"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 10) {
                    Image(systemName: "graduationcap.fill").font(.title2).foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(Theme.accent(Theme.seed, scheme == .dark), in: RoundedRectangle(cornerRadius: 12))
                    Text("Lumen").font(.largeTitle.weight(.semibold))
                }
                Text("Your classes, organized.").font(.system(size: 32, weight: .bold))
                Text("Classes, what’s due, course content and grades in one calm place. You sign in on your school’s own page. Lumen only reads your data, and your login stays on this device.")
                    .foregroundStyle(.secondary)

                Text("Choose your school").font(.headline).padding(.top, 4)
                VStack(spacing: 8) {
                    ForEach(School.catalog) { s in
                        SchoolRow(title: s.name, subtitle: s.host.replacingOccurrences(of: "https://", with: ""), hue: s.hue, selected: !useOther && selectedId == s.id) {
                            selectedId = s.id; useOther = false
                        }
                    }
                    SchoolRow(title: "Another school or a Lumen Classes server", subtitle: "Any Brightspace or Lumen Classes address", hue: Theme.seed, selected: useOther) {
                        useOther = true
                    }
                    if useOther {
                        TextField("yourschool.brightspace.com", text: $otherHost)
                            .textFieldStyle(.roundedBorder)
                            .autocorrectionDisabled()
                            #if os(iOS)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            #endif
                    }
                }

                Button {
                    showLogin = true
                } label: {
                    Label("Sign in", systemImage: "arrow.right.circle.fill").frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(host == nil)

                Label("Read-only. Nothing leaves your device.", systemImage: "lock.fill")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(24)
            .frame(maxWidth: 620, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .sheet(isPresented: $showLogin) {
            if let host {
                LoginSheet(host: host) {
                    showLogin = false
                    store.connect(host: host, schoolName: useOther ? (URL(string: host)?.host ?? host) : selected.name)
                }
            }
        }
    }
}

struct SchoolRow: View {
    let title: String
    let subtitle: String
    let hue: Double
    let selected: Bool
    let tap: () -> Void
    @Environment(\.colorScheme) var scheme

    var body: some View {
        Button(action: tap) {
            HStack(spacing: 14) {
                Text(String(title.prefix(1)))
                    .font(.title3.weight(.semibold)).foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Theme.accent(hue, scheme == .dark), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.body.weight(.medium)).foregroundStyle(.primary)
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if selected { Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint) }
            }
            .padding(12)
            .background(selected ? Color.accentColor.opacity(0.12) : Color.gray.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(selected ? Color.accentColor : Color.clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Sign-in sheet
struct LoginSheet: View {
    let host: String
    let onSignedIn: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var signedIn = false

    var body: some View {
        NavigationStack {
            WebView(url: URL(string: host + "/d2l/login") ?? URL(string: host)!) { _ in
                // After every page load, ask the API who we are. Signed in = that call succeeds.
                // This doesn't depend on cookie names or on when the school sets its cookies.
                Task {
                    guard !signedIn else { return }
                    let api = BrightspaceAPI(host: host) { await WebCookies.header(for: $0) }
                    if (try? await api.whoami()) != nil {
                        signedIn = true
                        onSignedIn()
                    }
                }
            }
            .navigationTitle("Sign in")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 680)
        #endif
    }
}

// MARK: - In-app browser (hand in work, take a quiz, open a file — already signed in)
struct BrowseTarget: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

struct BrowserSheet: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            WebView(url: url) { _ in }
                .navigationTitle(url.host ?? "")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        #if os(macOS)
        .frame(minWidth: 900, minHeight: 700)
        #endif
    }
}

// MARK: - Web view wrapper (shares the default cookie store with the API client)
struct WebView {
    let url: URL
    let onPageLoaded: (URL?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPageLoaded: onPageLoaded) }

    fileprivate func makeWebView(_ coordinator: Coordinator) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = coordinator
        web.allowsBackForwardNavigationGestures = true
        web.load(URLRequest(url: url))
        return web
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onPageLoaded: (URL?) -> Void
        init(onPageLoaded: @escaping (URL?) -> Void) { self.onPageLoaded = onPageLoaded }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { onPageLoaded(webView.url) }
    }
}

#if os(macOS)
extension WebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#else
extension WebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#endif

// MARK: - Cookies for the API client
enum WebCookies {
    @MainActor
    static func all() async -> [HTTPCookie] {
        await withCheckedContinuation { continuation in
            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
        }
    }

    /// The `Cookie` header for a host: only cookies whose domain actually covers that host.
    static func header(for host: String) async -> String {
        guard let name = URL(string: host)?.host?.lowercased() else { return "" }
        let cookies = await all()
        return cookies.filter { cookie in
            var domain = cookie.domain.lowercased()
            if domain.hasPrefix(".") { domain.removeFirst() }
            return name == domain || name.hasSuffix("." + domain)
        }
        .map { "\($0.name)=\($0.value)" }
        .joined(separator: "; ")
    }

    /// Forget the sign-in (used by Disconnect).
    @MainActor
    static func clear() async {
        let store = WKWebsiteDataStore.default()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { continuation.resume() }
        }
    }
}

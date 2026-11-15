//  LumenApp.swift
//  Entry point + connect/login. The ONLY WebView in the app is the Brightspace
//  login page (LoginWebView); every other screen is native SwiftUI.

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
    }
}

struct RootView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        if store.connection == nil { ConnectView() } else { MainTabView() }
    }
}

// MARK: - Connect / sign in
struct ConnectView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.colorScheme) var scheme
    @State private var selected = School.catalog.first!
    @State private var otherHost = ""
    @State private var useOther = false
    @State private var showLogin = false

    private var host: String? {
        if !useOther { return selected.host }
        let v = otherHost.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        guard !v.isEmpty else { return nil }
        return v.hasPrefix("http") ? v : "https://\(v)"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 10) {
                    Image(systemName: "graduationcap.fill").font(.title2).foregroundStyle(.white)
                        .frame(width: 44, height: 44).background(Theme.accent(Theme.seed, scheme == .dark), in: RoundedRectangle(cornerRadius: 12))
                    Text("Lumen").font(.largeTitle.weight(.semibold))
                }
                Text("Brightspace, organized.").font(.system(size: 34, weight: .bold))
                Text("Your classes, what’s due, course content and grades in one calm place. Sign in on the official Brightspace page — Lumen only reads your data, and your login stays on this device.")
                    .foregroundStyle(.secondary)

                Text("Choose your school").font(.headline).padding(.top, 8)
                VStack(spacing: 8) {
                    ForEach(School.catalog) { s in
                        SchoolRow(school: s, selected: !useOther && selected.id == s.id) {
                            selected = s; useOther = false
                        }
                    }
                    SchoolRow(school: School(id: "other", name: "Another school", host: "Any Brightspace site", hue: 265), selected: useOther) {
                        useOther = true
                    }
                    if useOther {
                        TextField("yourschool.brightspace.com", text: $otherHost)
                            .textFieldStyle(.roundedBorder).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }

                Button {
                    showLogin = true
                } label: {
                    Label("Sign in with Brightspace", systemImage: "arrow.right.circle.fill")
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(host == nil)
                .padding(.top, 8)

                Label("Read-only. Nothing leaves your device.", systemImage: "lock.fill")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(24)
        }
        .sheet(isPresented: $showLogin) {
            if let host {
                LoginSheet(host: host) {
                    showLogin = false
                    store.connect(host: host, schoolName: useOther ? host : selected.name)
                }
            }
        }
    }
}

struct SchoolRow: View {
    let school: School; let selected: Bool; let tap: () -> Void
    @Environment(\.colorScheme) var scheme
    var body: some View {
        Button(action: tap) {
            HStack(spacing: 14) {
                Text(String(school.name.prefix(1)))
                    .font(.title3.weight(.semibold)).foregroundStyle(.white)
                    .frame(width: 40, height: 40).background(Theme.accent(school.hue, scheme == .dark), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 1) {
                    Text(school.name).font(.body.weight(.medium)).foregroundStyle(.primary)
                    Text(school.host.replacingOccurrences(of: "https://", with: "")).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if selected { Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint) }
            }
            .padding(12)
            .background(selected ? Color.accentColor.opacity(0.12) : Color.gray.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(selected ? Color.accentColor : .clear))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Login (the only WebView in the app)
struct LoginSheet: View {
    let host: String
    let onSignedIn: () -> Void
    @Environment(\.dismiss) var dismiss
    var body: some View {
        NavigationStack {
            LoginWebView(host: host, onSignedIn: onSignedIn)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Sign in to Brightspace")
                #if !os(macOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

struct LoginWebView {
    let host: String
    let onSignedIn: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(host: host, onSignedIn: onSignedIn) }

    func make(_ coordinator: Coordinator) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()   // the store BrightspaceAPI reads cookies from
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = coordinator
        if let url = URL(string: host + "/d2l/login") { web.load(URLRequest(url: url)) }
        return web
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let host: String; let onSignedIn: () -> Void; private var done = false
        init(host: String, onSignedIn: @escaping () -> Void) { self.host = host; self.onSignedIn = onSignedIn }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !done else { return }
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                guard let self, !self.done else { return }
                let h = URL(string: self.host)?.host ?? ""
                if cookies.contains(where: { $0.name.hasPrefix("d2lSessionVal") && (h.contains($0.domain) || $0.domain.contains(h)) }) {
                    self.done = true
                    DispatchQueue.main.async { self.onSignedIn() }
                }
            }
        }
    }
}

#if os(macOS)
extension LoginWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { make(context.coordinator) }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#else
extension LoginWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { make(context.coordinator) }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#endif

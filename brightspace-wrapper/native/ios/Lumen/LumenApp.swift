//  LumenApp.swift
//  Lumen for Brightspace — iOS & macOS (Catalyst) shell.
//
//  How it works
//  ------------
//  A browser on another origin can't read your Brightspace session, but this app
//  can: it hosts a WKWebView, you sign in on the *official* Brightspace page inside
//  it, and the app reads the session cookie from its own WKWebsiteDataStore to make
//  the read-only Valence API calls. The UI is the same Lumen web app (WebAssets/,
//  a copy of the repo's web UI — run native/sync-assets.sh to refresh it), talking
//  to the app through window.Lumen.native (see web/native-bridge.js).
//
//  Nothing leaves the device except the requests to your school's Brightspace.

import SwiftUI

@main
struct LumenApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .ignoresSafeArea()
        }
    }
}

struct RootView: View {
    var body: some View {
        LumenWebView()
            .ignoresSafeArea()
    }
}

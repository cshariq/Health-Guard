# Lumen native apps (iOS / macOS, Android, Windows)

These are thin native shells around the **same Lumen UI** as the website and extension.
They exist to do the one thing a browser can't: **read your Brightspace session cookie
after you log in**, so Lumen works on its own with no extension and no school-side setup.

## Why a native app can do this and a website can't

- A website on `lumen.example.com` can't read `brightspace.carleton.ca`'s session cookie —
  it's `HttpOnly` and locked to the Brightspace origin, and cross-origin reads are blocked.
- A **native app hosts its own WebView**. You sign in on the *official* Brightspace page
  inside it, and the app reads the session cookie from **its own WebView cookie store**,
  then makes the read-only Valence API calls itself. Native HTTP isn't bound by the
  browser's CORS rules, so the calls just work.

This is the same idea as inspecting the network tab and replaying the requests — done on
the one layer where the credential is actually reachable.

## Architecture (shared across all three)

```
┌ native app ───────────────────────────────────────────────┐
│  WebView  ──loads──►  Lumen UI (web/index.html, src/*)      │
│     ▲   │                                                   │
│     │   └─ window.Lumen.native.get(url) ──► native bridge ──┼─► GET brightspace.../d2l/api/...
│     │                                         (adds cookie) │      (read-only)
│     └────────── resolve(id, {status,body}) ◄───────────────┘
│  Login WebView ──► official Brightspace sign-in ──► cookie stored
└────────────────────────────────────────────────────────────┘
```

- The JS contract is `web/native-bridge.js` (`window.Lumen.native`), already in the web UI.
- Each app implements the native half: `ping`, `login`, and read-only `get`.
- The UI runs in **native mode** automatically when it detects a native host.

## Before building any app

Copy the shared web UI into each app from the repo root:

```bash
cd brightspace-wrapper
./native/sync-assets.sh
```

This populates `native/*/…/WebAssets` (and Android `assets/lumen`). These copies are
git-ignored; re-run it whenever `src/` or `web/` changes.

## iOS & macOS (Swift)

`native/ios/Lumen/` — SwiftUI + `WKWebView`.

1. In Xcode: **File → New → Project → App** (SwiftUI). Add the `.swift` files from
   `native/ios/Lumen/`.
2. Add the synced `WebAssets` folder to the app target as a **folder reference** (blue),
   so `WebAssets/web/index.html` ships in the bundle.
3. Reads cookies via `WKHTTPCookieStore`; fetches with `URLSession`
   (`BrightspaceClient.swift`). Login is presented by `LoginPresenter.swift`.
4. Build for iOS, or run as **Mac Catalyst** for macOS (same UIKit code path).

## Android (Kotlin)

`native/android/` — a Gradle project; `MainActivity.kt` has everything.

1. Open `native/android/` in Android Studio (or `./gradlew assembleDebug`).
2. The UI loads from `assets/lumen/web/index.html`; the bridge is the
   `LumenAndroid` JavaScript interface.
3. Reads the cookie via `CookieManager.getCookie(host)` and fetches with
   `HttpURLConnection`. Login uses a second WebView sharing the app-wide cookie jar.

## Windows (.NET + WebView2)

`native/windows/Lumen/` — WPF + WebView2.

1. `dotnet run` (or open in Visual Studio 2022). Needs the WebView2 Runtime (preinstalled
   on current Windows 10/11).
2. The UI is served from a virtual host (`https://lumen.local/web/index.html`) mapped to
   `WebAssets`. Bridge is `window.chrome.webview`.
3. Reads cookies via `CoreWebView2.CookieManager` and fetches with `HttpClient`. Login is
   a second WebView2 (`LoginWindow`) sharing the same user-data folder.

## Privacy & scope (all platforms)

- You sign in only on **Brightspace's own page** (SSO and MFA included). The app never sees
  or stores your password — it only reads the resulting session cookie, on your device.
- All API calls are **read-only** `GET`s to `/d2l/api/…`. Lumen never writes to Brightspace.
- Nothing is sent to any Lumen server; there isn't one in native mode.

## What's tested vs. not

The `native-bridge.js` contract (all three host styles) is verified against the real Lumen
UI. The native Swift/Kotlin/C# code is written to that contract but must be compiled in
Xcode / Android Studio / Visual Studio — it can't be built in a Linux CI shell.

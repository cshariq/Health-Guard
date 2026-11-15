# Lumen native apps (iOS / macOS, Android, Windows)

Fully native Lumen clients. The UI is **native on every platform** — SwiftUI, Jetpack
Compose and WPF — not a web view wrapping the website. The **only** web view in each app is
the official Brightspace **sign-in page**, which can't be anything else (it's the school's
own SSO/MFA page).

## Why a native app, and why it can do what a website can't

- A website on `lumen.example.com` can't read `brightspace.carleton.ca`'s session cookie —
  it's `HttpOnly` and locked to the Brightspace origin, and cross-origin reads are blocked.
- A native app signs you in on the **official Brightspace page** inside a system web view,
  then reads the session cookie from **its own cookie store** and calls the Valence API with
  native HTTP (`URLSession` / `HttpURLConnection` / `HttpClient`). Native HTTP isn't bound by
  the browser's CORS rules, so this works.

Everything is **read-only**: Lumen only ever makes `GET` calls to `/d2l/api/…`. Your password
only goes to Brightspace's own page; nothing is sent to any Lumen server (there isn't one).

## Shared design (all three)

Each app has the same layers, written natively per platform:

| Layer | iOS/macOS (Swift) | Android (Kotlin) | Windows (C#) |
|---|---|---|---|
| Models | `Models.swift` | `Models.kt` | `Models.cs` |
| API client (read-only Valence) | `BrightspaceAPI.swift` | `BrightspaceApi.kt` | `Models.cs` (`BrightspaceApi`) |
| Dynamic course color | `Theme.swift` | `Theme.kt` | `Palette.cs` |
| State | `AppStore.swift` | `AppViewModel.kt` | `AppState.cs` |
| Login web view (only web view) | `LoginWebView` in `LumenApp.swift` | `LoginWebView` in `MainActivity.kt` | `LoginWindow.xaml.cs` |
| Screens | `ClassesView` / `CourseView` / `Screens.swift` | `Screens.kt` / `Screens2.kt` | `MainWindow` / `CourseWindow` |

Screens: **Classes** (hero, due-soon, course cards), **Class** (Stream / Classwork / Work /
Grades), **To-do**, **Calendar** (iOS/Android), **Grades**, **Settings**. Each course keeps a
stable color computed the same way as the web app, so a class looks the same everywhere.

## iOS & macOS (Swift / SwiftUI)

`native/ios/Lumen/` — pure SwiftUI; cookies via `WKHTTPCookieStore`, requests via `URLSession`.

1. Xcode → **File ▸ New ▸ Project ▸ App** (SwiftUI, name it Lumen), then add all `.swift`
   files from `native/ios/Lumen/` to the target (or point the project at this folder).
2. iOS 16+ / macOS 13+ (uses `NavigationStack`, `.task(id:)`). Build for iOS, or run as
   **Mac Catalyst** for macOS (same code).
3. No third-party dependencies.

## Android (Kotlin / Jetpack Compose)

`native/android/` — a Gradle project; Compose Material 3; cookies via `CookieManager`,
requests via `HttpURLConnection` on coroutines.

1. Open `native/android/` in Android Studio, or `./gradlew assembleDebug`.
2. minSdk 26, targetSdk 34. Dependencies are in `app/build.gradle.kts` (Compose BOM +
   material-icons-extended).

## Windows (C# / WPF)

`native/windows/Lumen/` — native WPF; cookies via WebView2's `CookieManager` captured at
login, requests via `HttpClient`.

1. `dotnet run` (or open in Visual Studio 2022). Needs the WebView2 Runtime (preinstalled on
   current Windows 10/11); the only NuGet dependency is `Microsoft.Web.WebView2`.
2. Covers Classes, the class detail (Stream / Classwork / Work / Grades), To-do, Grades and
   Settings. It's the most compact of the three UIs.

## Status — built vs. compiled

All three are written natively against the Valence API and the platform cookie stores. They
were authored in a Linux environment, so they have **not been compiled** — expect to resolve
a few small things on first build in Xcode / Android Studio / Visual Studio (a missing import,
an SDK version nudge). The networking and models are the same logic the web app uses and is
tested against; the UI is standard framework code.

## Privacy

- You sign in only on **Brightspace's own page** (SSO and MFA included). The app never sees or
  stores your password — only the resulting session cookie, on your device.
- All API calls are read-only `GET`s to `/d2l/api/…`. Lumen never writes to Brightspace.
- Hidden classes and items you tick off are stored locally on the device.

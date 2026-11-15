# Lumen for iPhone, iPad and Mac

One SwiftUI app, one Xcode target, three platforms. No third-party dependencies.

## Build and run

1. Open **`native/ios/Lumen.xcodeproj`** in Xcode 15 or newer.
2. Pick a destination in the toolbar: an **iPhone/iPad simulator**, or **My Mac**.
3. Press **Run** (⌘R).

That's all for the simulator and for your Mac. To run on a real iPhone or iPad, select the *Lumen*
target → **Signing & Capabilities** → choose your **Team** (a free Apple ID works), and change the
bundle identifier (`ca.lumen.app`) to something unique to you.

From the command line:

```bash
cd native/ios
xcodebuild -scheme Lumen -destination 'platform=macOS' build
xcodebuild -scheme Lumen -destination 'platform=iOS Simulator,name=iPhone 16' build
```

Requires iOS 16 / macOS 13 or later.

## Using it

- Choose **Carleton** or **Waterloo**, or pick *Another school or a Lumen Classes server* and type its
  address (for a Classes server on your own Mac: `http://localhost:8200`).
- **Sign in** opens your school's own sign-in page. When it succeeds the sheet closes by itself.
- Classes, To-do, Calendar, Grades and each class's Stream / Classwork / Work / Grades are native.
- Tapping an assignment, quiz, file or link on the school's site opens it in an **in-app browser that is
  already signed in**, so you can hand in work or take a quiz without logging in again. When you close
  it, the app refreshes.

## What has and hasn't been checked

This was written on Linux, where SwiftUI doesn't exist, so be clear-eyed about it:

| Part | Status |
|---|---|
| `Sources/LumenCore` (models, API client, grade maths, HTML→text) | **Compiled and tested**: `swift test` runs 8 tests against a fake Brightspace and a live Lumen Classes server |
| `Lumen/*.swift` (SwiftUI screens, web views, app state) | Syntax-checked with the Swift compiler's parser and reviewed by hand. **Not type-checked or run** |
| `Lumen.xcodeproj` | Generated with the `xcodeproj` library and validated structurally. **Not opened in Xcode** |

So the first build may show a few compiler errors in the SwiftUI files. They're usually one-liners.
If you hit any, copy the errors from Xcode's Issue navigator (or the output of the `xcodebuild` command
above) and send them over.

## Layout

```
Lumen.xcodeproj            the app (regenerate with: ruby scripts/make-xcodeproj.rb)
Sources/LumenCore/         platform-neutral core, also a Swift package
  Models.swift             courses, work items, grades, colors, HTML→text
  BrightspaceAPI.swift     read-only client for Brightspace and Lumen Classes
Lumen/                     the SwiftUI app
  LumenApp.swift           entry, connect screen, sign-in sheet, in-app browser, cookie bridge
  AppStore.swift           state: connection, courses, work, settings
  ClassesView.swift        tab bar + Classes
  CourseView.swift         a class: Stream / Classwork / Work / Grades
  Screens.swift            To-do, Calendar, Grades, Settings
  Components.swift, Theme.swift
  Info.plist, Lumen.entitlements, Assets.xcassets
Tests/LumenCoreTests/      swift test  (start demo/mock-server.mjs and classes/server.mjs first)
Package.swift
```

## Running the core tests

```bash
node demo/mock-server.mjs &            # fake Brightspace on :8091
node classes/server.mjs &              # Lumen Classes on :8200
cd native/ios && swift test
```

Each group of tests skips itself if its server isn't running.

## Notes

- **Sign-in detection** asks the API "who am I?" after each page load, so it doesn't depend on cookie
  names or when the school sets them.
- **Cookies** are read from the web view's store and sent only to the host they belong to.
- **Plain http** is allowed only for local addresses (`NSAllowsLocalNetworking`), for testing against a
  Classes server on your own machine or network. Everything else must be https.
- **macOS** runs sandboxed with outgoing network access only.

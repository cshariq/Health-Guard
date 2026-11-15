// swift-tools-version:5.9
// The platform-neutral core of the Lumen Apple app (models + Brightspace API client).
// The app itself is built from Lumen.xcodeproj; this package exists so the core can be
// compiled and tested anywhere, including Linux:   swift test
import PackageDescription

let package = Package(
    name: "LumenCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "LumenCore", targets: ["LumenCore"])],
    targets: [
        .target(name: "LumenCore", path: "Sources/LumenCore"),
        .testTarget(name: "LumenCoreTests", dependencies: ["LumenCore"], path: "Tests/LumenCoreTests"),
    ]
)

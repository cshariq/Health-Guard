//  AppStore.swift
//  App state: the connected school, loaded data, per-item "done" ticks, and settings.

import SwiftUI

struct School: Identifiable, Hashable {
    let id: String
    let name: String
    let host: String
    var hue: Double
    static let catalog: [School] = [
        School(id: "carleton", name: "Carleton University", host: "https://brightspace.carleton.ca", hue: 25),
        School(id: "uwaterloo", name: "University of Waterloo", host: "https://learn.uwaterloo.ca", hue: 85),
    ]
}

struct Connection: Codable, Equatable {
    var host: String
    var schoolName: String
}

enum ThemeMode: String, CaseIterable { case system, light, dark }

@MainActor
final class AppStore: ObservableObject {
    @Published var connection: Connection?
    @Published var me: Me?
    @Published var courses: [Course] = []
    @Published var work: [WorkItem] = []
    @Published var loading = false
    @Published var loadError: String?
    @Published var browsing: BrowseTarget?
    @Published private(set) var doneOverrides: [String: Bool] = [:]
    @Published var themeModeRaw: String = ThemeMode.system.rawValue { didSet { defaults.set(themeModeRaw, forKey: Keys.theme) } }
    @Published var hiddenCourses: Set<Int> = [] { didSet { defaults.set(Array(hiddenCourses), forKey: Keys.hidden) } }

    private(set) var api: BrightspaceAPI?
    private let defaults = UserDefaults.standard
    private enum Keys { static let connection = "lumen.connection", done = "lumen.done", theme = "lumen.theme", hidden = "lumen.hidden" }

    init() {
        themeModeRaw = defaults.string(forKey: Keys.theme) ?? ThemeMode.system.rawValue
        hiddenCourses = Set((defaults.array(forKey: Keys.hidden) as? [Int]) ?? [])
        doneOverrides = (defaults.dictionary(forKey: Keys.done) as? [String: Bool]) ?? [:]
        if let data = defaults.data(forKey: Keys.connection), let saved = try? JSONDecoder().decode(Connection.self, from: data) {
            connection = saved
            api = Self.makeAPI(saved.host)
        }
    }

    private static func makeAPI(_ host: String) -> BrightspaceAPI {
        BrightspaceAPI(host: host) { await WebCookies.header(for: $0) }
    }

    // MARK: connection
    func connect(host: String, schoolName: String) {
        let c = Connection(host: host, schoolName: schoolName)
        connection = c
        api = Self.makeAPI(host)
        if let data = try? JSONEncoder().encode(c) { defaults.set(data, forKey: Keys.connection) }
        Task { await load() }
    }

    func signOut() {
        connection = nil; api = nil; me = nil; courses = []; work = []; loadError = nil
        defaults.removeObject(forKey: Keys.connection)
        Task { await WebCookies.clear() }
    }

    /// True for links on the connected school's site (those open in the in-app browser).
    func isSchoolURL(_ url: URL) -> Bool {
        guard let c = connection, let schoolHost = URL(string: c.host)?.host, let host = url.host else { return false }
        return host.lowercased() == schoolHost.lowercased()
    }

    // MARK: loading
    func load(force: Bool = false) async {
        guard let api else { return }
        loading = true; loadError = nil
        if force { await api.clearCache() }
        do {
            let who = try? await api.whoami()
            let list = try await api.courses()
            me = who
            courses = Palette.withDistinctHues(list)
            let ids = currentCourses.map(\.id)
            let items = (try? await api.workItems(courseIds: ids)) ?? []
            work = dedupeWork(items)
        } catch let e as APIError {
            loadError = e.isSignedOut ? "signed_out" : describe(e)
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }

    // MARK: derived
    var visibleCourses: [Course] { courses.filter { !hiddenCourses.contains($0.id) } }
    var currentCourses: [Course] { visibleCourses.filter(\.isCurrent) }
    func course(_ id: Int) -> Course? { courses.first { $0.id == id } }
    func work(for id: Int) -> [WorkItem] { work.filter { $0.courseId == id } }

    func status(_ item: WorkItem) -> WorkStatus { item.status(doneOverride: doneOverrides[item.id]) }
    func toggleDone(_ item: WorkItem) {
        let nowDone = status(item) != .done
        if nowDone == item.completed { doneOverrides[item.id] = nil } else { doneOverrides[item.id] = nowDone }
        defaults.set(doneOverrides, forKey: Keys.done)
    }

    var themeMode: ThemeMode { ThemeMode(rawValue: themeModeRaw) ?? .system }
    func preferredColorScheme() -> ColorScheme? {
        switch themeMode {
        case .light: return .light
        case .dark: return .dark
        case .system: return nil
        }
    }

    private func describe(_ e: APIError) -> String {
        switch e {
        case .signedOut: return "signed_out"
        case .http(let code): return "The school’s site returned \(code)."
        case .network(let message): return message
        case .badURL: return "That address doesn’t look right."
        }
    }
}

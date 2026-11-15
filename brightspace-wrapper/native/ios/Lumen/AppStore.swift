//  AppStore.swift
//  App state: the connected school, loaded data, per-item "done" ticks, and settings.

import SwiftUI
import Combine

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

struct Connection: Codable, Equatable { var host: String; var schoolName: String }

enum ThemeMode: String, CaseIterable { case system, light, dark }

@MainActor
final class AppStore: ObservableObject {
    @Published var connection: Connection?
    @Published var me: Me?
    @Published var courses: [Course] = []
    @Published var work: [WorkItem] = []
    @Published var loading = false
    @Published var loadError: String?
    @Published private(set) var doneOverrides: [String: Bool]
    @AppStorage("themeMode") var themeModeRaw: String = ThemeMode.system.rawValue
    @AppStorage("hiddenCourses") private var hiddenCoursesRaw: String = ""

    private(set) var api: BrightspaceAPI?

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.connKey),
           let c = try? JSONDecoder().decode(Connection.self, from: data) {
            connection = c
            api = BrightspaceAPI(host: c.host)
        }
        doneOverrides = (UserDefaults.standard.dictionary(forKey: Self.doneKey) as? [String: Bool]) ?? [:]
    }

    // MARK: connection
    func connect(host: String, schoolName: String) {
        let c = Connection(host: host, schoolName: schoolName)
        connection = c
        api = BrightspaceAPI(host: host)
        if let data = try? JSONEncoder().encode(c) { UserDefaults.standard.set(data, forKey: Self.connKey) }
        Task { await load() }
    }
    func signOut() {
        connection = nil; api = nil; me = nil; courses = []; work = []; loadError = nil
        UserDefaults.standard.removeObject(forKey: Self.connKey)
    }

    // MARK: loading
    func load(force: Bool = false) async {
        guard let api else { return }
        loading = true; loadError = nil
        if force { await api.clearCache() }
        do {
            async let meT = try? await api.whoami()
            let cs = try await api.courses()
            me = await meT
            courses = assignColors(cs)
            let ids = currentCourses.map(\.id)
            work = dedupe((try? await api.workItems(courseIds: ids)) ?? [])
        } catch let e as APIError {
            if case .signedOut = e { loadError = "signed_out" } else { loadError = message(e) }
        } catch { loadError = error.localizedDescription }
        loading = false
    }

    private func assignColors(_ cs: [Course]) -> [Course] { cs }   // hue is computed per course
    private func dedupe(_ items: [WorkItem]) -> [WorkItem] {
        var seen = Set<String>(); var out: [WorkItem] = []
        for w in items {
            let k = "\(w.courseId):\(w.kind.rawValue):\(w.title):\(w.due?.timeIntervalSince1970 ?? 0)"
            if seen.insert(k).inserted { out.append(w) }
        }
        return out
    }

    // MARK: derived
    var hiddenCourses: Set<Int> {
        get { Set(hiddenCoursesRaw.split(separator: ",").compactMap { Int($0) }) }
        set { hiddenCoursesRaw = newValue.map(String.init).joined(separator: ",") }
    }
    var visibleCourses: [Course] { courses.filter { !hiddenCourses.contains($0.id) } }
    var currentCourses: [Course] { visibleCourses.filter(\.isCurrent) }
    func course(_ id: Int) -> Course? { courses.first { $0.id == id } }
    func work(for id: Int) -> [WorkItem] { work.filter { $0.courseId == id } }

    func status(_ item: WorkItem) -> WorkStatus { item.status(doneOverride: doneOverrides[item.id]) }
    func toggleDone(_ item: WorkItem) {
        let now = status(item) != .done
        if now == item.completed { doneOverrides[item.id] = nil } else { doneOverrides[item.id] = now }
        UserDefaults.standard.set(doneOverrides, forKey: Self.doneKey)
        objectWillChange.send()
    }

    var themeMode: ThemeMode { ThemeMode(rawValue: themeModeRaw) ?? .system }
    func preferredColorScheme() -> ColorScheme? {
        switch themeMode { case .light: return .light; case .dark: return .dark; case .system: return nil }
    }

    private func message(_ e: APIError) -> String {
        switch e {
        case .signedOut: return "signed_out"
        case .http(let c): return "Brightspace returned \(c)."
        case .network(let m): return m
        case .badURL: return "Bad address."
        }
    }

    private static let connKey = "lumen.connection"
    private static let doneKey = "lumen.done"
}

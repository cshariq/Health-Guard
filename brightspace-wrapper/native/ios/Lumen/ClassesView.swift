//  ClassesView.swift
//  The tab shell and the Classes screen (hero, due-soon, course cards).

import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        TabView {
            NavigationStack { ClassesView() }
                .tabItem { Label("Classes", systemImage: "house.fill") }
            NavigationStack { ToDoView() }
                .tabItem { Label("To-do", systemImage: "checklist") }
                .badge(store.work.filter { store.status($0) == .missing }.count)
            NavigationStack { CalendarView() }
                .tabItem { Label("Calendar", systemImage: "calendar") }
            NavigationStack { GradesOverviewView() }
                .tabItem { Label("Grades", systemImage: "chart.bar.fill") }
            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .task { if store.courses.isEmpty { await store.load() } }
    }
}

struct ClassesView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.colorScheme) var scheme
    @State private var termFilter = "current"

    private let cols = [GridItem(.adaptive(minimum: 300, maximum: 480), spacing: 16)]

    var body: some View {
        ScrollView {
            if let err = store.loadError, store.courses.isEmpty {
                LoadErrorView(error: err) { Task { await store.load(force: true) } }
            } else {
                VStack(alignment: .leading, spacing: 24) {
                    hero
                    dueSoon
                    classes
                }.padding(16)
            }
        }
        .navigationTitle("Lumen")
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { Task { await store.load(force: true) } } label: { Image(systemName: "arrow.clockwise") } } }
        .refreshable { await store.load(force: true) }
        .overlay { if store.loading && store.courses.isEmpty { ProgressView() } }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
        if let f = store.me?.firstName, !f.isEmpty { return "\(part), \(f)" }
        return part
    }

    private var upcoming: [WorkItem] {
        store.work.filter { store.status($0) == .assigned && ($0.due.map { Fmt.daysFromToday($0) <= 7 } ?? false) }
            .sorted { ($0.due ?? .distantFuture) < ($1.due ?? .distantFuture) }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(greeting).font(.system(size: 30, weight: .bold))
            Text(upcoming.isEmpty ? "Nothing due this week. Nice." : "\(upcoming.count) thing\(upcoming.count == 1 ? "" : "s") due in the next 7 days")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(Theme.container(Theme.seed, scheme == .dark), in: RoundedRectangle(cornerRadius: 24))
    }

    @ViewBuilder private var dueSoon: some View {
        if !upcoming.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Due soon")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(upcoming.prefix(10)) { w in
                            let c = store.course(w.courseId)
                            let hue = c?.hue ?? Theme.seed
                            VStack(alignment: .leading, spacing: 6) {
                                Text(dueWhen(w.due)).font(.caption.weight(.semibold)).foregroundStyle(Theme.accent(hue, scheme == .dark))
                                Text(w.title).font(.subheadline.weight(.medium)).lineLimit(2)
                                Spacer(minLength: 0)
                                Label(c?.code ?? "", systemImage: w.kind.symbol).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                            }
                            .padding(14).frame(width: 220, height: 120, alignment: .leading)
                            .background(Color.gray.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
                            .overlay(alignment: .leading) { Rectangle().fill(Theme.accent(hue, scheme == .dark)).frame(width: 4).clipShape(RoundedRectangle(cornerRadius: 2)) }
                        }
                    }
                }
            }
        }
    }
    private func dueWhen(_ d: Date?) -> String {
        guard let d else { return "" }
        let n = Fmt.daysFromToday(d)
        return (n == 0 ? "Today" : n == 1 ? "Tomorrow" : Fmt.day(d)) + " · " + Fmt.time(d)
    }

    private var terms: [String] {
        var sortOf: [String: Int] = [:]
        for c in store.visibleCourses { sortOf[c.termLabel] = max(sortOf[c.termLabel] ?? 0, c.termSort) }
        return sortOf.keys.sorted { (sortOf[$0] ?? 0) > (sortOf[$1] ?? 0) }
    }
    private var shownCourses: [Course] {
        store.visibleCourses
            .filter { termFilter == "current" ? $0.isCurrent : termFilter == "all" ? true : $0.termLabel == termFilter }
            .sorted { ($0.pinned ? 0 : 1, $0.name) < ($1.pinned ? 0 : 1, $1.name) }
    }

    private var classes: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Your classes")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip("Current", "current")
                    ForEach(terms, id: \.self) { chip($0, $0) }
                    chip("All", "all")
                }
            }
            if shownCourses.isEmpty && !store.loading {
                EmptyStateView(icon: "graduationcap", title: "No classes here", subtitle: termFilter == "current" ? "Try “All” for past and upcoming terms." : nil)
            } else {
                LazyVGrid(columns: cols, spacing: 16) {
                    ForEach(shownCourses) { c in
                        NavigationLink(value: c.id) { CourseCard(course: c) }.buttonStyle(.plain)
                    }
                }
            }
        }
        .navigationDestination(for: Int.self) { id in CourseView(courseId: id) }
    }

    private func chip(_ label: String, _ value: String) -> some View {
        Button { termFilter = value } label: {
            Text(label).font(.subheadline.weight(.medium))
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background(termFilter == value ? Color.accentColor.opacity(0.18) : Color.gray.opacity(0.1), in: Capsule())
                .overlay(Capsule().strokeBorder(termFilter == value ? Color.accentColor.opacity(0.5) : .clear))
        }.buttonStyle(.plain)
    }
}

struct CourseCard: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.colorScheme) var scheme
    let course: Course

    private var dueItems: [WorkItem] {
        store.work(for: course.id).filter { store.status($0) == .assigned && ($0.due.map { Fmt.daysFromToday($0) <= 14 } ?? false) }
            .sorted { ($0.due ?? .distantFuture) < ($1.due ?? .distantFuture) }
    }
    private var missing: Int { store.work(for: course.id).filter { store.status($0) == .missing }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                Theme.bannerGradient(course.hue, scheme == .dark).frame(height: 96)
                VStack(alignment: .leading, spacing: 2) {
                    Text(course.name).font(.title3.weight(.semibold)).foregroundStyle(.white).lineLimit(2)
                    Text([course.code, course.termLabel].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.white.opacity(0.9))
                }.padding(14)
            }
            VStack(alignment: .leading, spacing: 4) {
                if dueItems.isEmpty {
                    Text("No work due soon").font(.caption).foregroundStyle(.secondary).padding(.vertical, 4)
                } else {
                    ForEach(dueItems.prefix(3)) { w in
                        HStack(spacing: 8) {
                            Text(w.due.map { Fmt.daysFromToday($0) <= 0 ? "Today" : Fmt.short($0) } ?? "").font(.caption.weight(.medium)).foregroundStyle(Theme.accent(course.hue, scheme == .dark)).frame(width: 52, alignment: .leading)
                            Text(w.title).font(.caption).lineLimit(1)
                        }
                    }
                }
                if missing > 0 { Label("\(missing) missing", systemImage: "exclamationmark.circle").font(.caption.weight(.medium)).foregroundStyle(.red) }
            }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.gray.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.gray.opacity(0.15)))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

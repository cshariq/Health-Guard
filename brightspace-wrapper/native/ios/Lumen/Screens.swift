//  Screens.swift
//  To-do, Calendar, Grades overview, and Settings.

import SwiftUI

// MARK: - To-do
struct ToDoView: View {
    @EnvironmentObject var store: AppStore
    @State private var tab: WorkStatus = .assigned

    private var items: [WorkItem] { store.work.filter { store.status($0) == tab } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("", selection: $tab) {
                    Text("Assigned").tag(WorkStatus.assigned)
                    Text("Missing").tag(WorkStatus.missing)
                    Text("Done").tag(WorkStatus.done)
                }.pickerStyle(.segmented)

                if items.isEmpty {
                    EmptyStateView(icon: tab == .missing ? "checkmark.seal" : "checklist",
                                   title: tab == .missing ? "Nothing missing" : tab == .done ? "Nothing done yet" : "No work assigned",
                                   subtitle: tab == .assigned ? "New assignments, quizzes and readings appear here." : nil)
                } else {
                    ForEach(buckets(), id: \.0) { (label, list) in
                        VStack(alignment: .leading, spacing: 8) {
                            SectionHeader(title: label, count: list.count)
                            VStack(spacing: 0) {
                                ForEach(list) { WorkRowView(item: $0); Divider() }
                            }.background(Color.gray.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                        }
                    }
                }
            }.padding(16)
        }
        .navigationTitle("To-do")
        .refreshable { await store.load(force: true) }
    }

    private func buckets() -> [(String, [WorkItem])] {
        let sorted = items.sorted { ($0.due ?? .distantFuture) < ($1.due ?? .distantFuture) }
        let order = ["This week", "Next week", "Later", "No due date"]
        var map: [String: [WorkItem]] = [:]
        let dow = Calendar.current.component(.weekday, from: Date()) - 1
        for w in (tab == .assigned ? sorted : sorted.reversed()) {
            let key: String
            if let d = w.due {
                let n = Fmt.daysFromToday(d)
                if tab == .assigned { key = n <= (6 - dow) ? "This week" : n <= (6 - dow) + 7 ? "Next week" : "Later" }
                else { key = n >= -dow ? "This week" : "Earlier" }
            } else { key = "No due date" }
            map[key, default: []].append(w)
        }
        let keys = (tab == .assigned ? order : ["This week", "Earlier", "No due date"]).filter { map[$0] != nil }
        return keys.map { ($0, map[$0]!) }
    }
}

// MARK: - Calendar (week view)
struct CalendarView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.colorScheme) var scheme
    @State private var weekOffset = 0

    private var weekStart: Date {
        let cal = Calendar.current
        let start = cal.date(byAdding: .day, value: weekOffset * 7, to: cal.startOfDay(for: Date()))!
        return cal.date(byAdding: .day, value: -(cal.component(.weekday, from: start) - 1), to: start)!
    }
    private var days: [Date] { (0..<7).map { Calendar.current.date(byAdding: .day, value: $0, to: weekStart)! } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Button { weekOffset = 0 } label: { Text("Today") }.buttonStyle(.bordered)
                    Spacer()
                    Button { weekOffset -= 1 } label: { Image(systemName: "chevron.left") }
                    Text(weekStart.formatted(.dateTime.month(.abbreviated).day()) + " – " + days[6].formatted(.dateTime.month(.abbreviated).day())).font(.headline)
                    Button { weekOffset += 1 } label: { Image(systemName: "chevron.right") }
                }
                ForEach(days, id: \.self) { day in dayRow(day) }
            }.padding(16)
        }
        .navigationTitle("Calendar")
    }

    private func events(_ day: Date) -> [WorkItem] {
        let cal = Calendar.current
        return store.work.filter { if let d = $0.due { return cal.isDate(d, inSameDayAs: day) } ; return false }
            .sorted { ($0.due ?? .distantPast) < ($1.due ?? .distantPast) }
    }
    @ViewBuilder private func dayRow(_ day: Date) -> some View {
        let isToday = Calendar.current.isDateInToday(day)
        let evs = events(day)
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 2) {
                Text(day.formatted(.dateTime.weekday(.abbreviated))).font(.caption2).foregroundStyle(isToday ? .tint : .secondary)
                Text("\(Calendar.current.component(.day, from: day))").font(.title3.weight(.semibold))
                    .foregroundStyle(isToday ? Color.white : .primary)
                    .frame(width: 36, height: 36).background(isToday ? Color.accentColor : .clear, in: Circle())
            }.frame(width: 44)
            VStack(spacing: 6) {
                if evs.isEmpty { Text("—").foregroundStyle(.secondary.opacity(0.5)).frame(maxWidth: .infinity, alignment: .leading) }
                ForEach(evs) { w in
                    let c = store.course(w.courseId); let hue = c?.hue ?? Theme.seed
                    let st = store.status(w)
                    HStack(spacing: 8) {
                        Rectangle().fill(st == .missing ? Color.red : Theme.accent(hue, scheme == .dark)).frame(width: 3).clipShape(Capsule())
                        VStack(alignment: .leading, spacing: 1) {
                            Text(w.due.map { Fmt.time($0) } ?? "").font(.caption2.weight(.medium)).foregroundStyle(Theme.accent(hue, scheme == .dark))
                            Text(w.title).font(.caption).lineLimit(2).strikethrough(st == .done)
                            Text(c?.code ?? "").font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.accent(hue, scheme == .dark).opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                    .opacity(st == .done ? 0.6 : 1)
                }
            }
        }
        .padding(.vertical, 6)
        Divider()
    }
}

// MARK: - Grades overview
struct GradesOverviewView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Released grades across your current classes.").foregroundStyle(.secondary)
                ForEach(store.currentCourses) { c in
                    NavigationLink(value: c.id) { GradeSummaryCard(courseId: c.id) }.buttonStyle(.plain)
                }
                if store.currentCourses.isEmpty { EmptyStateView(icon: "chart.bar", title: "No current classes") }
            }.padding(16)
        }
        .navigationTitle("Grades")
        .navigationDestination(for: Int.self) { CourseView(courseId: $0) }
    }
}

struct GradeSummaryCard: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.colorScheme) var scheme
    let courseId: Int
    @State private var grades: Grades?

    var body: some View {
        let c = store.course(courseId); let hue = c?.hue ?? Theme.seed
        HStack(spacing: 16) {
            GradeRing(percent: grades?.finalPercent ?? grades?.current?.value, size: 72, color: Theme.accent(hue, scheme == .dark))
            VStack(alignment: .leading, spacing: 2) {
                Text(c?.name ?? "").font(.headline).lineLimit(2)
                Text(c?.code ?? "").font(.caption).foregroundStyle(.secondary)
                if let g = grades { Text("\(g.items.filter { $0.percent != nil }.count) graded item\(g.items.filter { $0.percent != nil }.count == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.gray.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        .overlay(alignment: .top) { Rectangle().fill(Theme.accent(hue, scheme == .dark)).frame(height: 4).clipShape(RoundedRectangle(cornerRadius: 2)) }
        .task(id: courseId) { grades = try? await store.api?.grades(courseId) }
    }
}

// MARK: - Settings
struct SettingsView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        Form {
            Section("Appearance") {
                Picker("Theme", selection: Binding(get: { store.themeMode }, set: { store.themeModeRaw = $0.rawValue })) {
                    Text("System").tag(ThemeMode.system); Text("Light").tag(ThemeMode.light); Text("Dark").tag(ThemeMode.dark)
                }
            }
            Section("Account") {
                if let me = store.me { LabeledContent("Signed in", value: "\(me.firstName) \(me.lastName)") }
                if let c = store.connection { LabeledContent("School", value: c.schoolName) }
                Button(role: .destructive) { store.signOut() } label: { Label("Disconnect", systemImage: "rectangle.portrait.and.arrow.right") }
            }
            if !store.courses.filter({ !$0.isCurrent || store.hiddenCourses.contains($0.id) }).isEmpty {
                Section("Hidden & past classes") {
                    ForEach(store.courses.filter { store.hiddenCourses.contains($0.id) }) { c in
                        Button { var h = store.hiddenCourses; h.remove(c.id); store.hiddenCourses = h; store.objectWillChange.send() } label: {
                            Label("Show \(c.name)", systemImage: "eye")
                        }
                    }
                }
            }
            Section {
                Text("Lumen reads your classes from Brightspace using the login on this device. It only reads — it never submits or changes anything. Hidden classes and items you tick off are stored on this device.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
    }
}

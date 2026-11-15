//  CourseView.swift
//  A single class: Stream (announcements), Classwork (content), Work, Grades.

import SwiftUI

struct CourseView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.colorScheme) var scheme
    let courseId: Int
    @State private var tab = 0

    private var course: Course? { store.course(courseId) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let course {
                    ZStack(alignment: .bottomLeading) {
                        Theme.bannerGradient(course.hue, scheme == .dark).frame(height: 150)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(course.name).font(.title.weight(.bold)).foregroundStyle(.white)
                            Text([course.code, course.termLabel].filter { !$0.isEmpty }.joined(separator: " · ")).foregroundStyle(.white.opacity(0.9))
                        }.padding(16)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 20))

                    Picker("", selection: $tab) {
                        Text("Stream").tag(0); Text("Classwork").tag(1); Text("Work").tag(2); Text("Grades").tag(3)
                    }.pickerStyle(.segmented)

                    switch tab {
                    case 1: ClassworkTab(courseId: courseId)
                    case 2: WorkTab(courseId: courseId)
                    case 3: GradesTab(courseId: courseId)
                    default: StreamTab(courseId: courseId)
                    }
                } else {
                    EmptyStateView(icon: "graduationcap", title: "Class not found")
                }
            }.padding(16)
        }
        .navigationTitle(course?.code ?? "Class")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .tint(Theme.accent(course?.hue ?? Theme.seed, scheme == .dark))
    }
}

// MARK: Stream
struct StreamTab: View {
    @EnvironmentObject var store: AppStore
    let courseId: Int
    @State private var news: [Announcement]?
    @State private var error: String?

    var body: some View {
        Group {
            if let error { inlineError(error) { await reload() } }
            else if let news {
                if news.isEmpty { EmptyStateView(icon: "megaphone", title: "No announcements yet") }
                else {
                    VStack(spacing: 14) {
                        ForEach(news) { n in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 12) {
                                    Image(systemName: "megaphone.fill").foregroundStyle(.white).frame(width: 36, height: 36).background(.tint, in: Circle())
                                    VStack(alignment: .leading) {
                                        Text(n.title).font(.subheadline.weight(.semibold))
                                        if let d = n.date { Text("\(Fmt.day(d)) · \(Fmt.relative(d))").font(.caption).foregroundStyle(.secondary) }
                                    }
                                    Spacer()
                                }
                                HTMLText(n.html, lineLimit: 12)
                                ForEach(n.attachments, id: \.url) { a in
                                    if let u = URL(string: a.url) { Link(destination: u) { Label(a.name, systemImage: "paperclip").font(.caption) } }
                                }
                            }
                            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.gray.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
                        }
                    }
                }
            } else { ProgressView().frame(maxWidth: .infinity).padding() }
        }
        .task(id: courseId) { await reload() }
    }
    private func reload() async {
        error = nil
        do { news = try await store.api?.news(courseId) ?? [] }
        catch let e as APIError { error = (e.isSignedOut ? "signed_out" : "\(e)") }
        catch { error = error.localizedDescription }
    }
}

// MARK: Classwork
struct ClassworkTab: View {
    @EnvironmentObject var store: AppStore
    let courseId: Int
    @State private var modules: [Module]?
    @State private var error: String?
    @State private var query = ""

    var body: some View {
        Group {
            if let error { inlineError(error) { await reload() } }
            else if let modules {
                if modules.isEmpty { EmptyStateView(icon: "books.vertical", title: "No content yet") }
                else {
                    VStack(spacing: 10) {
                        ForEach(filtered(modules)) { m in ModuleDisclosure(module: m, courseId: courseId, depth: 0, query: query) }
                    }
                }
            } else { ProgressView().frame(maxWidth: .infinity).padding() }
        }
        .searchable(text: $query, prompt: "Search this class’s content")
        .task(id: courseId) { await reload() }
    }
    private func filtered(_ ms: [Module]) -> [Module] { ms }   // filtering handled inside ModuleDisclosure
    private func reload() async {
        error = nil
        do { modules = try await store.api?.toc(courseId) ?? [] }
        catch let e as APIError { error = e.isSignedOut ? "signed_out" : "\(e)" }
        catch { error = error.localizedDescription }
    }
}

struct ModuleDisclosure: View {
    @EnvironmentObject var store: AppStore
    let module: Module; let courseId: Int; let depth: Int; let query: String
    @State private var expanded = false

    private func matches(_ t: Topic) -> Bool { query.isEmpty || t.title.localizedCaseInsensitiveContains(query) }
    private var visibleTopics: [Topic] { module.topics.filter(matches) }
    private var hasMatch: Bool { !query.isEmpty && (module.title.localizedCaseInsensitiveContains(query) || !visibleTopics.isEmpty || module.submodules.contains { !$0.topics.filter(matches).isEmpty }) }

    var body: some View {
        if query.isEmpty || hasMatch {
            VStack(spacing: 0) {
                Button { withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() } } label: {
                    HStack(spacing: 12) {
                        Image(systemName: depth == 0 ? "folder.fill" : "folder").foregroundStyle(.tint)
                        Text(module.title).font(depth == 0 ? .headline : .subheadline.weight(.medium)).multilineTextAlignment(.leading)
                        Spacer()
                        if module.unreadCount > 0 { Text("\(module.unreadCount) new").font(.caption2).padding(.horizontal, 7).padding(.vertical, 2).background(.tint.opacity(0.2), in: Capsule()) }
                        Text("\(module.totalCount)").font(.caption).foregroundStyle(.secondary)
                        Image(systemName: "chevron.down").font(.caption).foregroundStyle(.secondary).rotationEffect(.degrees(expanded || !query.isEmpty ? 180 : 0))
                    }.padding(.vertical, 10).contentShape(Rectangle())
                }.buttonStyle(.plain)

                if expanded || !query.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(visibleTopics) { t in TopicRow(topic: t) }
                        ForEach(module.submodules) { ModuleDisclosure(module: $0, courseId: courseId, depth: depth + 1, query: query) }
                    }.padding(.leading, depth == 0 ? 8 : 16)
                }
            }
            .padding(.horizontal, 14)
            .background(depth == 0 ? Color.gray.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 14))
        }
    }
}

struct TopicRow: View {
    let topic: Topic
    var body: some View {
        Link(destination: URL(string: topic.url) ?? URL(string: "https://d2l.com")!) {
            HStack(spacing: 12) {
                Image(systemName: topic.kind.symbol).foregroundStyle(.tint).frame(width: 32)
                VStack(alignment: .leading, spacing: 1) {
                    Text(topic.title).font(.callout).foregroundStyle(.primary).multilineTextAlignment(.leading)
                        .fontWeight(topic.unread ? .semibold : .regular)
                    Text(topic.kind.label + (topic.due.map { " · \(Fmt.due($0))" } ?? "")).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                if topic.locked { Image(systemName: "lock.fill").font(.caption).foregroundStyle(.secondary) }
                if topic.unread { Circle().fill(.tint).frame(width: 8, height: 8) }
            }.padding(.vertical, 8).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

// MARK: Work
struct WorkTab: View {
    @EnvironmentObject var store: AppStore
    let courseId: Int
    var body: some View {
        let items = store.work(for: courseId)
        if items.isEmpty {
            EmptyStateView(icon: "doc.text", title: "No assignments or quizzes")
        } else {
            let groups = Dictionary(grouping: items) { store.status($0) }
            VStack(alignment: .leading, spacing: 20) {
                group("Missing", groups[.missing]?.sorted { ($0.due ?? .distantPast) > ($1.due ?? .distantPast) })
                group("Upcoming", groups[.assigned]?.sorted { ($0.due ?? .distantFuture) < ($1.due ?? .distantFuture) })
                group("Done", groups[.done])
            }
        }
    }
    @ViewBuilder private func group(_ title: String, _ items: [WorkItem]?) -> some View {
        if let items, !items.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: title, count: items.count)
                VStack(spacing: 0) {
                    ForEach(items) { WorkRowView(item: $0, showCourse: false); Divider() }
                }.background(Color.gray.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }
}

// MARK: Grades
struct GradesTab: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.colorScheme) var scheme
    let courseId: Int
    @State private var grades: Grades?
    @State private var error: String?

    var body: some View {
        Group {
            if let error { inlineError(error) { await reload() } }
            else if let grades {
                if grades.items.isEmpty && grades.finalDisplay == nil { EmptyStateView(icon: "chart.bar", title: "No grades released yet") }
                else {
                    let hue = store.course(courseId)?.hue ?? Theme.seed
                    VStack(spacing: 16) {
                        HStack(spacing: 20) {
                            GradeRing(percent: grades.finalPercent ?? grades.current?.value, color: Theme.accent(hue, scheme == .dark))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(grades.finalDisplay != nil ? "Final grade" : (grades.current?.weighted == true ? "Current weighted grade" : "Average of released grades")).font(.subheadline).foregroundStyle(.secondary)
                                Text(grades.finalDisplay ?? grades.current.map { String(format: "%.1f%%", $0.value) } ?? "—").font(.title.weight(.bold))
                                Text("\(grades.items.filter { $0.percent != nil }.count) of \(grades.items.count) graded").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }.padding(16).background(Theme.container(hue, scheme == .dark), in: RoundedRectangle(cornerRadius: 20))

                        VStack(spacing: 0) {
                            ForEach(grades.items) { g in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(g.name).font(.callout.weight(.medium))
                                            if let w = g.weight, w > 0 { Text("Worth \(Int(w))%").font(.caption).foregroundStyle(.secondary) }
                                            if let c = g.comment { Text(c).font(.caption).foregroundStyle(.secondary).padding(6).background(Color.gray.opacity(0.1), in: RoundedRectangle(cornerRadius: 8)) }
                                        }
                                        Spacer()
                                        Text(gradeScore(g)).font(.callout.weight(.semibold).monospacedDigit())
                                    }
                                    if let p = g.percent {
                                        ProgressView(value: min(1, p / 100)).tint(Theme.accent(hue, scheme == .dark))
                                    }
                                }.padding(.vertical, 10).padding(.horizontal, 12)
                                Divider()
                            }
                        }.background(Color.gray.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                    }
                }
            } else { ProgressView().frame(maxWidth: .infinity).padding() }
        }
        .task(id: courseId) { await reload() }
    }
    private func gradeScore(_ g: GradeItem) -> String {
        if let n = g.numerator, let d = g.denominator { return "\(trim(n))/\(trim(d))" }
        return g.displayed ?? "—"
    }
    private func trim(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }
    private func reload() async {
        error = nil
        do { grades = try await store.api?.grades(courseId) }
        catch let e as APIError { error = e.isSignedOut ? "signed_out" : "\(e)" }
        catch { error = error.localizedDescription }
    }
}

// MARK: inline error helper
@ViewBuilder func inlineError(_ error: String, retry: @escaping () async -> Void) -> some View {
    VStack(spacing: 10) {
        Image(systemName: error == "signed_out" ? "lock.fill" : "wifi.slash").font(.largeTitle).foregroundStyle(.tint)
        Text(error == "signed_out" ? "Signed out of Brightspace" : "Couldn’t load").font(.headline)
        Button("Try again") { Task { await retry() } }.buttonStyle(.bordered)
    }.frame(maxWidth: .infinity).padding(30)
}

extension APIError { var isSignedOut: Bool { if case .signedOut = self { return true }; return false } }

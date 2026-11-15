//  Components.swift
//  Shared native views and formatting helpers.

import SwiftUI

enum Fmt {
    static func time(_ d: Date) -> String { d.formatted(date: .omitted, time: .shortened) }
    static func day(_ d: Date) -> String { d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) }
    static func short(_ d: Date) -> String { d.formatted(.dateTime.month(.abbreviated).day()) }

    static func daysFromToday(_ d: Date) -> Int {
        Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: Date()), to: Calendar.current.startOfDay(for: d)).day ?? 0
    }
    static func due(_ d: Date?, prefix: String = "Due") -> String {
        guard let d else { return "No due date" }
        let n = daysFromToday(d)
        if n == 0 { return "\(prefix) today, \(time(d))" }
        if n == 1 { return "\(prefix) tomorrow, \(time(d))" }
        if n == -1 { return "\(prefix) yesterday, \(time(d))" }
        if n > 1 && n < 7 { return "\(prefix) \(d.formatted(.dateTime.weekday(.wide))), \(time(d))" }
        return "\(prefix) \(day(d))"
    }
    static func relative(_ d: Date?) -> String {
        guard let d else { return "" }
        return RelativeDateTimeFormatter().localizedString(for: d, relativeTo: Date())
    }
}

/// Lightweight HTML → readable text (announcements, instructions). Avoids a WebView.
struct HTMLText: View {
    let html: String
    let lineLimit: Int?
    init(_ html: String, lineLimit: Int? = nil) { self.html = html; self.lineLimit = lineLimit }
    var body: some View {
        Text(Self.plain(html))
            .font(.callout)
            .lineLimit(lineLimit)
            .fixedSize(horizontal: false, vertical: true)
    }
    static func plain(_ html: String) -> String {
        var s = html
        s = s.replacingOccurrences(of: "(?i)<br\\s*/?>", with: "\n", options: .regularExpression)
        s = s.replacingOccurrences(of: "(?i)</p>|</li>|</div>|</h[1-6]>", with: "\n", options: .regularExpression)
        s = s.replacingOccurrences(of: "(?i)<li[^>]*>", with: "• ", options: .regularExpression)
        s = s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "&nbsp;", with: " ").replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">").replacingOccurrences(of: "&#39;", with: "'").replacingOccurrences(of: "&quot;", with: "\"")
        s = s.replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// A work item row with a done toggle (To-do and the course Work tab).
struct WorkRowView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.colorScheme) var scheme
    let item: WorkItem
    var showCourse = true

    var body: some View {
        let status = store.status(item)
        let course = store.course(item.courseId)
        let hue = course?.hue ?? Theme.seed
        HStack(spacing: 14) {
            // Tapping the body opens the item in Brightspace (if it has a URL).
            rowContent(status: status, course: course, hue: hue)
                .modifier(OptionalLink(url: item.url))
            Button {
                store.toggleDone(item)
            } label: {
                Image(systemName: status == .done ? "checkmark.circle.fill" : "circle")
                    .font(.title3).foregroundStyle(status == .done ? Color.green : .secondary)
            }.buttonStyle(.plain)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    @ViewBuilder private func rowContent(status: WorkStatus, course: Course?, hue: Double) -> some View {
        HStack(spacing: 14) {
            Image(systemName: item.kind.symbol)
                .foregroundStyle(status == .done ? Color.secondary : .white)
                .frame(width: 40, height: 40)
                .background(status == .done ? Color.gray.opacity(0.25) : Theme.accent(hue, scheme == .dark), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.body.weight(.medium)).lineLimit(1)
                    .foregroundStyle(status == .done ? .secondary : .primary)
                HStack(spacing: 6) {
                    if showCourse, let course { Text(course.code.isEmpty ? course.name : course.code).foregroundStyle(Theme.accent(hue, scheme == .dark)) ; Text("·") }
                    Text(item.kind.label)
                }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(status == .missing ? Fmt.due(item.due, prefix: "Was due") : status == .done ? "Done" : Fmt.due(item.due))
                .font(.caption).foregroundStyle(status.tint(scheme == .dark)).multilineTextAlignment(.trailing)
        }
        .contentShape(Rectangle())
    }
}

/// Wraps content in a Link when a URL exists, otherwise leaves it as-is.
struct OptionalLink: ViewModifier {
    let url: String?
    func body(content: Content) -> some View {
        if let url, let u = URL(string: url) {
            Link(destination: u) { content }.buttonStyle(.plain)
        } else { content }
    }
}

/// Circular grade ring.
struct GradeRing: View {
    let percent: Double?
    var size: CGFloat = 108
    var color: Color = .accentColor
    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.18), lineWidth: 10)
            Circle().trim(from: 0, to: min(1, (percent ?? 0) / 100))
                .stroke(color, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(percent == nil ? "—" : "\(Int(percent!.rounded()))%").font(.title3.weight(.semibold))
        }.frame(width: size, height: size)
    }
}

struct SectionHeader: View {
    let title: String
    var count: Int? = nil
    var body: some View {
        HStack(spacing: 8) {
            Text(title).font(.headline)
            if let count { Text("\(count)").font(.caption).padding(.horizontal, 7).padding(.vertical, 1).background(Color.gray.opacity(0.18), in: Capsule()) }
        }
    }
}

struct EmptyStateView: View {
    let icon: String; let title: String; var subtitle: String? = nil
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 44)).foregroundStyle(.tint).opacity(0.7)
            Text(title).font(.title3.weight(.medium))
            if let subtitle { Text(subtitle).foregroundStyle(.secondary).multilineTextAlignment(.center) }
        }.frame(maxWidth: .infinity).padding(.vertical, 40)
    }
}

/// Signed-out / error banner with a reconnect action.
struct LoadErrorView: View {
    let error: String
    let retry: () -> Void
    @EnvironmentObject var store: AppStore
    var body: some View {
        let signedOut = error == "signed_out"
        VStack(spacing: 10) {
            Image(systemName: signedOut ? "lock.fill" : "wifi.slash").font(.system(size: 44)).foregroundStyle(.tint)
            Text(signedOut ? "You’re signed out of Brightspace" : "Couldn’t load from Brightspace").font(.title3.weight(.medium))
            Text(signedOut ? "Sign in again to continue." : error).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button(signedOut ? "Sign in again" : "Try again") { signedOut ? store.signOut() : retry() }
                .buttonStyle(.borderedProminent)
        }.frame(maxWidth: .infinity).padding(40)
    }
}

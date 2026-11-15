//  Models.swift
//  Plain Swift models for the Brightspace data Lumen shows. Decoding from the raw
//  Valence JSON lives in BrightspaceAPI.swift; these are the clean shapes the UI uses.

import Foundation

enum WorkKind: String {
    case assignment, quiz, discussion, survey, content
    case pdf, slides, sheet, image, video, meeting, link, doc

    var symbol: String {
        switch self {
        case .assignment: return "doc.text"
        case .quiz: return "checkmark.circle"
        case .discussion: return "bubble.left.and.bubble.right"
        case .survey: return "list.bullet.clipboard"
        case .pdf: return "doc.richtext"
        case .slides: return "rectangle.on.rectangle"
        case .sheet: return "tablecells"
        case .image: return "photo"
        case .video: return "play.circle"
        case .meeting: return "video"
        case .link: return "link"
        case .content, .doc: return "doc"
        }
    }
    var label: String {
        switch self {
        case .assignment: return "Assignment"
        case .quiz: return "Quiz"
        case .discussion: return "Discussion"
        case .survey: return "Survey"
        case .content: return "Material"
        case .pdf: return "PDF"
        case .slides: return "Slides"
        case .sheet: return "Spreadsheet"
        case .image: return "Image"
        case .video: return "Video"
        case .meeting: return "Meeting"
        case .link: return "Link"
        case .doc: return "Document"
        }
    }
}

struct Me {
    var firstName: String
    var lastName: String
    var uniqueName: String
}

struct Course: Identifiable, Hashable {
    let id: Int
    var name: String
    var code: String
    var start: Date?
    var end: Date?
    var pinned: Bool
    var hasImage: Bool

    /// Assigned by position so neighbouring classes never share a color; falls back to a hash.
    var hueOverride: Double? = nil
    var hue: Double { hueOverride ?? Palette.hue(for: code.isEmpty ? name : code) }

    var termLabel: String {
        guard let d = start else {
            if let m = Self.termRegex.firstMatch(in: "\(name) \(code)") { return m }
            return "Other"
        }
        let c = Calendar.current
        let y = c.component(.year, from: d), mo = c.component(.month, from: d)
        if mo >= 9 { return "Fall \(y)" }
        if mo >= 5 { return "Summer \(y)" }
        return "Winter \(y)"
    }
    var termSort: Int {
        guard let d = start else { return 0 }
        let c = Calendar.current
        let y = c.component(.year, from: d), mo = c.component(.month, from: d)
        return y * 10 + (mo >= 9 ? 3 : mo >= 5 ? 2 : 1)
    }
    var isCurrent: Bool {
        let now = Date()
        if let s = start, s > now.addingTimeInterval(21 * 86400) { return false }
        if let e = end, e < now.addingTimeInterval(-7 * 86400) { return false }
        return true
    }

    private static let termRegex = TermMatcher()
}

/// Tiny helper to pull "Fall 2026" out of a name when no start date is given.
struct TermMatcher {
    func firstMatch(in s: String) -> String? {
        let pattern = "(?i)(fall|winter|summer|spring)\\s*(20\\d\\d)"
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              let tr = Range(m.range(at: 1), in: s), let yr = Range(m.range(at: 2), in: s) else { return nil }
        return "\(s[tr].capitalized) \(s[yr])"
    }
}

enum WorkStatus { case assigned, missing, done }

struct WorkItem: Identifiable, Hashable {
    let id: String            // stable key
    var courseId: Int
    var kind: WorkKind
    var title: String
    var due: Date?
    var url: String?
    var completed: Bool

    func status(doneOverride: Bool?) -> WorkStatus {
        if doneOverride ?? completed { return .done }
        if let d = due, d < Date() { return .missing }
        return .assigned
    }
}

struct Announcement: Identifiable, Hashable {
    let id: Int
    var title: String
    var html: String
    var date: Date?
    var attachments: [Attachment]
}

struct Attachment: Hashable { var name: String; var url: String }

struct Topic: Identifiable, Hashable {
    let id: Int
    var title: String
    var kind: WorkKind
    var url: String          // viewUrl into Brightspace
    var unread: Bool
    var due: Date?
    var locked: Bool
}

struct Module: Identifiable, Hashable {
    let id: Int
    var title: String
    var descriptionHTML: String
    var submodules: [Module]
    var topics: [Topic]

    var totalCount: Int { topics.count + submodules.reduce(0) { $0 + $1.totalCount } }
    var unreadCount: Int { topics.filter { $0.unread }.count + submodules.reduce(0) { $0 + $1.unreadCount } }
}

struct GradeItem: Identifiable, Hashable {
    let id: String
    var name: String
    var displayed: String?
    var numerator: Double?
    var denominator: Double?
    var weight: Double?
    var weightedAchieved: Double?
    var comment: String?

    var percent: Double? {
        guard let n = numerator, let d = denominator, d > 0 else { return nil }
        return n / d * 100
    }
}

struct Grades {
    var items: [GradeItem]
    var finalDisplay: String?
    var finalPercent: Double?

    /// Weighted current grade when every released item carries a weight, else a plain average.
    var current: (value: Double, weighted: Bool)? {
        let graded = items.filter { $0.percent != nil }
        guard !graded.isEmpty else { return nil }
        let weighted = graded.filter { ($0.weight ?? 0) > 0 && $0.weightedAchieved != nil }
        if weighted.count == graded.count {
            let total = weighted.reduce(0.0) { $0 + ($1.weight ?? 0) }
            let got = weighted.reduce(0.0) { $0 + ($1.weightedAchieved ?? 0) }
            return total > 0 ? (got / total * 100, true) : nil
        }
        return (graded.reduce(0.0) { $0 + ($1.percent ?? 0) } / Double(graded.count), false)
    }
}

enum APIError: Error { case signedOut, http(Int), network(String), badURL }
extension APIError { var isSignedOut: Bool { if case .signedOut = self { return true }; return false } }

/// Course colors: a stable hue per class, matching the web and Android apps.
enum Palette {
    static let seed: Double = 265
    static let distinct: [Double] = [265, 150, 30, 230, 340, 85, 195, 300, 10, 120, 250, 60]

    static func hue(for key: String) -> Double {
        var x: UInt32 = 2166136261
        for b in key.utf8 { x = (x ^ UInt32(b)) &* 16777619 }
        let palette: [Double] = [265, 200, 150, 30, 340, 85, 230, 300, 175, 10, 120, 250]
        return palette[Int(x % UInt32(palette.count))]
    }
    /// Give every class its own color, stable by id.
    static func withDistinctHues(_ courses: [Course]) -> [Course] {
        let order = courses.map(\.id).sorted()
        return courses.map { c in var c = c; c.hueOverride = distinct[(order.firstIndex(of: c.id) ?? 0) % distinct.count]; return c }
    }
}

/// HTML → readable plain text (announcements, instructions), so the UI never needs a web view for them.
enum PlainText {
    static func from(html: String) -> String {
        var s = html
        s = s.replacingOccurrences(of: "(?i)<br\\s*/?>", with: "\n", options: .regularExpression)
        s = s.replacingOccurrences(of: "(?i)</p>|</li>|</div>|</h[1-6]>", with: "\n", options: .regularExpression)
        s = s.replacingOccurrences(of: "(?i)<li[^>]*>", with: "• ", options: .regularExpression)
        s = s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        for (a, b) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&#39;", "'"), ("&quot;", "\""), ("&amp;", "&")] { s = s.replacingOccurrences(of: a, with: b) }
        s = s.replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Drop duplicates the feed can return for the same item.
func dedupeWork(_ items: [WorkItem]) -> [WorkItem] {
    var seen = Set<String>(); var out: [WorkItem] = []
    for w in items {
        let k = "\(w.courseId):\(w.kind.rawValue):\(w.title):\(w.due?.timeIntervalSince1970 ?? 0)"
        if seen.insert(k).inserted { out.append(w) }
    }
    return out
}

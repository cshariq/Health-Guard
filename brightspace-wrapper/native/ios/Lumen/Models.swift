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

    var hue: Double { Theme.hue(for: code.isEmpty ? name : code) }

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

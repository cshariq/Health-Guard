//  BrightspaceAPI.swift
//  Native, read-only client for the Brightspace (D2L Valence) REST API.
//
//  Auth is the session cookie the user created by signing in on the official
//  Brightspace page (or a Lumen Classes server) in the app's login web view. The app
//  hands this client a `cookieProvider` that reads it from the web view's cookie store;
//  native HTTP isn't bound by the browser's CORS rules, so this works where a website
//  can't. Nothing is ever written back.
//
//  This file is platform-neutral (no UIKit/WebKit) so it also builds and is tested on Linux.

import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

actor BrightspaceAPI {
    private let host: String                      // e.g. https://brightspace.carleton.ca
    private let session: URLSession
    private var versions: [String: String] = [:]
    private var cache: [String: (Date, Any)] = [:]

    private let cookieProvider: @Sendable (String) async -> String

    /// - Parameter cookieProvider: returns the `Cookie` header value for the given host.
    init(host: String, cookieProvider: @escaping @Sendable (String) async -> String) {
        self.cookieProvider = cookieProvider
        self.host = host.hasSuffix("/") ? String(host.dropLast()) : host
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: cfg)
    }

    func clearCache() { cache.removeAll() }
    /// The cookie header currently in use (for tests and diagnostics).
    func debugCookie() async -> String { await cookieProvider(host) }

    // MARK: core GET
    private func get(_ path: String, cache useCache: Bool = true) async throws -> Any {
        if useCache, let hit = cache[path], Date().timeIntervalSince(hit.0) < 300 { return hit.1 }
        guard let url = URL(string: host + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let cookie = await cookieProvider(host)
        if !cookie.isEmpty { req.setValue(cookie, forHTTPHeaderField: "Cookie") }
        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw APIError.network("No response") }
            let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
            if http.statusCode == 401 || http.statusCode == 403 { throw APIError.signedOut }
            if http.statusCode == 200, type.contains("text/html") { throw APIError.signedOut } // redirected to login
            guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
            let json = try JSONSerialization.jsonObject(with: data)
            if useCache { cache[path] = (Date(), json) }
            return json
        } catch let e as APIError { throw e }
        catch { throw APIError.network(error.localizedDescription) }
    }

    // MARK: version discovery
    private func version(_ product: String) async -> String {
        if let v = versions[product] { return v }
        if let list = try? await get("/d2l/api/versions/") as? [[String: Any]] {
            for v in list { if let p = v["ProductCode"] as? String, let lv = v["LatestVersion"] as? String { versions[p] = lv } }
        }
        return versions[product] ?? (product == "lp" ? "1.35" : "1.60")
    }
    private func lp(_ p: String) async -> String { "/d2l/api/lp/\(await version("lp"))\(p)" }
    private func le(_ p: String) async -> String { "/d2l/api/le/\(await version("le"))\(p)" }

    // MARK: endpoints
    func whoami() async throws -> Me {
        let d = try await get(await lp("/users/whoami")) as? [String: Any] ?? [:]
        return Me(firstName: d["FirstName"] as? String ?? "",
                  lastName: d["LastName"] as? String ?? "",
                  uniqueName: d["UniqueName"] as? String ?? "")
    }

    func courses() async throws -> [Course] {
        var path: String? = await lp("/enrollments/myenrollments/?orgUnitTypeId=3&sortBy=-StartDate")
        var items: [[String: Any]] = []
        var guardCount = 0
        while let p = path, guardCount < 15 {
            guardCount += 1
            let page = try await get(p) as? [String: Any] ?? [:]
            items += page["Items"] as? [[String: Any]] ?? []
            if let pi = page["PagingInfo"] as? [String: Any],
               (pi["HasMoreItems"] as? Bool) == true, let bm = pi["Bookmark"] as? String, !bm.isEmpty,
               var comps = URLComponents(string: host + p) {
                var q = comps.queryItems ?? []
                q.removeAll { $0.name == "bookmark" }
                q.append(URLQueryItem(name: "bookmark", value: bm))
                comps.queryItems = q
                path = (comps.path) + "?" + (comps.percentEncodedQuery ?? "")
            } else { path = nil }
        }
        return items.compactMap { e in
            guard let ou = e["OrgUnit"] as? [String: Any], let id = ou["Id"] as? Int else { return nil }
            let access = e["Access"] as? [String: Any]
            if let can = access?["CanAccess"] as? Bool, !can { return nil }
            let pin = (e["PinSettings"] as? [String: Any])?["IsPinned"] as? Bool ?? false
            return Course(id: id,
                          name: ou["Name"] as? String ?? "Course",
                          code: ou["Code"] as? String ?? "",
                          start: Dates.parse(access?["StartDate"]),
                          end: Dates.parse(access?["EndDate"]),
                          pinned: pin,
                          hasImage: ou["ImageUrl"] != nil && !(ou["ImageUrl"] is NSNull))
        }
    }

    func news(_ ou: Int) async throws -> [Announcement] {
        let list = try await get(await le("/\(ou)/news/")) as? [[String: Any]] ?? []
        return list.filter { ($0["IsHidden"] as? Bool) != true }.map { n in
            Announcement(id: n["Id"] as? Int ?? Int.random(in: 1...1_000_000),
                         title: n["Title"] as? String ?? "",
                         html: Rich.html(n["Body"]),
                         date: Dates.parse(n["StartDate"]) ?? Dates.parse(n["CreatedDate"]),
                         attachments: (n["Attachments"] as? [[String: Any]] ?? []).compactMap { a in
                            guard let fid = a["FileId"] else { return nil }
                            return Attachment(name: a["FileName"] as? String ?? "file",
                                              url: "\(host)/d2l/le/news/\(ou)/\(n["Id"] as? Int ?? 0)/attachment/\(fid)")
                         })
        }.sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
    }

    func toc(_ ou: Int) async throws -> [Module] {
        let data = try await get(await le("/\(ou)/content/toc")) as? [String: Any] ?? [:]
        func mapModule(_ m: [String: Any]) -> Module {
            Module(id: m["ModuleId"] as? Int ?? 0,
                   title: m["Title"] as? String ?? "",
                   descriptionHTML: Rich.html(m["Description"]),
                   submodules: (m["Modules"] as? [[String: Any]] ?? []).filter { ($0["IsHidden"] as? Bool) != true }.map(mapModule),
                   topics: (m["Topics"] as? [[String: Any]] ?? []).filter { ($0["IsHidden"] as? Bool) != true }.map { t in
                        Topic(id: t["TopicId"] as? Int ?? 0,
                              title: t["Title"] as? String ?? "",
                              kind: Kind.ofTopic(url: t["Url"] as? String ?? "", typeId: t["TypeIdentifier"] as? String ?? ""),
                              url: "\(host)/d2l/le/content/\(ou)/viewContent/\(t["TopicId"] as? Int ?? 0)/View",
                              unread: (t["Unread"] as? Bool) == true,
                              due: Dates.parse(t["DueDateTime"]),
                              locked: (t["IsLocked"] as? Bool) == true)
                   })
        }
        return (data["Modules"] as? [[String: Any]] ?? []).filter { ($0["IsHidden"] as? Bool) != true }.map(mapModule)
    }

    func grades(_ ou: Int) async throws -> Grades {
        async let valuesTask = try? get(await le("/\(ou)/grades/values/myGradeValues/"))
        async let finalTask = try? get(await le("/\(ou)/grades/final/values/myGradeValue"))
        let values = await valuesTask as? [[String: Any]] ?? []
        let final = await finalTask as? [String: Any]
        let items = values.map { g in
            GradeItem(id: (g["GradeObjectIdentifier"] as? String) ?? UUID().uuidString,
                      name: g["GradeObjectName"] as? String ?? "",
                      displayed: g["DisplayedGrade"] as? String,
                      numerator: Nums.d(g["PointsNumerator"]),
                      denominator: Nums.d(g["PointsDenominator"]),
                      weight: Nums.d(g["WeightedDenominator"]),
                      weightedAchieved: Nums.d(g["WeightedNumerator"]),
                      comment: Rich.text(g["Comments"]))
        }
        var fp: Double? = nil
        if let n = Nums.d(final?["PointsNumerator"]), let d = Nums.d(final?["PointsDenominator"]), d > 0 { fp = n / d * 100 }
        return Grades(items: items, finalDisplay: final?["DisplayedGrade"] as? String, finalPercent: fp)
    }

    /// Everything with a date across the given courses, with completion state.
    func workItems(courseIds: [Int]) async throws -> [WorkItem] {
        guard !courseIds.isEmpty else { return [] }
        let start = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-45 * 86400))
        let end = ISO8601DateFormatter().string(from: Date().addingTimeInterval(120 * 86400))
        let csv = courseIds.map(String.init).joined(separator: ",")
        let first = await le("/content/myItems/?orgUnitIdsCSV=\(csv)&startDateTime=\(start)&endDateTime=\(end)")
        if let objs = (try? await get(first)) as? [String: Any], let list = objs["Objects"] as? [[String: Any]] {
            return list.map { it in
                let kind = Kind.ofScheduled(url: it["ItemUrl"] as? String ?? "")
                let ou = it["OrgUnitId"] as? Int ?? 0
                let urlStr = (it["ItemUrl"] as? String).map { host + $0 }
                return WorkItem(id: "s:\(ou):\(it["ItemId"] as? Int ?? 0):\(kind.rawValue)",
                                courseId: ou, kind: kind, title: it["ItemName"] as? String ?? "",
                                due: Dates.parse(it["DueDate"]) ?? Dates.parse(it["EndDate"]),
                                url: urlStr,
                                completed: it["DateCompleted"] != nil && !(it["DateCompleted"] is NSNull) || (it["IsExempt"] as? Bool) == true)
            }
        }
        // Fallback: assignments + quizzes per course.
        var out: [WorkItem] = []
        for ou in courseIds {
            if let folders = try? await get(await le("/\(ou)/dropbox/folders/")) as? [[String: Any]] {
                for f in folders where (f["IsHidden"] as? Bool) != true {
                    out.append(WorkItem(id: "a:\(ou):\(f["Id"] as? Int ?? 0)", courseId: ou, kind: .assignment,
                                        title: f["Name"] as? String ?? "",
                                        due: Dates.parse(f["DueDate"]) ?? Dates.parse((f["Availability"] as? [String: Any])?["EndDate"]),
                                        url: "\(host)/d2l/lms/dropbox/user/folder_submit_files.d2l?db=\(f["Id"] as? Int ?? 0)&ou=\(ou)",
                                        completed: false))
                }
            }
            if let q = try? await get(await le("/\(ou)/quizzes/")) as? [String: Any], let objs = q["Objects"] as? [[String: Any]] {
                for quiz in objs where (quiz["IsActive"] as? Bool) != false {
                    out.append(WorkItem(id: "q:\(ou):\(quiz["QuizId"] as? Int ?? 0)", courseId: ou, kind: .quiz,
                                        title: quiz["Name"] as? String ?? "",
                                        due: Dates.parse(quiz["DueDate"]) ?? Dates.parse(quiz["EndDate"]),
                                        url: "\(host)/d2l/lms/quizzing/user/quiz_summary.d2l?qi=\(quiz["QuizId"] as? Int ?? 0)&ou=\(ou)",
                                        completed: false))
                }
            }
        }
        return out
    }
}

// MARK: - decoding helpers
enum Dates {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let plain = ISO8601DateFormatter()
    static func parse(_ any: Any?) -> Date? {
        guard let s = any as? String, !s.isEmpty else { return nil }
        return withFraction.date(from: s) ?? plain.date(from: s)
    }
}
enum Nums {
    static func d(_ any: Any?) -> Double? {
        if let v = any as? Double { return v }
        if let v = any as? Int { return Double(v) }
        if let v = any as? String { return Double(v) }
        return nil
    }
}
enum Rich {
    static func html(_ any: Any?) -> String {
        guard let d = any as? [String: Any] else { return "" }
        return (d["Html"] as? String) ?? (d["Text"] as? String) ?? ""
    }
    static func text(_ any: Any?) -> String? {
        guard let d = any as? [String: Any] else { return nil }
        let s = (d["Text"] as? String) ?? (d["Html"] as? String) ?? ""
        return s.isEmpty ? nil : s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
    }
}
enum Kind {
    static func ofTopic(url: String, typeId: String) -> WorkKind {
        let u = url.lowercased()
        if u.contains("quiz") { return .quiz }
        if u.contains("dropbox") { return .assignment }
        if u.contains("discussion") { return .discussion }
        if u.range(of: "\\.pdf($|\\?)", options: .regularExpression) != nil { return .pdf }
        if u.range(of: "\\.(pptx?|key)($|\\?)", options: .regularExpression) != nil { return .slides }
        if u.range(of: "\\.(xlsx?|csv)($|\\?)", options: .regularExpression) != nil { return .sheet }
        if u.range(of: "\\.(png|jpe?g|gif|svg|webp)($|\\?)", options: .regularExpression) != nil { return .image }
        if u.range(of: "\\.(mp4|mov|webm|m4v)($|\\?)|youtube|youtu\\.be|vimeo|kaltura|mediaspace", options: .regularExpression) != nil { return .video }
        if u.contains("zoom.us") || u.contains("teams.microsoft") { return .meeting }
        if typeId.lowercased() == "link" || u.hasPrefix("http") { return .link }
        return .doc
    }
    static func ofScheduled(url: String) -> WorkKind {
        let u = url.lowercased()
        if u.contains("dropbox") || u.contains("assignment") { return .assignment }
        if u.contains("quiz") { return .quiz }
        if u.contains("discussion") { return .discussion }
        if u.contains("survey") { return .survey }
        return .content
    }
}

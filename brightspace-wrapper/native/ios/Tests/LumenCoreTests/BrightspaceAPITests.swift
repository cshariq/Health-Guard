//  Runs the real BrightspaceAPI against:
//    • the fake Brightspace      node demo/mock-server.mjs              (LUMEN_MOCK_HOST, default :8091)
//    • a Lumen Classes server    node classes/server.mjs (fresh data)   (LUMEN_CLASSES_HOST, default :8200)
//  Each group skips itself when its server isn't running.
import XCTest
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import LumenCore

/// A session with no shared cookie jar, so each test user's cookie is exactly what we send.
private let plain: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.httpShouldSetCookies = false; c.httpCookieAcceptPolicy = .never
    return URLSession(configuration: c)
}()

private func reachable(_ url: String) async -> Bool {
    guard let u = URL(string: url) else { return false }
    var r = URLRequest(url: u); r.timeoutInterval = 2
    return ((try? await plain.data(for: r)) != nil)
}

final class MockBrightspaceTests: XCTestCase {
    let host = ProcessInfo.processInfo.environment["LUMEN_MOCK_HOST"] ?? "http://127.0.0.1:8091"
    func api(cookie: String = "d2lSessionVal=ok") -> BrightspaceAPI { BrightspaceAPI(host: host) { _ in cookie } }

    override func setUp() async throws {
        let up = await reachable(host + "/d2l/api/versions/")
        try XCTSkipUnless(up, "Start the mock first: node demo/mock-server.mjs")
    }

    func testSignedOutIsDetected() async {
        do { _ = try await api(cookie: "").whoami(); XCTFail("expected signedOut") }
        catch let e as APIError { XCTAssertTrue(e.isSignedOut) } catch { XCTFail("\(error)") }
    }

    func testWhoami() async throws {
        let me = try await api().whoami()
        XCTAssertEqual(me.firstName, "Alex"); XCTAssertEqual(me.lastName, "Rivera")
    }

    func testCourses() async throws {
        let cs = try await api().courses()
        XCTAssertEqual(cs.count, 8)
        let comp = try XCTUnwrap(cs.first { $0.code == "COMP 2402" })
        XCTAssertEqual(comp.name, "Abstract Data Types and Algorithms")
        XCTAssertTrue(comp.pinned); XCTAssertFalse(comp.hasImage, "ImageUrl is JSON null")
        XCTAssertEqual(cs.filter(\.isCurrent).count, 6)
        XCTAssertNotNil(comp.termLabel.range(of: #"^(Fall|Summer|Winter) \d{4}$"#, options: .regularExpression))
        let colored = Palette.withDistinctHues(cs.filter(\.isCurrent))
        XCTAssertEqual(Set(colored.map(\.hue)).count, colored.count, "every current class gets its own color")
    }

    func testWorkItems() async throws {
        let a = api()
        let ids = try await a.courses().filter(\.isCurrent).map(\.id)
        let work = dedupeWork(try await a.workItems(courseIds: ids))
        XCTAssertEqual(work.count, 16)
        XCTAssertEqual(work.first { $0.title.hasPrefix("Quiz 4") }?.kind, .quiz)
        XCTAssertEqual(work.first { $0.title.hasPrefix("Assignment 3") }?.kind, .assignment)
        XCTAssertEqual(work.first { $0.title.hasPrefix("Discussion: Sleep") }?.kind, .discussion)
        XCTAssertEqual(work.filter(\.completed).count, 3)
        let missing = Set(work.filter { $0.status(doneOverride: nil) == .missing }.map(\.title))
        // ("Quiz 4" is due at 6 pm today in the sample data, so it joins this set in the evening.)
        XCTAssertEqual(missing.subtracting(["Quiz 4 – Priority queues"]), ["WeBWorK Set 5: Matrix inverses", "Discussion: Sleep and learning"])
        XCTAssertTrue(work.first { $0.title.hasPrefix("Quiz 4") }!.url!.hasPrefix(host))
        XCTAssertEqual(work.first { $0.title.hasPrefix("WeBWorK Set 5") }!.status(doneOverride: true), .done)
    }

    func testAnnouncements() async throws {
        let news = try await api().news(101)
        XCTAssertEqual(news.count, 3)
        XCTAssertEqual(news[0].title, "Assignment 3 is posted")
        XCTAssertEqual(news[0].attachments.first?.name, "a3-starter.zip")
        XCTAssertTrue(zip(news, news.dropFirst()).allSatisfy { $0.date! >= $1.date! }, "newest first")
        let text = PlainText.from(html: news[0].html)
        XCTAssertTrue(text.contains("skip lists and hashing") && text.contains("• Due: Friday 11:59 pm"), text)
        XCTAssertFalse(text.contains("<"))
    }

    func testContentTree() async throws {
        let mods = try await api().toc(101)
        XCTAssertEqual(mods.count, 5)
        let week9 = try XCTUnwrap(mods.first { $0.title.hasPrefix("Week 9") })
        XCTAssertEqual(week9.submodules.count, 1); XCTAssertEqual(week9.unreadCount, 3); XCTAssertEqual(week9.totalCount, 5)
        let all = mods.flatMap { $0.topics + $0.submodules.flatMap(\.topics) }
        func kind(_ t: String) -> WorkKind? { all.first { $0.title.hasPrefix(t) }?.kind }
        XCTAssertEqual(kind("Course outline"), .pdf); XCTAssertEqual(kind("Weekly schedule"), .sheet)
        XCTAssertEqual(kind("Lecture 17 slides"), .slides); XCTAssertEqual(kind("Lecture 17 recording"), .video)
        XCTAssertEqual(kind("Heap visualizer"), .link); XCTAssertEqual(kind("Quiz 4"), .quiz); XCTAssertEqual(kind("Assignment 3"), .assignment)
        XCTAssertEqual(all.first { $0.title == "Midterm solutions" }?.locked, true)
    }

    func testGrades() async throws {
        let g = try await api().grades(101)
        XCTAssertEqual(g.items.count, 6); XCTAssertNil(g.finalDisplay)
        let cur = try XCTUnwrap(g.current)
        XCTAssertTrue(cur.weighted); XCTAssertEqual(cur.value, 81.69, accuracy: 0.05)
        XCTAssertEqual(try XCTUnwrap(g.items.first { $0.name == "Assignment 1" }?.percent), 92.5, accuracy: 0.001)
        let none = try await api().grades(104)
        XCTAssertTrue(none.items.isEmpty); XCTAssertNil(none.current)
    }
}

/// The same client against Lumen Classes: sign up over HTTP, build a class, then read it natively.
final class LumenClassesTests: XCTestCase {
    let host = ProcessInfo.processInfo.environment["LUMEN_CLASSES_HOST"] ?? "http://127.0.0.1:8200"

    /// Minimal JSON POST that keeps the session cookie (what the app's login web view does for real).
    final class Web {
        let host: String; var cookie = ""
        init(_ host: String) { self.host = host }
        @discardableResult func post(_ path: String, _ body: [String: Any]) async throws -> [String: Any] {
            var r = URLRequest(url: URL(string: host + path)!); r.httpMethod = "POST"
            r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue("1", forHTTPHeaderField: "X-Lumen")
            if !cookie.isEmpty { r.setValue(cookie, forHTTPHeaderField: "Cookie") }
            r.httpShouldHandleCookies = false
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, resp) = try await plain.data(for: r)
            let http = resp as! HTTPURLResponse
            if let set = http.value(forHTTPHeaderField: "Set-Cookie"), let first = set.split(separator: ";").first { cookie = String(first) }
            XCTAssertLessThan(http.statusCode, 300, "\(path) → \(http.statusCode) \(String(data: data, encoding: .utf8) ?? "")")
            return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        }
    }

    func testNativeClientReadsALumenClassesServer() async throws {
        let up = await reachable(host + "/healthz")
        try XCTSkipUnless(up, "Start it first: node classes/server.mjs")
        let tag = String(UInt32.random(in: 0 ..< .max))
        let teacher = Web(host), student = Web(host)
        try await teacher.post("/api/auth/register", ["name": "Tess Teacher", "email": "tess\(tag)@example.com", "password": "correct horse"])
        let created = try await teacher.post("/api/classes", ["name": "Physics 12 \(tag)", "code": "Block A"])
        let classId = try XCTUnwrap(created["id"] as? Int)
        try await teacher.post("/api/classes/\(classId)/announcements", ["title": "Welcome", "body": "Bring a calculator.\n\nhttps://example.com/outline"])
        let madeModule = try await teacher.post("/api/classes/\(classId)/modules", ["title": "Kinematics"])
        let mod = try XCTUnwrap(madeModule["id"] as? Int)
        try await teacher.post("/api/classes/\(classId)/topics", ["kind": "link", "title": "Video", "url": "https://youtube.com/watch?v=x", "moduleId": mod])
        let due = ISO8601DateFormatter().string(from: Date().addingTimeInterval(2 * 86400))
        let madeAssignment = try await teacher.post("/api/classes/\(classId)/assignments", ["title": "Lab report", "due": due, "points": 20, "moduleId": mod])
        let asg = try XCTUnwrap(madeAssignment["id"] as? Int)
        try await teacher.post("/api/classes/\(classId)/quizzes", ["title": "Vectors quiz", "moduleId": mod, "questions": [["prompt": "2+2?", "choices": ["3", "4"], "answer": 1, "points": 5]]])

        // What the teacher's People tab shows as the join code:
        var r = URLRequest(url: URL(string: host + "/api/classes/\(classId)")!); r.setValue(teacher.cookie, forHTTPHeaderField: "Cookie"); r.httpShouldHandleCookies = false
        let info = try JSONSerialization.jsonObject(with: try await plain.data(for: r).0) as! [String: Any]
        try await student.post("/api/auth/register", ["name": "Sam Student", "email": "sam\(tag)@example.com", "password": "battery staple"])
        try await student.post("/api/classes/join", ["joinCode": info["joinCode"] as! String])
        XCTAssertTrue(student.cookie.hasPrefix("d2lSessionVal="), "session cookie is named so the app's login detection works unchanged")

        // ---- the native client, exactly as the app uses it ----
        let cookie = student.cookie
        let api = BrightspaceAPI(host: host) { _ in cookie }
        let me = try await api.whoami()
        XCTAssertEqual(me.firstName, "Sam")
        let courses = try await api.courses()
        let course = try XCTUnwrap(courses.first { $0.id == classId })
        XCTAssertEqual(course.name, "Physics 12 \(tag)"); XCTAssertEqual(course.code, "Block A"); XCTAssertTrue(course.isCurrent)
        let news = try await api.news(classId)
        XCTAssertEqual(news.first?.title, "Welcome")
        XCTAssertTrue(PlainText.from(html: news[0].html).contains("Bring a calculator."))
        let toc = try await api.toc(classId)
        XCTAssertEqual(toc.first?.title, "Kinematics")
        XCTAssertEqual(toc.first?.topics.map(\.title), ["Video", "Lab report", "Vectors quiz"])
        XCTAssertEqual(toc.first?.topics.map(\.kind), [.video, .assignment, .quiz])
        var work = try await api.workItems(courseIds: [classId])
        XCTAssertEqual(Set(work.map(\.title)), ["Lab report", "Vectors quiz"])
        XCTAssertTrue(work.allSatisfy { !$0.completed && $0.status(doneOverride: nil) == .assigned })
        XCTAssertEqual(work.first { $0.title == "Lab report" }?.kind, .assignment)
        XCTAssertEqual(work.first { $0.title == "Lab report" }?.url, "\(host)/#/c/\(classId)/assignment/\(asg)", "opens the hand-in page in the in-app browser")

        // Student hands in and gets graded (in the app this happens in the in-app web sheet).
        try await student.post("/api/classes/\(classId)/assignments/\(asg)/submit", ["text": "My report"])
        let studentId = try await studentIdentifier(api)
        try await teacher.post("/api/classes/\(classId)/assignments/\(asg)/grade", ["studentId": studentId, "grade": 17, "feedback": "Clear method."])
        await api.clearCache()
        work = try await api.workItems(courseIds: [classId])
        XCTAssertEqual(work.first { $0.title == "Lab report" }?.completed, true, "handed-in work shows as done after a refresh")
        let grades = try await api.grades(classId)
        XCTAssertEqual(grades.items.map(\.name), ["Lab report"])
        XCTAssertEqual(grades.items[0].numerator, 17); XCTAssertEqual(grades.items[0].denominator, 20)
        XCTAssertEqual(grades.items[0].comment, "Clear method.")
        XCTAssertEqual(try XCTUnwrap(grades.current).value, 85, accuracy: 0.01)

        // Signed out → the app is told to show the login again.
        do { _ = try await BrightspaceAPI(host: host) { _ in "" }.whoami(); XCTFail("expected signedOut") }
        catch let e as APIError { XCTAssertTrue(e.isSignedOut) }
    }

    private func studentIdentifier(_ api: BrightspaceAPI) async throws -> Int {
        // whoami's Identifier is the account id on Lumen Classes.
        var r = URLRequest(url: URL(string: host + "/d2l/api/lp/1.47/users/whoami")!)
        r.setValue(await api.debugCookie(), forHTTPHeaderField: "Cookie"); r.httpShouldHandleCookies = false
        let d = try JSONSerialization.jsonObject(with: try await plain.data(for: r).0) as! [String: Any]
        return Int(d["Identifier"] as! String)!
    }
}

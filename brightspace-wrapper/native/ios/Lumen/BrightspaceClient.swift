//  BrightspaceClient.swift
//  Read-only Valence API calls, authenticated with the cookies from the WebView.

import Foundation
import WebKit

struct BrightspaceClient {
    /// GET a Brightspace API URL, attaching the session cookies the WebView holds.
    /// Native HTTP isn't subject to the browser's same-origin / CORS rules, which is
    /// exactly why the app can do what a plain website can't.
    func get(_ urlString: String, cookieStore: WKHTTPCookieStore) async -> [String: Any] {
        guard let url = URL(string: urlString), let host = url.host else {
            return ["status": 0, "error": "bad_request"]
        }
        // Only ever call the Valence API, never other paths.
        guard url.path.hasPrefix("/d2l/api/") else { return ["status": 403, "error": "forbidden"] }

        let cookies = await cookieStore.allCookies()
        let header = cookies
            .filter { host.hasSuffix($0.domain) || $0.domain.hasSuffix(host) }
            .map { "\($0.name)=\($0.value)" }
            .joined(separator: "; ")

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if !header.isEmpty { req.setValue(header, forHTTPHeaderField: "Cookie") }

        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse else { return ["status": 0, "error": "network"] }
            let contentType = http.value(forHTTPHeaderField: "Content-Type") ?? ""

            // Brightspace sends signed-out API calls to the login page (HTML) — treat as 401.
            if (http.statusCode == 200), contentType.contains("text/html") {
                return ["status": 401, "contentType": "application/json", "body": NSNull()]
            }

            var result: [String: Any] = ["status": http.statusCode, "contentType": contentType]
            if contentType.contains("json"), let obj = try? JSONSerialization.jsonObject(with: data) {
                result["body"] = obj
            } else {
                result["body"] = String(data: data, encoding: .utf8) ?? ""
            }
            return result
        } catch {
            return ["status": 0, "error": "network", "message": error.localizedDescription]
        }
    }
}

extension WKHTTPCookieStore {
    func allCookies() async -> [HTTPCookie] {
        await withCheckedContinuation { cont in
            getAllCookies { cont.resume(returning: $0) }
        }
    }
}

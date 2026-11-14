import Foundation
import WebKit

/// Serves the bundled `web/` folder (a folder reference to ../../web) at band39care://app/… so the page can load
/// ES modules (three.js, the Vexo Open kit): WKWebView refuses module imports from file:// URLs.
/// `api/…` requests only land here when no server is set in Settings; they get a JSON error the page can show.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "band39care"
    private let root: URL? = Bundle.main.url(forResource: "web", withExtension: nil)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let clean = path.split(separator: "/").filter { $0 != ".." && $0 != "." }.joined(separator: "/")
        if clean.hasPrefix("api/") {
            return respond(task, url, 503, "application/json",
                           Data(#"{"error":"No server set. Add your Band 39 server in Settings (Simulator tab, gear button).","offline":true}"#.utf8))
        }
        guard let root = root else { return respond(task, url, 500, "text/plain", Data("web folder missing".utf8)) }
        let file = root.appendingPathComponent(clean)
        guard file.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path),
              let data = try? Data(contentsOf: file) else { return respond(task, url, 404, "text/plain", Data("not found".utf8)) }
        respond(task, url, 200, Self.mime(file.pathExtension), data)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, _ url: URL, _ code: Int, _ type: String, _ data: Data) {
        let headers = ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        let response = HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "txt", "md": return "text/plain; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "opus", "ogg": return "audio/ogg"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        default: return "application/octet-stream"
        }
    }
}

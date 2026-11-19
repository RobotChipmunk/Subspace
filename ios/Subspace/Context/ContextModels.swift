import SwiftUI
import Observation

// Shapes only the Context area reads (see src/lib/core/context.ts, links.ts and discover.ts).

/// One step of the breadcrumb trail.
struct ContextCrumb: Codable, Identifiable, Hashable {
    let id: String
    var path: String?
    var title: String
}

/// GET `context` and `context?node=<id>`: the node (nil at the root), its trail and what is inside it.
struct ContextTree: Codable {
    var node: ContextNode?
    var trail: [ContextCrumb]?
    var children: [ContextNode]?
    /// At the top of the tree: what is true for now, soonest to end first.
    var current: [ContextCurrentNote]?
}

/// GET `pages`.
struct ContextPagesReply: Codable {
    var pages: [ContextNode]
}

/// GET `links`: one page of saved links, newest first.
struct ContextLinkPage: Codable {
    var links: [ContextNode]
    var next: String?
    var total: Int?
}

/// One search result. `type` is "post", "todo", "context", "link" or "tracker".
struct ContextHit: Codable, Identifiable, Hashable {
    let id: String
    var type: String
    var title: String?
    var path: String?
    var snippet: String?
    var at: String?
    var url: String?
    var site: String?
    var why: String?
}

struct ContextSearchReply: Codable {
    var results: [ContextHit]
}

/// What the owner can change in a note.
struct ContextDraft: Equatable {
    var title: String
    var summary: String
    var body: String
}

/// Shows an address the way people say it: no scheme, no www, no trailing slash.
func contextBareURL(_ url: String) -> String {
    var s = url.replacingOccurrences(of: "^https?://(www\\.)?", with: "", options: .regularExpression)
    if s.hasSuffix("/") { s.removeLast() }
    return s
}

/// "home/travel/portland" becomes "home › travel": where something lives, without its own name.
func contextParentPath(_ path: String?) -> String {
    guard let path else { return "" }
    var parts = path.replacingOccurrences(of: "/context/", with: "").split(separator: "/").map { String($0) }
    if !parts.isEmpty { parts.removeLast() }
    return parts.joined(separator: " › ")
}

/// The page or note a link inside a body points at ("/page/<id>" or "/context?node=<id>"), if any.
func contextPageID(from url: URL, base: URL?) -> String? {
    if let host = url.host, let baseHost = base?.host, host != baseHost { return nil }
    if url.host != nil, base == nil { return nil }
    let path = url.path
    if path.hasPrefix("/page/") {
        let rest = String(path.dropFirst(6))
        let id = rest.components(separatedBy: "/").first ?? ""
        return id.isEmpty ? nil : id
    }
    if path == "/context" || path == "/context/" {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: true)?.queryItems ?? []
        let id = items.first(where: { $0.name == "node" })?.value ?? ""
        return id.isEmpty ? nil : id
    }
    return nil
}

/// Saves what is being typed a moment after typing stops (the web app's `useSaver`). Saves never
/// overlap: while one is on its way the next waits, so a slow connection cannot deliver an older
/// version after a newer one. Only the fields that changed are sent.
@MainActor
final class ContextSaver {
    private var latest: ContextDraft?
    private var saved: ContextDraft?
    private var timer: Task<Void, Never>?
    private var running: Task<Void, Never>?
    private var api: API?
    private var nodeID: String = ""

    var onSaved: ((ContextNode) -> Void)?
    var onError: ((String) -> Void)?

    /// True while something typed here is still waiting to be saved.
    var dirty: Bool { latest != nil }

    func start(api: API, nodeID: String, baseline: ContextDraft) {
        self.api = api
        self.nodeID = nodeID
        if saved == nil { saved = baseline }
    }

    func push(_ draft: ContextDraft) {
        if latest == nil, let saved, saved == draft { return }
        latest = draft
        timer?.cancel()
        timer = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            if Task.isCancelled { return }
            self?.flush()
        }
    }

    /// Saves now whatever is waiting.
    func flush() {
        timer?.cancel()
        timer = nil
        if running != nil || latest == nil { return }
        running = Task { [weak self] in
            guard let self else { return }
            await self.drain()
        }
    }

    /// Forgets what is waiting (the note is being removed).
    func drop() {
        timer?.cancel()
        timer = nil
        latest = nil
    }

    private func drain() async {
        while let draft = latest {
            do {
                let node = try await send(draft)
                saved = draft
                if latest == draft { latest = nil }
                if let node { onSaved?(node) }
            } catch {
                // left dirty: the next keystroke, or leaving, tries again
                onError?(error.localizedDescription)
                break
            }
        }
        running = nil
    }

    private func send(_ draft: ContextDraft) async throws -> ContextNode? {
        guard let api, !nodeID.isEmpty else { return nil }
        var body: [String: Any] = [:]
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty, title != saved?.title { body["title"] = title }
        if draft.summary != saved?.summary { body["summary"] = draft.summary }
        if draft.body != saved?.body { body["body"] = draft.body }
        if body.isEmpty { return nil }
        let node: ContextNode = try await api.send("PATCH", "context/\(nodeID)", body: body)
        return node
    }
}

/// Saved links a page at a time, newest first: everywhere, or inside one area.
@MainActor
@Observable
final class ContextLinkStore {
    var links: [ContextNode] = []
    var total = 0
    var next: String?
    var loaded = false
    var busy = false

    private func path(parent: String?, before: String?) -> String {
        var parts: [String] = []
        if let parent { parts.append("parent=" + q(parent)) }
        if let before { parts.append("before=" + q(before)) }
        return "links?" + parts.joined(separator: "&")
    }

    /// The first page. With `merge`, pages already scrolled to are kept and only refreshed in place.
    func refresh(api: API, parent: String?, merge: Bool) async {
        guard let page: ContextLinkPage = try? await api.get(path(parent: parent, before: nil)) else { return }
        if Task.isCancelled { return }
        total = page.total ?? page.links.count
        if merge && loaded && links.count > page.links.count {
            let fresh = Set(page.links.map { $0.id })
            let older = links.filter { !fresh.contains($0.id) && $0.id < (page.links.last?.id ?? "") }
            links = page.links + older
        } else {
            links = page.links
            next = page.next
        }
        loaded = true
    }

    func loadMore(api: API, parent: String?) async {
        guard !busy, let before = next else { return }
        busy = true
        if let page: ContextLinkPage = try? await api.get(path(parent: parent, before: before)) {
            let have = Set(links.map { $0.id })
            links.append(contentsOf: page.links.filter { !have.contains($0.id) })
            next = page.next
            total = page.total ?? total
        }
        busy = false
    }
}

import SwiftUI
import Observation

enum AppTab: String, CaseIterable, Identifiable {
    case feed, todos, journal, ideas, context, following, agents
    var id: String { rawValue }

    var label: String {
        switch self {
        case .feed: return "Feed"
        case .todos: return "Todos"
        case .journal: return "Journal"
        case .ideas: return "Ideas"
        case .context: return "Context"
        case .following: return "Following"
        case .agents: return "Agents"
        }
    }

    /// SF Symbol standing in for the web app's icon.
    var icon: String {
        switch self {
        case .feed: return "sparkle"
        case .todos: return "checkmark.circle"
        case .journal: return "square.and.pencil"
        case .ideas: return "lightbulb"
        case .context: return "book"
        case .following: return "dot.radiowaves.left.and.right"
        case .agents: return "person.2"
        }
    }
}

/// A page opened over whatever is on screen.
struct PageTarget: Identifiable, Hashable {
    let id: String
}

/// Everything the whole app shares: the session, who is who, the rail, and where to go.
@MainActor
@Observable
final class AppModel {
    let api = API()

    // Session
    var signedIn = false
    var server: String

    // Shared data, refreshed in the background
    var me: Agent?
    var agents: [Agent] = []
    var guests: [Agent] = []
    var trackers: [Tracker] = []
    var direct: [String: String] = [:]
    var rail: [RailModule] = []
    /// Modules kept on screen for a moment after an action of theirs was sent.
    @ObservationIgnored private var railHeld: Set<String> = []

    // Navigation
    var tab: AppTab = .feed
    /// A page shown as a sheet over the current screen. `PageView(pageID:)` draws it.
    var presentedPage: PageTarget?
    /// A task the todos screen should open as soon as it can; it clears this once it has.
    var pendingTodoID: String?
    /// A journal entry the journal screen should open as soon as it can; it clears this once it has.
    var pendingJournalID: String?
    /// An idea to open on the Ideas screen, set by an address that names one.
    var pendingIdeaID: String?
    var railSheet = false
    /// True while the feed's comments panel is open beside it; the docked rail steps aside.
    var commentsBeside = false

    /// Which direct conversations have been read is remembered on this device.
    private(set) var directSeen: [String: String]

    private var poll: Task<Void, Never>?
    private var sentTimezone: String?

    init() {
        let env = ProcessInfo.processInfo.environment
        let defaults = UserDefaults.standard
        if env["SUBSPACE_RESET"] == "1" {
            Keychain.write("token", nil)
            defaults.removeObject(forKey: "server")
            defaults.removeObject(forKey: "direct_seen")
            defaults.removeObject(forKey: TodosStore.hideDoneKey)
        }
        // UI tests that are not about sign-in start with a session already in hand.
        #if DEBUG
        if let token = env["SUBSPACE_TOKEN"], !token.isEmpty { Keychain.write("token", token) }
        #endif
        server = env["SUBSPACE_SERVER"] ?? defaults.string(forKey: "server") ?? ""
        directSeen = (defaults.dictionary(forKey: "direct_seen") as? [String: String]) ?? [:]
        api.baseURL = Self.url(for: server)
        api.token = Keychain.read("token")
        signedIn = api.token != nil && api.baseURL != nil
        api.onUnauthorized = { [weak self] in self?.signOut() }
        Notifier.shared.model = self
        if signedIn { start() }
    }

    /// Accepts what people type: "my.subspace.app", "localhost:3000", "https://…".
    static func url(for text: String) -> URL? {
        var s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.contains("://") {
            let local = s.hasPrefix("localhost") || s.hasPrefix("127.") || s.hasPrefix("192.168.") || s.hasPrefix("10.") || s.hasSuffix(".local") || s.contains(".local:")
            s = (local ? "http://" : "https://") + s
        }
        while s.hasSuffix("/") { s.removeLast() }
        guard let u = URL(string: s + "/"), u.host != nil else { return nil }
        return u
    }

    func signIn(server: String, password: String) async throws {
        guard let url = Self.url(for: server) else { throw APIError(status: 0, message: "Enter the address of your Subspace.") }
        api.baseURL = url
        api.token = nil
        let reply: JSONValue = try await api.send("POST", "auth/login", body: ["password": password])
        guard let token = reply["token"]?.string else { throw APIError(status: 0, message: "Sign-in did not finish. Try again.") }
        api.token = token
        Keychain.write("token", token)
        self.server = server
        UserDefaults.standard.set(server, forKey: "server")
        withAnimation(.ssSoft) { signedIn = true }
        start()
        Task { await Notifier.shared.sendToken() }
    }

    func signOut() {
        poll?.cancel()
        poll = nil
        Notifier.shared.forgetDevice(server: api.baseURL, session: api.token)
        api.token = nil
        Keychain.write("token", nil)
        me = nil
        agents = []
        guests = []
        trackers = []
        direct = [:]
        rail = []
        Notifier.shared.reset()
        presentedPage = nil
        railSheet = false
        tab = .feed
        withAnimation(.ssSoft) { signedIn = false }
    }

    /// Keeps the shared data fresh while signed in, every 30 seconds like the web app.
    private func start() {
        poll?.cancel()
        poll = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                // Until the first answer arrives, try again soon: without it nobody has a name.
                let waiting = self?.me == nil
                try? await Task.sleep(for: .seconds(waiting ? 3 : 30))
            }
        }
    }

    func refresh() async {
        async let a: Void = refreshMe()
        async let b: Void = refreshRail()
        _ = await (a, b)
    }

    func refreshMe() async {
        guard signedIn, let r: MeResponse = try? await api.get("me") else { return }
        me = r.me
        agents = r.agents
        guests = r.guests ?? []
        trackers = r.trackers ?? []
        direct = r.direct ?? [:]
        // Todos follow the owner's local calendar, so keep the server in step with this device.
        let tz = TimeZone.current.identifier
        if sentTimezone != tz {
            sentTimezone = tz
            try? await api.send("PATCH", "me", body: ["timezone": tz])
        }
    }

    func refreshRail() async {
        struct R: Codable {
            var modules: [RailModule]
            /// The sets of buttons modules have carried lately, as notification categories.
            var button_sets: [String]?
        }
        guard signedIn, let r: R = try? await api.get("rail") else { return }
        // a module whose action was just sent stays where it is until the owner has been shown so
        var next = r.modules
        for (index, module) in rail.enumerated() where railHeld.contains(module.id) && !next.contains(where: { $0.id == module.id }) {
            next.insert(module, at: min(index, next.count))
        }
        if next != rail { withAnimation(.ssSoft) { rail = next } }
        if rail.isEmpty { railSheet = false }
        await Notifier.shared.railChanged(r.modules, buttonSets: r.button_sets ?? [])
    }

    func dismissRail(_ id: String) async {
        withAnimation(.ssSoft) { rail.removeAll { $0.id == id } }
        try? await api.send("DELETE", "rail/\(id)")
        await refreshRail()
    }

    /// One of a module's buttons was tapped (an action, its page, its task, or "Got it"). That is
    /// what it was there for, so it leaves the rail at once; its author is told which button.
    func railActed(_ module: RailModule, label: String) async {
        withAnimation(.ssSoft) { rail.removeAll { $0.id == module.id } }
        try? await api.send("POST", "rail/\(module.id)/action", body: ["label": label])
        await refreshRail()
    }

    /// One of a module's buttons sends an action to the agent that raised it. Answers with who it
    /// went to as soon as the server has it (the agent may pick it up now or later), or nil when
    /// it could not be sent. The module stays in the rail until `railSentShown`.
    func railSend(_ module: RailModule, label: String) async -> String? {
        railHeld.insert(module.id)
        guard let reply = try? await api.send("POST", "rail/\(module.id)/action", body: ["label": label], as: RailActedReply.self) else {
            railHeld.remove(module.id)
            return nil
        }
        return reply.sent?.to?.name ?? "the agent"
    }

    /// The owner has been shown that it was sent: the module can go.
    func railSentShown(_ id: String) async {
        railHeld.remove(id)
        withAnimation(.ssSoft) { rail.removeAll { $0.id == id } }
        await refreshRail()
    }

    /// "Later": the module becomes a task on that day ("today", "tomorrow", "week") and leaves the rail.
    func railLater(_ module: RailModule, view: String) async {
        withAnimation(.ssSoft) { rail.removeAll { $0.id == module.id } }
        try? await api.send("POST", "rail/\(module.id)/later", body: ["view": view])
        await refreshRail()
    }

    /// Anyone by id: the owner, an agent or a guest.
    func agent(_ id: String?) -> Agent? {
        guard let id else { return nil }
        return agents.first { $0.id == id } ?? guests.first { $0.id == id }
    }

    func tracker(_ id: String?) -> Tracker? {
        guard let id else { return nil }
        return trackers.first { $0.id == id }
    }

    /// Lower-case handles that count as a mention.
    var handles: [String] { agents.map { $0.handle.lowercased() } }

    /// The most serious thing waiting in the rail: "error", "warning" or "info".
    var railLevel: String {
        if rail.contains(where: { $0.level == "error" }) { return "error" }
        if rail.contains(where: { $0.level == "warning" }) { return "warning" }
        return "info"
    }

    // Direct messages: unread marks

    func directUnread(_ agentID: String) -> Bool {
        guard let at = direct[agentID] else { return false }
        return at > (directSeen[agentID] ?? "")
    }

    var anyDirectUnread: Bool { direct.keys.contains { directUnread($0) } }

    func markDirectRead(_ agentID: String, at: String) {
        guard (directSeen[agentID] ?? "") < at else { return }
        directSeen[agentID] = at
        UserDefaults.standard.set(directSeen, forKey: "direct_seen")
    }

    // Links

    /// Opens an address from content: a page ("/page/<id>"), a task ("/todos?open=<id>"), a journal
    /// entry ("/journal?entry=<id>"), an idea ("/ideas?idea=<id>"),
    /// another screen ("/feed") or the web, which opens in the viewer inside the app.
    func open(_ link: String) {
        if link.hasPrefix("/page/") {
            let id = String(link.dropFirst(6)).components(separatedBy: CharacterSet(charactersIn: "?#/")).first ?? ""
            if !id.isEmpty { presentedPage = PageTarget(id: id) }
            return
        }
        if link.hasPrefix("/todos") {
            if let id = URLComponents(string: link)?.queryItems?.first(where: { $0.name == "open" })?.value { pendingTodoID = id }
            railSheet = false
            presentedPage = nil
            withAnimation(.ssSpring) { tab = .todos }
            return
        }
        if link.hasPrefix("/journal") {
            if let id = URLComponents(string: link)?.queryItems?.first(where: { $0.name == "entry" })?.value, !id.isEmpty { pendingJournalID = id }
            railSheet = false
            presentedPage = nil
            withAnimation(.ssSpring) { tab = .journal }
            return
        }
        if link.hasPrefix("/ideas") {
            if let id = URLComponents(string: link)?.queryItems?.first(where: { $0.name == "idea" })?.value, !id.isEmpty { pendingIdeaID = id }
            railSheet = false
            presentedPage = nil
            withAnimation(.ssSpring) { tab = .ideas }
            return
        }
        if link.hasPrefix("/"), let t = AppTab(rawValue: String(link.dropFirst()).components(separatedBy: CharacterSet(charactersIn: "?#/")).first ?? "") {
            railSheet = false
            presentedPage = nil
            withAnimation(.ssSpring) { tab = t }
            return
        }
        if let url = api.resolve(link) { WebViewer.open(url) }
    }
}

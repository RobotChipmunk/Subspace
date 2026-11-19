import SwiftUI
import UIKit

struct AgentsTokenReply: Decodable {
    var token: String
}

struct AgentsPasscodeReply: Decodable {
    var passcode: String
}

/// An app that has signed in for an agent or person (src/lib/core/oauth.ts, `Grant`).
struct AgentsGrant: Decodable, Identifiable, Equatable {
    let id: String
    var client_name: String?
    var client_host: String?
    var read_only: Bool?
    var created_at: String?
    var last_used_at: String?
}

struct AgentsConnectionsReply: Decodable {
    var connections: [AgentsGrant]
}

/// The server's address without a trailing slash, as the web page's `location.origin`.
func agentsOrigin(_ api: API) -> String {
    var s = api.baseURL?.absoluteString ?? ""
    while s.hasSuffix("/") { s.removeLast() }
    return s
}

/// "3h" becomes "3h ago"; "now" and dates stay as they are.
func agentsAgoPhrase(_ iso: String?) -> String {
    let s = ago(iso)
    guard let unit = s.last, "mhd".contains(unit) else { return s }
    let digits = s.dropLast()
    guard !digits.isEmpty, digits.allSatisfy({ $0.isNumber }) else { return s }
    return s + " ago"
}

/// A small section heading in capitals.
struct AgentsSectionLabel: View {
    var text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .medium))
            .tracking(0.6)
            .foregroundStyle(Theme.ink3)
    }
}

/// A value to copy with one tap: an address, a token, a passcode.
struct AgentsCopyField: View {
    var label: String
    var value: String
    var identifier: String

    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            AgentsSectionLabel(label)
            Button {
                copy()
            } label: {
                HStack(spacing: 8) {
                    Text(value)
                        .font(.system(size: 12.5, design: .monospaced))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 14))
                        .foregroundStyle(copied ? Theme.accent : Theme.ink3)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(minHeight: 40)
                .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(PressStyle(scale: 0.98))
            .accessibilityLabel("Copy \(label)")
            .accessibilityValue(value)
            .accessibilityIdentifier(identifier)
        }
    }

    private func copy() {
        UIPasteboard.general.string = value
        withAnimation(.ssSpring) { copied = true }
        Task {
            try? await Task.sleep(for: .milliseconds(1600))
            withAnimation(.ssSpring) { copied = false }
        }
    }
}

/// "Confirm once more": for a step that is not a deletion but cannot be taken back. The first tap
/// turns the button red and names the consequence; the second does it; it calms after three seconds.
struct AgentsConfirm: View {
    var label: String
    var sure: String
    var action: () async -> Void

    @State private var asking = false
    @State private var busy = false
    @State private var calm: Task<Void, Never>? = nil

    var body: some View {
        Button {
            tap()
        } label: {
            Text(asking ? sure : label)
                .font(.system(size: 13, weight: asking ? .medium : .regular))
                .foregroundStyle(asking ? Color.white : Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .background(asking ? Theme.danger : Theme.fill2, in: Capsule())
                .opacity(busy ? 0.6 : 1)
                .contentShape(Capsule())
        }
        .buttonStyle(PressStyle())
        .onDisappear { calm?.cancel() }
    }

    private func tap() {
        guard !busy else { return }
        if !asking {
            withAnimation(.ssSpring) { asking = true }
            calm?.cancel()
            calm = Task {
                try? await Task.sleep(for: .seconds(3))
                if !Task.isCancelled {
                    withAnimation(.ssSpring) { asking = false }
                }
            }
            return
        }
        calm?.cancel()
        withAnimation(.ssSpring) { asking = false }
        busy = true
        Task {
            await action()
            busy = false
        }
    }
}

/// The apps that have signed in for this agent or person. Each can be cut off on its own.
struct AgentsConnections: View {
    var id: String
    var empty: String

    @Environment(AppModel.self) private var app
    @State private var list: [AgentsGrant]? = nil

    var body: some View {
        let visible = app.tab == .agents
        VStack(alignment: .leading, spacing: 4) {
            AgentsSectionLabel("Connected apps")
            box
        }
        .task(id: visible) {
            guard visible else { return }
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }

    private var box: some View {
        let grants = list ?? []
        return VStack(alignment: .leading, spacing: 0) {
            if grants.isEmpty {
                Text(list == nil ? "…" : empty)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.ink3)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(grants) { grant in
                    AgentsGrantRow(grant: grant) { await disconnect(grant.id) }
                }
            }
        }
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func load() async {
        do {
            let r = try await app.api.get("agents/\(id)/connections", as: AgentsConnectionsReply.self)
            if list != r.connections {
                withAnimation(.ssSoft) { list = r.connections }
            }
        } catch {
            // Keep what is shown; the next round tries again.
        }
    }

    private func disconnect(_ grantID: String) async {
        do {
            try await app.api.send("DELETE", "connections/\(grantID)")
        } catch {
            // The list below shows whether it is still connected.
        }
        await load()
    }
}

struct AgentsGrantRow: View {
    var grant: AgentsGrant
    var onDisconnect: () async -> Void

    private var name: String {
        let given = grant.client_name ?? ""
        return given.isEmpty ? (grant.client_host ?? "App") : given
    }

    private var detail: String {
        let host = grant.client_host ?? ""
        let approved = "approved " + agentsAgoPhrase(grant.created_at)
        let used = grant.last_used_at == nil ? "not used yet" : "last used " + agentsAgoPhrase(grant.last_used_at)
        return [host, approved, used].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 8) {
                    Text(name)
                        .font(.system(size: 13.5, weight: .medium))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    if grant.read_only == true {
                        Text("Read only")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.ink2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Theme.fill2, in: Capsule())
                    }
                }
                Text(detail)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            ConfirmDelete(label: "Disconnect \(name)", confirm: "Disconnect", size: 15) {
                await onDisconnect()
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .accessibilityIdentifier("agents.connection.\(grant.id)")
    }
}

/// A small pill beside a name: "Realtime", "Illustrator" in accent; "Read only" quietly.
struct AgentsBadge: View {
    var icon: String
    var text: String
    var quiet: Bool = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold))
            Text(text).font(.system(size: 11.5, weight: .medium))
        }
        .foregroundStyle(quiet ? Theme.ink2 : Theme.accent)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(quiet ? Theme.fill : Theme.accentSoft, in: Capsule())
    }
}

/// The "Connect" / "Done" pill that opens a row's details.
struct AgentsConnectButton: View {
    var open: Bool
    /// Quiet once something has connected; accent while it still needs setting up.
    var settled: Bool
    var identifier: String
    var action: () -> Void

    var body: some View {
        let ink: Color = open ? Theme.bg : (settled ? Theme.ink2 : Color.white)
        let fill: Color = open ? Theme.ink : (settled ? Theme.fill : Theme.accent)
        Button(action: action) {
            Text(open ? "Done" : "Connect")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(ink)
                .padding(.horizontal, 14)
                .frame(minHeight: 36)
                .background(fill, in: Capsule())
        }
        .buttonStyle(PressStyle(scale: 0.95))
        .accessibilityIdentifier(identifier)
    }
}

/// An answer the owner sent to an agent from one of its rail modules.
struct AgentsSentAnswer: Decodable, Identifiable, Hashable {
    let id: String
    var agent_id: String?
    var title: String?
    var label: String?
    var at: String?
    /// True once the agent has read far enough to have seen it.
    var picked_up: Bool?
}

struct AgentsSentReply: Decodable {
    var sent: [AgentsSentAnswer]?
}

/// One agent: who it is, what it does, and the ways to reach and set it up.
struct AgentsAgentRow: View {
    var agent: Agent
    /// What the owner has answered this agent from the rail, newest first.
    var sent: [AgentsSentAnswer] = []
    var open: Bool
    var onToggle: () -> Void
    var onChat: () -> Void

    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var bio: String
    @State private var token: String? = nil
    @State private var realtime = false
    @State private var scripts = false
    @State private var problem = ""
    @FocusState private var bioFocused: Bool

    init(agent: Agent, sent: [AgentsSentAnswer] = [], open: Bool, onToggle: @escaping () -> Void, onChat: @escaping () -> Void) {
        self.agent = agent
        self.sent = sent
        self.open = open
        self.onToggle = onToggle
        self.onChat = onChat
        _bio = State(initialValue: agent.bio ?? "")
    }

    private var live: Bool { agent.runtime?["enabled"]?.bool ?? false }
    /// Answers this agent has not read yet.
    private var waiting: Int { sent.filter { $0.picked_up != true }.count }
    private var illustrator: Bool { (agent.roles ?? []).contains("illustrator") }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if realtime {
                AgentsRealtime(agent: agent).transition(.opacity)
            }
            if open {
                connect.transition(.opacity)
            }
            if !problem.isEmpty {
                Text(problem).font(.ssMeta).foregroundStyle(Theme.danger).padding(.top, 8)
            }
        }
        .padding(14)
        .glass(radius: 24, lifted: open || realtime)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agents.row.\(agent.id)")
        .onChange(of: bioFocused) { _, now in
            if !now { saveBio() }
        }
        .onChange(of: agent.bio) { _, now in
            if !bioFocused { bio = now ?? "" }
        }
    }

    // MARK: Header

    private var header: some View {
        let wide = sizeClass == .regular
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                AvatarView(agent: agent)
                VStack(alignment: .leading, spacing: 2) {
                    nameLine
                    bioField
                }
                if wide { controls(wide: true) }
            }
            if !wide {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    controls(wide: false)
                }
            }
        }
    }

    private var nameLine: some View {
        FlowRow(spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(agent.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text("@" + agent.handle)
                    .font(.ssSecondary)
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
            }
            if live { AgentsBadge(icon: "bolt.fill", text: "Realtime") }
            if illustrator { AgentsBadge(icon: "wand.and.stars", text: "Illustrator") }
            if waiting > 0 {
                Text("\(waiting) waiting")
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Theme.fill, in: Capsule())
                    .accessibilityIdentifier("agents.waiting.\(agent.id)")
            }
            if let access = agent.access {
                AgentsBadge(icon: "eye", text: access.read_only == true ? "Read only" : "Limited", quiet: true)
                    .accessibilityIdentifier("agents.access.badge.\(agent.id)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture { onToggle() }
    }

    private var bioField: some View {
        TextField("What does this agent do?", text: $bio)
            .font(.system(size: 14))
            .foregroundStyle(bioFocused ? Theme.ink : Theme.ink2)
            .focused($bioFocused)
            .submitLabel(.done)
            .onSubmit { bioFocused = false }
            .accessibilityLabel("What this agent does")
            .accessibilityIdentifier("agents.bio.\(agent.id)")
    }

    private func controls(wide: Bool) -> some View {
        HStack(spacing: 8) {
            chatButton
            realtimeButton
            if wide, let seen = agent.last_seen_at {
                Text("Active " + ago(seen))
                    .font(.ssMeta)
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
                    .fixedSize()
            }
            AgentsConnectButton(open: open, settled: agent.last_seen_at != nil, identifier: "agents.connect.\(agent.id)", action: onToggle)
        }
    }

    private var chatButton: some View {
        let unread = app.directUnread(agent.id)
        return Button(action: onChat) {
            Image(systemName: "bubble.left")
                .font(.system(size: 15))
                .foregroundStyle(Theme.ink2)
                .frame(width: 36, height: 36)
                .background(Theme.fill, in: Circle())
                .overlay(alignment: .topTrailing) {
                    if unread {
                        Circle()
                            .fill(Theme.accent)
                            .frame(width: 10, height: 10)
                            .overlay(Circle().strokeBorder(Theme.bg, lineWidth: 2))
                    }
                }
        }
        .buttonStyle(PressStyle(scale: 0.9))
        .accessibilityLabel(unread ? "Message \(agent.name), new reply" : "Message \(agent.name)")
        .accessibilityIdentifier("agents.chat.\(agent.id)")
    }

    private var realtimeButton: some View {
        let lit = realtime || live
        return Button {
            withAnimation(.ssSoft) { realtime.toggle() }
        } label: {
            Image(systemName: "bolt")
                .font(.system(size: 15))
                .foregroundStyle(lit ? Theme.accent : Theme.ink2)
                .frame(width: 36, height: 36)
                .background(lit ? Theme.accentSoft : Theme.fill, in: Circle())
        }
        .buttonStyle(PressStyle(scale: 0.9))
        .accessibilityLabel("Realtime settings")
        .accessibilityAddTraits(realtime ? .isSelected : [])
        .accessibilityIdentifier("agents.realtime.\(agent.id)")
    }

    // MARK: Connecting

    private var connect: some View {
        let origin = agentsOrigin(app.api)
        return VStack(alignment: .leading, spacing: 14) {
            Rectangle().fill(Theme.line).frame(height: 1)
            Text("Add this address as a custom connector (MCP server) in \(agent.name). The app will open a Subspace page where you approve it. The address is not a secret: nothing works until you approve. In Claude: Settings → Connectors → Add custom connector.")
                .font(.ssSecondary)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            AgentsCopyField(label: "Connector address", value: origin + "/api/mcp/" + agent.handle, identifier: "agents.address.\(agent.id)")
            AgentsConnections(id: agent.id, empty: "No app has signed in yet.")
            if !sent.isEmpty { answers }
            AgentsAccess(agent: agent)
            AgentsRoutines(agent: agent)
            scriptsBox(origin: origin)
            footer
        }
        .padding(.top, 14)
    }

    /// What the owner has answered this agent from the rail: the button they tapped, on which
    /// module, and whether the agent has picked it up. A record; nothing here can be tapped.
    private var answers: some View {
        VStack(alignment: .leading, spacing: 6) {
            AgentsSectionLabel("Your answers")
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(sent.prefix(6).enumerated()), id: \.element.id) { item in
                    if item.offset > 0 { Rectangle().fill(Theme.line).frame(height: 1) }
                    let x = item.element
                    VStack(alignment: .leading, spacing: 2) {
                        (Text("“\(x.label ?? "")”").fontWeight(.medium).foregroundStyle(Theme.ink) + Text(" on \(x.title ?? "")").foregroundStyle(Theme.ink2))
                            .font(.system(size: 13.5))
                            .fixedSize(horizontal: false, vertical: true)
                        Text("\(agentsAgoPhrase(x.at)) · \(x.picked_up == true ? "\(agent.name) has picked it up" : "waiting for \(agent.name)")")
                            .font(.ssMeta)
                            .foregroundStyle(Theme.ink3)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agents.sent.\(agent.id)")
    }

    private func scriptsBox(origin: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.ssSoft) { scripts.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Text("For scripts: a token sent as a header")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.ink2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.ink3)
                        .rotationEffect(.degrees(scripts ? 180 : 0))
                }
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("agents.scripts.\(agent.id)")
            if scripts {
                tokenPart(origin: origin).transition(.opacity)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func tokenPart(origin: String) -> some View {
        let has = agent.has_token == true
        let words = "A script or a client that cannot sign in can send a fixed token in an Authorization header instead. It does not expire, so keep it out of anything shared." + (has ? " Making a new one replaces the current token." : "")
        return VStack(alignment: .leading, spacing: 10) {
            Text(words)
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            if let token {
                AgentsCopyField(label: "Address", value: origin + "/api/mcp", identifier: "agents.tokenaddress.\(agent.id)")
                AgentsCopyField(label: "Header (shown once)", value: "Authorization: Bearer " + token, identifier: "agents.token.\(agent.id)")
            } else {
                AgentsConfirm(
                    label: has ? "Replace the token" : "Make a token",
                    sure: has ? "Replace it? The old one stops working" : "Make a token?"
                ) {
                    await makeToken()
                }
                .accessibilityIdentifier("agents.maketoken.\(agent.id)")
            }
        }
        .padding(.bottom, 8)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if !illustrator {
                Button {
                    Task { _ = await patch(["illustrator": true]) }
                } label: {
                    Text("Make \(agent.name) the illustrator")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .frame(minHeight: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle())
                .accessibilityIdentifier("agents.illustrator.\(agent.id)")
            }
            Spacer(minLength: 0)
            if agent.id != "a_claude" {
                ConfirmDelete(label: "Remove agent", confirm: "Remove and disconnect", size: 15) {
                    _ = await patch(["archived": true])
                }
                .accessibilityIdentifier("agents.remove.\(agent.id)")
            }
        }
    }

    // MARK: Saving

    private func saveBio() {
        let before = agent.bio ?? ""
        guard bio != before else { return }
        let wanted = bio
        Task {
            let saved = await patch(["bio": wanted])
            if !saved { bio = before }
        }
    }

    @discardableResult
    private func patch(_ body: [String: Any]) async -> Bool {
        var saved = true
        do {
            try await app.api.send("PATCH", "agents/\(agent.id)", body: body)
            problem = ""
        } catch {
            saved = false
            problem = error.localizedDescription
        }
        await app.refreshMe()
        return saved
    }

    private func makeToken() async {
        do {
            let r = try await app.api.send("POST", "agents/\(agent.id)/token", as: AgentsTokenReply.self)
            withAnimation(.ssSoft) { token = r.token }
            problem = ""
            await app.refreshMe()
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// One person whose agents may add tasks: their address, passcode and connected apps.
struct AgentsGuestRow: View {
    var guest: Agent
    var open: Bool
    var onToggle: () -> Void

    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var pass: String? = nil
    @State private var problem = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if open {
                details.transition(.opacity)
            }
            if !problem.isEmpty {
                Text(problem).font(.ssMeta).foregroundStyle(Theme.danger).padding(.top, 8)
            }
        }
        .padding(14)
        .glass(radius: 24, lifted: open)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agents.row.\(guest.id)")
    }

    private var header: some View {
        let wide = sizeClass == .regular
        return HStack(spacing: 14) {
            AvatarView(agent: guest)
            VStack(alignment: .leading, spacing: 2) {
                Text(guest.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text("Adds tasks for you. Sees only the tasks marked From \(guest.name).")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(wide ? 1 : 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture { onToggle() }
            if wide, let seen = guest.last_seen_at {
                Text("Active " + ago(seen))
                    .font(.ssMeta)
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
                    .fixedSize()
            }
            AgentsConnectButton(open: open, settled: guest.has_passcode == true, identifier: "agents.connect.\(guest.id)", action: onToggle)
        }
    }

    private var details: some View {
        let origin = agentsOrigin(app.api)
        let name = guest.name
        return VStack(alignment: .leading, spacing: 14) {
            Rectangle().fill(Theme.line).frame(height: 1)
            Text("Send \(name) two things: this address, to add as a custom connector (MCP server) in their own agents, and the passcode. When an agent connects, a Subspace page asks \(name) for the passcode. Through this address an agent can add tasks for you and see, edit and delete the tasks marked From \(name), with their notes, status and day. It cannot reach anything else.")
                .font(.ssSecondary)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            AgentsCopyField(label: "\(name)'s connector address", value: origin + "/api/mcp/guest/" + guest.handle, identifier: "agents.address.\(guest.id)")
            passcodePart
            AgentsConnections(id: guest.id, empty: "None of \(name)'s agents has signed in yet.")
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                ConfirmDelete(label: "Remove \(name)", confirm: "Remove and disconnect", size: 15) {
                    await remove()
                }
                .accessibilityIdentifier("agents.remove.\(guest.id)")
            }
        }
        .padding(.top, 14)
    }

    private var passcodePart: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let pass {
                AgentsCopyField(label: "Passcode (shown once)", value: pass, identifier: "agents.passcode.\(guest.id)")
                Text("Give it to \(guest.name) privately. It is asked for each time one of their agents connects.")
                    .font(.ssMeta)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                passcodeAsk
            }
        }
    }

    private var passcodeAsk: some View {
        let has = guest.has_passcode == true
        return HStack(spacing: 8) {
            Text(has ? "A passcode is set. It cannot be shown again." : "No passcode yet. Nothing can connect until there is one.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if has {
                AgentsConfirm(label: "New passcode", sure: "Replace the passcode?") {
                    await makePasscode()
                }
                .accessibilityIdentifier("agents.makepasscode.\(guest.id)")
            } else {
                Button {
                    Task { await makePasscode() }
                } label: {
                    Text("Make a passcode")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 36)
                        .background(Theme.accent, in: Capsule())
                }
                .buttonStyle(PressStyle(scale: 0.95))
                .accessibilityIdentifier("agents.makepasscode.\(guest.id)")
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func makePasscode() async {
        do {
            let r = try await app.api.send("POST", "guests/\(guest.id)/passcode", as: AgentsPasscodeReply.self)
            withAnimation(.ssSoft) { pass = r.passcode }
            problem = ""
            await app.refreshMe()
        } catch {
            problem = error.localizedDescription
        }
    }

    private func remove() async {
        do {
            try await app.api.send("DELETE", "guests/\(guest.id)")
            problem = ""
        } catch {
            problem = error.localizedDescription
        }
        await app.refreshMe()
    }
}

import SwiftUI

/// What one agent contributed over the last days, as the server counts it.
struct AgentsActivity: Decodable, Equatable {
    var posts: Int?
    var replies: Int?
    var context: Int?
    var todos: Int?
    var routines_done: Int?
    var routines_waiting: Int?
    var calls: Int?
    var writes: Int?
    var last_context_at: String?
}

struct AgentsActivityReply: Decodable {
    var agents: [String: AgentsActivity]
}

private func agentsCount(_ n: Int, _ one: String, _ many: String? = nil) -> String {
    "\(n) \(n == 1 ? one : (many ?? one + "s"))"
}

private func agentsListed(_ parts: [String]) -> String {
    guard parts.count > 1, let last = parts.last else { return parts.joined() }
    return parts.dropLast().joined(separator: ", ") + " and " + last
}

/// What an agent did this week, as one plain sentence or two.
func agentsDidLine(_ x: AgentsActivity, readOnly: Bool) -> String {
    var parts: [String] = []
    if let n = x.posts, n > 0 { parts.append(agentsCount(n, "post")) }
    if let n = x.replies, n > 0 { parts.append(agentsCount(n, "reply", "replies")) }
    if let n = x.context, n > 0 { parts.append(agentsCount(n, "note") + " in context") }
    if let n = x.todos, n > 0 { parts.append(agentsCount(n, "task") + " added") }
    if let n = x.routines_done, n > 0 { parts.append(agentsCount(n, "routine round") + " done") }
    var line: String
    if !parts.isEmpty {
        line = "This week: \(agentsListed(parts))."
    } else if let calls = x.calls, calls > 0 {
        line = "This week: looked in \(agentsCount(calls, "time"))\(readOnly ? "" : " and wrote nothing")."
    } else {
        line = "Nothing this week."
    }
    if let waiting = x.routines_waiting, waiting > 0 { line += " \(agentsCount(waiting, "routine round")) waiting." }
    // an agent that may only read is not expected to keep context
    if !readOnly {
        if let at = x.last_context_at {
            let when = ago(at)
            if when == "now" {
                line += " Last wrote in context just now."
            } else if when.range(of: "^\\d+[mhd]$", options: .regularExpression) != nil {
                line += " Last wrote in context \(when) ago."
            } else {
                line += " Last wrote in context on \(when)."
            }
        } else {
            line += " Has not written in context yet."
        }
    }
    return line
}

/// What this agent has contributed lately, so the owner can see who is doing what.
struct AgentsDid: View {
    var agent: Agent
    @Environment(AppModel.self) private var app
    @State private var mine: AgentsActivity? = nil

    var body: some View {
        ZStack(alignment: .leading) {
            if let mine {
                Text(agentsDidLine(mine, readOnly: agent.access?.read_only == true))
                    .font(.ssSecondary)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("agents.did.\(agent.id)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: agent.id) {
            if let reply: AgentsActivityReply = try? await app.api.get("agents/activity") {
                mine = reply.agents[agent.id]
            }
        }
    }
}

/// The owner's standing brief for an agent: what it is for, what it keeps current, how often it
/// should look. The agent is given it at the start of every session.
struct AgentsBrief: View {
    var agent: Agent
    @Environment(AppModel.self) private var app
    @State private var text = ""
    @State private var problem = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("What \(agent.name) is for, what it should keep current, and how often it should look. \(agent.name) reads this at the start of every session.", text: $text, axis: .vertical)
                .lineLimit(2...12)
                .font(.system(size: 14))
                .foregroundStyle(Theme.ink)
                .focused($focused)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .accessibilityLabel("Standing brief for \(agent.name)")
                .accessibilityIdentifier("agents.brief.\(agent.id)")
            if !problem.isEmpty {
                Text(problem).font(.ssMeta).foregroundStyle(Theme.danger)
            }
        }
        .onAppear { text = agent.brief ?? "" }
        .onChange(of: agent.brief) { _, now in
            if !focused { text = now ?? "" }
        }
        .onChange(of: focused) { _, now in
            if !now { save() }
        }
        .onChange(of: text) { _, now in
            if now.count > 1500 { text = String(now.prefix(1500)) }
        }
    }

    private func save() {
        let wanted = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard wanted != (agent.brief ?? "") else { return }
        Task {
            do {
                try await app.api.send("PATCH", "agents/\(agent.id)", body: ["brief": wanted])
                problem = ""
            } catch {
                problem = error.localizedDescription
            }
            await app.refreshMe()
        }
    }
}

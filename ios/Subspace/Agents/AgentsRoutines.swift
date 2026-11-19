import SwiftUI

/// A duty that comes round on a schedule, and which agent does it.
private struct AgentsRoutine: Decodable, Identifiable {
    var key: String
    var title: String
    var about: String?
    var every: String?
    var agent_id: String?
    var next_at: String?
    var last_done_at: String?
    var last_note: String?

    var id: String { key }
}

private struct AgentsRoutinesReply: Decodable {
    var routines: [AgentsRoutine]?
}

/// The duties that come round on a schedule, and whether this agent does each. A routine has one
/// agent: turning it on here takes it from whoever had it. When one is due the agent is pinged
/// with a job, and what it reported last time shows beneath.
struct AgentsRoutines: View {
    var agent: Agent

    @Environment(AppModel.self) private var app
    @State private var routines: [AgentsRoutine] = []
    @State private var problem = ""

    private var readOnly: Bool { agent.access?.read_only ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !routines.isEmpty {
                AgentsSectionLabel("Routines")
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(routines.enumerated()), id: \.element.id) { item in
                        if item.offset > 0 { Rectangle().fill(Theme.line).frame(height: 1) }
                        row(item.element)
                    }
                }
                .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                if readOnly {
                    Text("A read-only agent cannot do routines.").font(.ssMeta).foregroundStyle(Theme.ink3)
                }
                if !problem.isEmpty {
                    Text(problem).font(.ssMeta).foregroundStyle(Theme.danger)
                }
            }
        }
        .task { await load() }
    }

    private func row(_ r: AgentsRoutine) -> some View {
        let mine = r.agent_id == agent.id
        let isOn = Binding<Bool>(get: { mine }, set: { now in give(r.key, now) })
        return HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(r.title).font(.system(size: 13.5, weight: .medium)).foregroundStyle(Theme.ink)
                if let about = r.about, !about.isEmpty {
                    Text(about).font(.system(size: 13)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                }
                Text(line(r, mine: mine)).font(.ssMeta).foregroundStyle(Theme.ink3)
                if mine, let note = r.last_note, !note.isEmpty, let done = r.last_done_at {
                    Text("Last time, \(agentsAgoPhrase(done)): \(note)")
                        .font(.ssMeta)
                        .foregroundStyle(Theme.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !readOnly {
                Toggle(r.title, isOn: isOn)
                    .labelsHidden()
                    .tint(Theme.accent)
                    .accessibilityLabel("\(agent.name) does the \(r.title.lowercased())")
                    .accessibilityIdentifier("agents.routine.\(r.key).\(agent.id)")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    /// When it next comes due, or who does it, in a few words.
    private func line(_ r: AgentsRoutine, mine: Bool) -> String {
        let every = r.every == "daily" ? "Daily" : "Weekly"
        guard let doer = r.agent_id else { return "\(every). Nobody does this yet." }
        if !mine { return "\(every). Done by \(app.agent(doer)?.name ?? "another agent")." }
        guard let next = r.next_at, let date = parseISO(next) else { return every }
        if date.timeIntervalSinceNow <= 60 { return "\(every) · due now" }
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return "\(every) · next \(f.string(from: date))"
    }

    private func parseISO(_ text: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }

    private func load() async {
        if let reply: AgentsRoutinesReply = try? await app.api.get("routines") {
            routines = reply.routines ?? []
        }
    }

    private func give(_ key: String, _ on: Bool) {
        Task {
            do {
                try await app.api.send("PATCH", "routines/\(key)", body: ["agent": on ? agent.id : NSNull()])
                problem = ""
            } catch {
                problem = error.localizedDescription
            }
            await load()
        }
    }
}

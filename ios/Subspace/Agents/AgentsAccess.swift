import SwiftUI

/// The parts of the app an agent can be allowed to see, as the server names them, with the words shown for each.
private let agentsAccessSections: [(key: String, label: String)] = [
    ("feed", "Feed"), ("todos", "Todos"), ("journal", "Journal"), ("following", "Following"),
    ("pages", "Pages"), ("links", "Links"), ("rail", "Now"),
]
/// Top levels of context that are a part of the app, and so are chosen under "The app".
private let agentsAccessAppOwned: Set<String> = ["journal", "links"]

private struct AgentsContextTop: Decodable, Identifiable {
    let id: String
    var path: String
    var title: String
}

private struct AgentsContextReply: Decodable {
    var children: [AgentsContextTop]?
}

/// What this agent may see and do, whatever app it connects from: whether it only looks, which
/// parts of the app it sees, and which top-level sections of context. Each change is saved as it
/// is made. An agent left with everything on and able to write has no limits at all.
struct AgentsAccess: View {
    var agent: Agent

    @Environment(AppModel.self) private var app
    @State private var tops: [AgentsContextTop] = []
    @State private var problem = ""

    private var readOnly: Bool { agent.access?.read_only ?? false }
    private var sections: [String] { agent.access?.sections ?? agentsAccessSections.map(\.key) }
    private var context: [String] { agent.access?.context ?? tops.map(\.path) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AgentsSectionLabel("Access")
            VStack(alignment: .leading, spacing: 12) {
                readOnlyRow
                group("The app") {
                    ForEach(agentsAccessSections, id: \.key) { item in
                        chip(item.label, on: sections.contains(item.key), identifier: "agents.access.section.\(item.key).\(agent.id)") { now in
                            save(readOnly: readOnly, sections: flip(sections, item.key, now), context: context)
                        }
                    }
                }
                if !tops.isEmpty {
                    group("Context") {
                        ForEach(tops) { top in
                            chip(top.title, on: context.contains(top.path), identifier: "agents.access.context.\(top.path).\(agent.id)") { now in
                                save(readOnly: readOnly, sections: sections, context: flip(context, top.path, now))
                            }
                        }
                    }
                }
                Text(agent.access == nil
                     ? "\(agent.name) sees and can change everything, as agents do unless you limit them here."
                     : "What is off does not exist for \(agent.name): it is absent from its map, its searches and what it is told has changed.")
                    .font(.ssMeta)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                if !problem.isEmpty {
                    Text(problem).font(.ssMeta).foregroundStyle(Theme.danger)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .task { await load() }
    }

    private var readOnlyRow: some View {
        let isOn = Binding<Bool>(
            get: { readOnly },
            set: { now in save(readOnly: now, sections: sections, context: context) }
        )
        return HStack(spacing: 12) {
            (Text("Read only. ").foregroundStyle(Theme.ink).fontWeight(.medium)
             + Text("\(agent.name) can look, but never post, add or change anything, from any app it connects with.").foregroundStyle(Theme.ink2))
                .font(.ssSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Toggle("Read only", isOn: isOn)
                .labelsHidden()
                .tint(Theme.accent)
                .accessibilityLabel("Read only")
                .accessibilityIdentifier("agents.access.readonly.\(agent.id)")
        }
    }

    private func group<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.ssMeta).foregroundStyle(Theme.ink3)
            FlowRow(spacing: 6) { content() }
        }
    }

    /// One thing the agent can be allowed to see: a quiet chip, lit while it is allowed.
    private func chip(_ label: String, on: Bool, identifier: String, onChange: @escaping (Bool) -> Void) -> some View {
        Button {
            onChange(!on)
        } label: {
            HStack(spacing: 5) {
                if on { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)) }
                Text(label).font(.system(size: 13, weight: .medium)).lineLimit(1)
            }
            .foregroundStyle(on ? Theme.accent : Theme.ink3)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(on ? Theme.accentSoft : Theme.fill2, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(PressStyle(scale: 0.95))
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }

    private func flip(_ list: [String], _ item: String, _ on: Bool) -> [String] {
        var out = list.filter { $0 != item }
        if on { out.append(item) }
        return out
    }

    private func load() async {
        if let reply: AgentsContextReply = try? await app.api.get("context") {
            tops = (reply.children ?? []).filter { !agentsAccessAppOwned.contains($0.path) }
        }
    }

    private func save(readOnly: Bool, sections: [String], context: [String]) {
        let everything = !readOnly && sections.count == agentsAccessSections.count && tops.allSatisfy { context.contains($0.path) }
        // limits name what is allowed, so a section of context added later starts out hidden from a limited agent
        let access: Any = everything ? NSNull() : ["read_only": readOnly, "sections": sections, "context": context] as [String: Any]
        Task {
            do {
                try await app.api.send("PATCH", "agents/\(agent.id)", body: ["access": access])
                problem = ""
            } catch {
                problem = error.localizedDescription
            }
            await app.refreshMe()
        }
    }
}

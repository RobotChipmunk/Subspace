import SwiftUI

/// A change an agent has proposed to a house rule (a note under System), waiting for the owner.
private struct ContextProposal: Decodable, Identifiable {
    let id: String
    var agent_id: String?
    /// "create", "update" or "archive".
    var kind: String?
    var title: String?
    var why: String?
    var excerpt: String?
    var after: String?
    var status: String?
    var created_at: String?
}

private struct ContextProposalsReply: Decodable {
    var proposals: [ContextProposal]?
}

/// Changes agents have proposed to the house rules, waiting for the owner. Each says who proposes
/// what and why, shows the change, and is answered here or from the rail; either way the same
/// thing happens. Nothing shows when nothing is waiting.
struct ContextProposals: View {
    /// Called after an answer, so the screen behind can read the rule again.
    var onDecided: () -> Void

    @Environment(AppModel.self) private var app
    @State private var proposals: [ContextProposal] = []
    @State private var busy: String? = nil
    @State private var problem = ""
    @State private var reading: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(proposals) { p in
                card(p)
            }
            if !problem.isEmpty {
                Text(problem).font(.system(size: 13)).foregroundStyle(Theme.danger).padding(.horizontal, 4)
            }
        }
        .padding(.bottom, proposals.isEmpty && problem.isEmpty ? 0 : 24)
        .task { await load() }
    }

    private func card(_ p: ContextProposal) -> some View {
        let by = app.agent(p.agent_id)
        let title = p.title ?? ""
        let what = p.kind == "create" ? "a new house rule" : p.kind == "archive" ? "removing “\(title)”" : "a change to “\(title)”"
        let after = (p.after ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let by { AvatarView(agent: by, size: 18) }
                Text("\(by?.name ?? "An agent") proposes \(what)")
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(ago(p.created_at)).foregroundStyle(Theme.ink3)
            }
            .font(.system(size: 13))
            .foregroundStyle(Theme.ink2)
            Text(p.why ?? "")
                .font(.system(size: 15.5, weight: .medium))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(p.excerpt ?? "")
                .font(.system(size: 13.5))
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            if p.kind != "archive", !after.isEmpty {
                Button {
                    withAnimation(.ssSoft) {
                        if reading.contains(p.id) { reading.remove(p.id) } else { reading.insert(p.id) }
                    }
                } label: {
                    Text("Read the rule as it would be")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.ink3)
                        .frame(minHeight: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if reading.contains(p.id) {
                    Text(after)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .transition(.opacity)
                }
            }
            HStack(spacing: 8) {
                Button("Approve") { answer(p, approve: true) }
                    .buttonStyle(PillStyle(soft: true))
                    .accessibilityIdentifier("context.proposal.approve.\(p.id)")
                Button("Decline") { answer(p, approve: false) }
                    .buttonStyle(PillStyle())
                    .accessibilityIdentifier("context.proposal.decline.\(p.id)")
            }
            .disabled(busy == p.id)
            .padding(.top, 2)
        }
        .padding(16)
        .glass(radius: 22)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("context.proposal.\(p.id)")
    }

    private func load() async {
        if let reply: ContextProposalsReply = try? await app.api.get("rules/proposals") {
            withAnimation(.ssSoft) { proposals = reply.proposals ?? [] }
        }
    }

    private func answer(_ p: ContextProposal, approve: Bool) {
        busy = p.id
        problem = ""
        Task {
            do {
                let after = try await app.api.send("POST", "rules/proposals/\(p.id)", body: ["approve": approve], as: ContextProposal.self)
                if after.status == "failed" {
                    problem = "“\(p.title ?? "")” could not be changed: the rule has changed since this was proposed. \(app.agent(p.agent_id)?.name ?? "The agent") can propose it again."
                }
            } catch {
                problem = error.localizedDescription
            }
            busy = nil
            await load()
            await app.refreshRail()
            onDecided()
        }
    }
}

import SwiftUI

// Agents: everyone who can read and write here, and the people whose agents may add tasks.
// Mirrors src/app/(app)/agents/page.tsx.

/// The agent whose direct conversation is open.
struct AgentsChatTarget: Identifiable, Hashable {
    let id: String
}

struct AgentsScreen: View {
    @Environment(AppModel.self) private var app
    @State private var openID: String? = nil
    @State private var chat: AgentsChatTarget? = nil

    init() {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                PageHeader("Agents", sub: "Everyone who can read and write in your Subspace.")
                agentRows
                agentsNote
                peopleHeader
                peopleRows
                AgentsSignOut()
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 24)
            .column(680)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await app.refreshMe() }
        .sheet(item: $chat) { target in
            AgentsConversation(agentID: target.id)
                .environment(app)
                .presentationDragIndicator(.visible)
        }
    }

    private func toggle(_ id: String) {
        withAnimation(.ssSoft) { openID = openID == id ? nil : id }
    }

    private var agentRows: some View {
        let list = app.agents.filter { !$0.isHuman }
        return VStack(spacing: 10) {
            ForEach(list, id: \.id) { a in
                AgentsAgentRow(
                    agent: a,
                    open: openID == a.id,
                    onToggle: { toggle(a.id) },
                    onChat: { chat = AgentsChatTarget(id: a.id) }
                )
            }
            AgentsAddRow(
                label: "Add an agent",
                placeholder: "Agent name, e.g. Scout",
                hint: "Its @handle comes from the name.",
                identifier: "agents.add",
                preview: { name in AgentsScreen.handlePreview(name) },
                onAdd: { name in try await addAgent(name) }
            )
        }
    }

    private var agentsNote: some View {
        Text("Each agent has its own address. Its app signs in there and you approve it once; after that it renews its access by itself. On connecting it receives the current instructions for posting, illustrating and keeping your context, so every agent follows the same rules.")
            .font(.system(size: 13))
            .foregroundStyle(Theme.ink3)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
            .padding(.top, 32)
    }

    private var peopleHeader: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("People")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
            Text("Someone else whose agents may add tasks for you. They reach only their own tasks, nothing else.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.ink2)
        }
        .padding(.horizontal, 4)
        .padding(.top, 56)
        .padding(.bottom, 16)
    }

    private var peopleRows: some View {
        VStack(spacing: 10) {
            ForEach(app.guests, id: \.id) { g in
                AgentsGuestRow(guest: g, open: openID == g.id, onToggle: { toggle(g.id) })
            }
            AgentsAddRow(
                label: "Add a person",
                placeholder: "Their name, e.g. Meredith",
                hint: "Their tasks appear in your todos under \"From\" and their name.",
                identifier: "agents.addperson",
                preview: { name in "From " + name.trimmingCharacters(in: .whitespacesAndNewlines) },
                onAdd: { name in try await addGuest(name) }
            )
        }
    }

    /// The handle the server will derive from a name: lower-case letters and digits, at most 24.
    static func handlePreview(_ name: String) -> String {
        let kept = name.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return "@" + String(kept.prefix(24))
    }

    private func addAgent(_ name: String) async throws {
        let made = try await app.api.send("POST", "agents", body: ["name": name], as: Agent.self)
        await app.refreshMe()
        withAnimation(.ssSoft) { openID = made.id }
    }

    private func addGuest(_ name: String) async throws {
        let made = try await app.api.send("POST", "guests", body: ["name": name], as: Agent.self)
        await app.refreshMe()
        withAnimation(.ssSoft) { openID = made.id }
    }
}

/// The dashed "Add an agent" / "Add a person" row, which turns into a one-field form.
struct AgentsAddRow: View {
    var label: String
    var placeholder: String
    var hint: String
    var identifier: String
    var preview: (String) -> String
    var onAdd: (String) async throws -> Void

    @State private var adding = false
    @State private var name = ""
    @State private var problem = ""
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            if adding {
                form.transition(.opacity)
            } else {
                dashed.transition(.opacity)
            }
        }
    }

    private var dashed: some View {
        Button {
            withAnimation(.ssSoft) { adding = true }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 15, weight: .medium))
                Text(label).font(.system(size: 14.5))
            }
            .foregroundStyle(Theme.ink2)
            .frame(maxWidth: .infinity, minHeight: 68)
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(Theme.fill2, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            )
            .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(PressStyle(scale: 0.985))
        .accessibilityIdentifier(identifier)
    }

    private var trimmed: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var form: some View {
        let ready = !trimmed.isEmpty
        return HStack(spacing: 12) {
            Image(systemName: "plus")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.ink3)
                .frame(width: 40, height: 40)
                .background(Theme.fill, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                TextField(placeholder, text: $name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .focused($focused)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit { add() }
                    .accessibilityLabel(placeholder)
                    .accessibilityIdentifier(identifier + ".name")
                underline
            }
            Button {
                cancel()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.ink3)
                    .frame(width: 36, height: 36)
                    .contentShape(Circle())
            }
            .buttonStyle(PressStyle(scale: 0.9))
            .accessibilityLabel("Cancel")
            .accessibilityIdentifier(identifier + ".cancel")
            Button {
                add()
            } label: {
                Text("Add")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.bg)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 36)
                    .background(Theme.ink, in: Capsule())
            }
            .buttonStyle(PressStyle(scale: 0.95))
            .disabled(!ready || busy)
            .opacity(ready ? 1 : 0.3)
            .accessibilityIdentifier(identifier + ".submit")
        }
        .padding(14)
        .glass(radius: 24, lifted: true)
        .onAppear { focused = true }
    }

    private var underline: some View {
        let showsProblem = !problem.isEmpty
        let words = showsProblem ? problem : (trimmed.isEmpty ? hint : preview(name))
        return Text(words)
            .font(.system(size: 13))
            .foregroundStyle(showsProblem ? Theme.danger : Theme.ink3)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func cancel() {
        focused = false
        problem = ""
        name = ""
        withAnimation(.ssSoft) { adding = false }
    }

    private func add() {
        let wanted = trimmed
        guard !wanted.isEmpty, !busy else { return }
        busy = true
        problem = ""
        Task {
            do {
                try await onAdd(wanted)
                name = ""
                focused = false
                withAnimation(.ssSoft) { adding = false }
            } catch {
                problem = error.localizedDescription
            }
            busy = false
        }
    }
}

/// Leaving this device's session, with the address it is signed in to.
struct AgentsSignOut: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 12) {
            Text(app.server)
                .font(.ssMeta)
                .foregroundStyle(Theme.ink3)
                .lineLimit(1)
                .truncationMode(.middle)
                .accessibilityIdentifier("agents.server")
            Button {
                app.signOut()
            } label: {
                Text("Sign out")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                    .contentShape(Capsule())
            }
            .buttonStyle(PressStyle())
            .accessibilityIdentifier("agents.signout")
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }
}

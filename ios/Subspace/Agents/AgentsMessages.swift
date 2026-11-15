import SwiftUI

struct AgentsMessagesReply: Decodable {
    var messages: [Post]
}

/// A private conversation with one agent: ask it for something that belongs to nothing else in
/// the app. The web page opens it inside the agent's card; here it is a sheet, so the field can
/// stay pinned above the keyboard.
struct AgentsConversation: View {
    var agentID: String

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var messages: [Post]? = nil
    @State private var text = ""
    @State private var busy = false
    @State private var problem = ""
    /// A page an answer points at, opened over the conversation.
    @State private var page: PageTarget? = nil
    @FocusState private var typing: Bool

    private static let bottomID = "agents.messages.bottom"

    var body: some View {
        let agent = app.agent(agentID)
        let name = agent?.name ?? "Agent"
        VStack(spacing: 0) {
            topBar(agent: agent, name: name)
            thread(name: name)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer(name: name)
        }
        .background(Theme.bg.ignoresSafeArea())
        .sheet(item: $page) { target in
            PageView(pageID: target.id)
                .environment(app)
                .presentationDragIndicator(.visible)
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(5))
            }
        }
        // Count the conversation as read while it is open.
        .onChange(of: app.direct[agentID], initial: true) { _, at in
            if let at { app.markDirectRead(agentID, at: at) }
        }
        .onChange(of: messages?.last?.id) { _, id in
            if id != nil {
                Task { await app.refreshMe() }
            }
        }
    }

    private func topBar(agent: Agent?, name: String) -> some View {
        HStack(spacing: 10) {
            AvatarView(agent: agent, size: 32)
            Text(name)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            Button {
                dismiss()
            } label: {
                Text("Done")
            }
            .buttonStyle(PillStyle())
            .accessibilityIdentifier("agents.messages.done")
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 8)
    }

    // MARK: Messages

    private func thread(name: String) -> some View {
        let list = messages ?? []
        let meID = app.me?.id
        let handles = app.handles
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 6) {
                    if messages != nil && list.isEmpty {
                        Text("Ask \(name) for something directly. Its answer appears here, not in the feed.")
                            .font(.ssSecondary)
                            .foregroundStyle(Theme.ink2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 8)
                    }
                    ForEach(Array(list.enumerated()), id: \.element.id) { item in
                        AgentsMessageRow(
                            post: item.element,
                            mine: item.element.author == meID,
                            gap: Self.gapLabel(list, item.offset),
                            handles: handles,
                            onPage: { id in page = PageTarget(id: id) }
                        )
                    }
                    Color.clear.frame(height: 1).id(Self.bottomID)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .column(680)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: list.last?.id) { _, _ in
                withAnimation(.ssSoft) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
            }
            .onChange(of: typing) { _, now in
                guard now else { return }
                Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    withAnimation(.ssSoft) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
                }
            }
        }
    }

    /// A new request starts a new conversation; say when, as a quiet line.
    private static func gapLabel(_ list: [Post], _ index: Int) -> String? {
        guard list.indices.contains(index) else { return nil }
        let m = list[index]
        var gap = index == 0
        if index > 0, m.parent_id == nil, let at = parseDate(m.created_at), let before = parseDate(list[index - 1].created_at) {
            gap = at.timeIntervalSince(before) > 3600
        }
        guard gap else { return nil }
        let s = ago(m.created_at)
        if s == "now" { return "Now" }
        return agentsAgoPhrase(m.created_at)
    }

    // MARK: Writing

    private func composer(name: String) -> some View {
        let ready = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Message \(name)", text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.ink)
                    .focused($typing)
                    .padding(.vertical, 6)
                    .accessibilityIdentifier("agents.message")
                SendButton(show: ready, busy: busy) { send() }
                    .accessibilityIdentifier("agents.send")
            }
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            if !problem.isEmpty {
                Text(problem)
                    .font(.ssMeta)
                    .foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("agents.messages.error")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .column(680)
        .background(Theme.bg)
    }

    private func send() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !busy else { return }
        busy = true
        problem = ""
        text = ""
        Task {
            do {
                let sent = try await app.api.send("POST", "agents/\(agentID)/messages", body: ["body": body], as: Post.self)
                var current = (messages ?? []).filter { $0.id != sent.id }
                current.append(sent)
                withAnimation(.ssSoft) { messages = current }
                await load()
            } catch {
                // Put the words back so nothing typed is lost.
                if text.isEmpty { text = body }
                problem = error.localizedDescription
            }
            busy = false
        }
    }

    private func load() async {
        do {
            let r = try await app.api.get("agents/\(agentID)/messages", as: AgentsMessagesReply.self)
            if messages != r.messages {
                withAnimation(.ssSoft) { messages = r.messages }
            }
        } catch {
            // Keep what is shown; the next round tries again.
        }
    }
}

/// One message as a bubble: the owner's on the right in accent, the agent's on the left.
struct AgentsMessageRow: View {
    var post: Post
    var mine: Bool
    var gap: String?
    var handles: [String]
    var onPage: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            if let gap {
                Text(gap)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.ink3)
                    .padding(.vertical, 6)
            }
            bubble
                .padding(mine ? .leading : .trailing, 44)
                .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        }
        .accessibilityIdentifier("agents.bubble.\(post.id)")
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(richText(post.body, handles: handles))
                .font(.system(size: 15))
                .foregroundStyle(Theme.ink)
                .tint(Theme.accent)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            if let page = post.page {
                // The card's own tap would open the page under this sheet, so it is opened over it instead.
                Button {
                    onPage(page.id)
                } label: {
                    PageCard(page: page).allowsHitTesting(false)
                }
                .buttonStyle(PressStyle(scale: 0.98))
                .accessibilityLabel("Open page: \(page.title)")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(mine ? Theme.accentSoft : Theme.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

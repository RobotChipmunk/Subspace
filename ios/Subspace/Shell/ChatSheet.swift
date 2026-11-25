import SwiftUI

struct ChatReply: Decodable {
    var messages: [Post]
    var default_agent: String?
}

struct ChatSent: Decodable {
    var message: Post
    var to: String?
}

/// Chat, from any screen. What is written here goes to the default agent, or to the agent it names
/// first, and says what was on screen when it was written. Every agent's answers are read here
/// together. It is a sheet, so the field stays above the keyboard.
struct ChatSheet: View {
    @Environment(AppModel.self) private var app
    @State private var messages: [Post]? = nil
    @State private var text = ""
    @State private var busy = false
    @State private var problem = ""
    /// The owner chose to leave out what is on screen, for the thing that is on screen now.
    @State private var left: String? = nil
    /// A page an answer points at, opened over the conversation.
    @State private var page: PageTarget? = nil
    @FocusState private var typing: Bool

    private static let bottomID = "chat.bottom"

    /// What is on screen: the open thing when there is one, else just the screen.
    private var about: About {
        if let s = app.showing { return About(screen: app.tab.rawValue, type: s.type, id: s.id, title: s.title) }
        return About(screen: app.tab.rawValue, type: nil, id: nil, title: nil)
    }

    private var aboutKey: String { app.showing?.id ?? app.tab.rawValue }
    private var attached: Bool { left != aboutKey }

    var body: some View {
        thread
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
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
            // Every conversation counts as read while chat is open.
            .onChange(of: app.direct, initial: true) { _, _ in app.markAllDirectRead() }
            .onChange(of: messages?.last?.id) { _, id in
                if id != nil { Task { await app.refreshMe() } }
            }
            .onAppear { typing = true }
    }

    // MARK: Messages

    private var thread: some View {
        let list = messages ?? []
        let meID = app.me?.id
        let handles = app.handles
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { item in
                        ChatRow(
                            post: item.element,
                            mine: item.element.author == meID,
                            gap: Self.gapLabel(list, item.offset),
                            about: Self.aboutLine(list, item.offset, meID: meID),
                            face: Self.face(list, item.offset, meID: meID) ? app.agent(item.element.author) : nil,
                            handles: handles,
                            onPage: { id in page = PageTarget(id: id) }
                        )
                    }
                    Color.clear.frame(height: 1).id(Self.bottomID)
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 8)
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

    private static func hourApart(_ list: [Post], _ index: Int) -> Bool {
        guard index > 0, let at = parseDate(list[index].created_at), let before = parseDate(list[index - 1].created_at) else { return false }
        return at.timeIntervalSince(before) > 3600
    }

    /// A quiet line saying when, where an hour or more has passed.
    private static func gapLabel(_ list: [Post], _ index: Int) -> String? {
        guard hourApart(list, index) else { return nil }
        let m = list[index]
        return ago(m.created_at) == "now" ? "Now" : agentsAgoPhrase(m.created_at)
    }

    /// The owner's message says what it was about, when that differs from their message before it.
    private static func aboutLine(_ list: [Post], _ index: Int, meID: String?) -> String? {
        let m = list[index]
        guard m.author == meID else { return nil }
        let label = aboutLabel(m.about)
        guard !label.isEmpty else { return nil }
        let before = list[..<index].last { $0.author == meID }
        if aboutLabel(before?.about) == label && !hourApart(list, index) { return nil }
        return label
    }

    /// An agent's message shows its face when the speaker changes.
    private static func face(_ list: [Post], _ index: Int, meID: String?) -> Bool {
        let m = list[index]
        guard m.author != meID else { return false }
        return index == 0 || list[index - 1].author != m.author || hourApart(list, index)
    }

    // MARK: Writing

    private var composer: some View {
        let ready = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let label = aboutLabel(about)
        return VStack(alignment: .leading, spacing: 6) {
            if attached && !label.isEmpty {
                Button {
                    withAnimation(.ssSpring) { left = aboutKey }
                } label: {
                    HStack(spacing: 4) {
                        Text(label).font(.system(size: 12.5)).lineLimit(1)
                        Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)).opacity(0.7)
                    }
                    .foregroundStyle(Theme.accent)
                    .padding(.leading, 10)
                    .padding(.trailing, 8)
                    .frame(minHeight: 32)
                    .background(Theme.accentSoft, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(PressStyle())
                .accessibilityLabel("Leave out \(label)")
                .accessibilityIdentifier("chat.about")
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(app.defaultAgent.map { "Message \($0.name)" } ?? "Message", text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.ink)
                    .focused($typing)
                    .padding(.vertical, 6)
                    .accessibilityIdentifier("chat.message")
                SendButton(show: ready, busy: busy) { send() }
                    .accessibilityIdentifier("chat.send")
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
                    .accessibilityIdentifier("chat.error")
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
        var payload: [String: Any] = ["body": body]
        if attached {
            let a = about
            var fields: [String: Any] = ["screen": a.screen]
            if let type = a.type, let id = a.id {
                fields["type"] = type
                fields["id"] = id
                fields["title"] = a.title ?? ""
            }
            payload["about"] = fields
        }
        let sending = payload
        Task {
            do {
                let sent = try await app.api.send("POST", "chat", body: sending, as: ChatSent.self)
                var current = (messages ?? []).filter { $0.id != sent.message.id }
                current.append(sent.message)
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
            let r = try await app.api.get("chat", as: ChatReply.self)
            if messages != r.messages {
                withAnimation(.ssSoft) { messages = r.messages }
            }
        } catch {
            // Keep what is shown; the next round tries again.
        }
    }
}

/// One message: the owner's on the right in accent, an agent's on the left with its face where the
/// speaker changes. Chat and a task's conversation are both built of these.
struct ChatRow: View {
    var post: Post
    var mine: Bool
    var gap: String?
    var about: String?
    var face: Agent?
    var handles: [String]
    /// The start of its name for the UI tests: "chat", or "todos.thread" in a task.
    var tag = "chat"
    var onPage: (String) -> Void

    var body: some View {
        VStack(spacing: 2) {
            if let gap {
                Text(gap)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.ink3)
                    .padding(.vertical, 6)
            }
            if let about {
                Text(about)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
                    .padding(.trailing, 4)
                    .padding(.top, 4)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .accessibilityIdentifier("\(tag).about.\(post.id)")
            }
            HStack(alignment: .bottom, spacing: 6) {
                if !mine {
                    ZStack {
                        if let face { AvatarView(agent: face, size: 22) }
                    }
                    .frame(width: 22)
                }
                bubble
            }
            .padding(mine ? .leading : .trailing, 44)
            .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        }
        .accessibilityIdentifier("\(tag).bubble.\(post.id)")
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

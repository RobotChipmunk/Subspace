import SwiftUI

/// Comments for the post being read. On a wide screen the panel sits beside the feed, which keeps
/// scrolling; on a narrow one it is a sheet over the feed.
struct FeedCommentsPanel: View {
    var model: FeedModel
    var sheet: Bool

    var body: some View {
        let shown = model.post(model.shownID)
        let from = CGFloat(model.shownFrom) * 16
        let enter = AnyTransition.opacity.combined(with: AnyTransition.offset(x: 0, y: from))
        let content = VStack(spacing: 0) {
            FeedCommentsHeader(model: model)
            if let shown {
                FeedThread(post: shown, model: model, sheet: sheet)
                    .id(shown.id)
                    .transition(AnyTransition.asymmetric(insertion: enter, removal: AnyTransition.opacity))
            } else {
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feed.comments.panel")

        if sheet {
            content
        } else {
            content.glass(radius: 26)
        }
    }
}

private struct FeedCommentsHeader: View {
    var model: FeedModel

    var body: some View {
        HStack {
            Text("Comments")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            Button {
                model.close()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.ink3)
                    .frame(width: 36, height: 36)
                    .contentShape(Circle())
            }
            .buttonStyle(PressStyle(scale: 0.9))
            .accessibilityLabel("Close comments")
            .accessibilityIdentifier("feed.comments.close")
        }
        .padding(.leading, 20)
        .padding(.trailing, 10)
        .frame(height: 52)
    }
}

/// One post's comments: a line naming the post, the replies, and the reply field pinned at the bottom.
private struct FeedThread: View {
    var post: Post
    var model: FeedModel
    var sheet: Bool

    @Environment(AppModel.self) private var app
    @State private var busy = false
    @State private var problem = ""

    var body: some View {
        let replies = model.threads[post.id]
        VStack(spacing: 0) {
            FeedThreadTitle(post: post, model: model)
            Rectangle()
                .fill(Theme.line)
                .frame(height: 1)
                .padding(.horizontal, 20)
            FeedReplies(replies: replies, openPage: openPage)
            FeedThreadNotice(text: problem.isEmpty ? model.notice : problem)
            FeedMentionField(text: draft, placeholder: "Reply. @ to bring in an agent.", busy: busy, send: send)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 16)
        }
        .task(id: post.id) {
            // Replies are checked again every 6 seconds while they are on show.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(6))
                if Task.isCancelled { return }
                await model.loadThread(post.id)
            }
        }
    }

    /// What is being typed stays with its post while the feed scrolls on to others.
    private var draft: Binding<String> {
        let m = model
        let id = post.id
        return Binding(
            get: { m.drafts[id] ?? "" },
            set: { text in m.drafts[id] = text }
        )
    }

    private func send() {
        let id = post.id
        let body = model.drafts[id] ?? ""
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !busy else { return }
        busy = true
        problem = ""
        model.drafts[id] = ""
        let m = model
        Task { @MainActor in
            do {
                try await m.reply(id, body)
            } catch {
                // Put the words back so nothing is lost.
                if (m.drafts[id] ?? "").isEmpty { m.drafts[id] = body }
                problem = error.localizedDescription
            }
            busy = false
        }
    }

    private func openPage(_ page: PageRef) {
        let link = "/page/\(page.id)"
        guard sheet else {
            app.open(link)
            return
        }
        // Two sheets cannot be up at once: put the comments away, then open the page.
        model.close()
        let a = self.app
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(500))
            a.open(link)
        }
    }
}

/// Which post these comments belong to: one quiet line, so the panel never repeats the feed.
private struct FeedThreadTitle: View {
    var post: Post
    var model: FeedModel
    @Environment(AppModel.self) private var app

    private var line: AttributedString {
        var name = AttributedString(app.agent(post.author)?.name ?? "Unknown")
        name.font = Font.system(size: 13, weight: .semibold)
        name.foregroundColor = Theme.ink
        let words = post.body.replacingOccurrences(of: "\n", with: " ")
        var rest = AttributedString(" " + words)
        rest.foregroundColor = Theme.ink2
        return name + rest
    }

    var body: some View {
        HStack(spacing: 10) {
            AvatarView(agent: app.agent(post.author), size: 22)
            Text(line)
                .font(.system(size: 13))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("feed.comments.title")
            if app.me?.isHuman == true {
                ConfirmDelete(label: "Delete post", size: 14) {
                    await model.delete(post.id)
                }
                .accessibilityIdentifier("feed.comments.delete")
            }
        }
        .frame(minHeight: 36)
        .padding(.leading, 20)
        .padding(.trailing, 12)
        .padding(.bottom, 8)
    }
}

private struct FeedThreadNotice: View {
    var text: String

    var body: some View {
        if !text.isEmpty {
            Text(text)
                .font(.ssMeta)
                .foregroundStyle(Theme.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 6)
                .accessibilityIdentifier("feed.comments.error")
        }
    }
}

private struct FeedReplies: View {
    /// nil while they are being fetched.
    var replies: [Post]?
    var openPage: (PageRef) -> Void

    var body: some View {
        let list = replies ?? []
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(list, id: \.id) { reply in
                        FeedReplyRow(reply: reply, openPage: openPage)
                    }
                    if replies != nil && list.isEmpty {
                        Text("No comments yet.")
                            .font(.ssSecondary)
                            .foregroundStyle(Theme.ink3)
                            .frame(maxWidth: .infinity, minHeight: 160)
                            .accessibilityIdentifier("feed.comments.empty")
                    }
                    Color.clear.frame(height: 1).id("feed.thread.end")
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: list.count) { old, now in
                guard now > old else { return }
                withAnimation(.ssSoft) { proxy.scrollTo("feed.thread.end", anchor: .bottom) }
            }
        }
        .frame(maxHeight: .infinity)
    }
}

private struct FeedReplyRow: View {
    var reply: Post
    var openPage: (PageRef) -> Void
    @Environment(AppModel.self) private var app

    var body: some View {
        let author = app.agent(reply.author)
        HStack(alignment: .top, spacing: 12) {
            AvatarView(agent: author, size: 30)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(author?.name ?? "Unknown")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                    Text(ago(reply.created_at))
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.ink3)
                }
                Text(richText(reply.body, handles: app.handles))
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.ink)
                    .lineSpacing(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let page = reply.page {
                    FeedPageLink(page: page, open: openPage).padding(.top, 8)
                }
            }
        }
        .padding(.top, 16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feed.reply.\(reply.id)")
    }
}

/// A page card whose tap is handled here, so a page can be opened from inside the comments sheet.
private struct FeedPageLink: View {
    var page: PageRef
    var open: (PageRef) -> Void

    var body: some View {
        Button {
            open(page)
        } label: {
            PageCard(page: page).allowsHitTesting(false)
        }
        .buttonStyle(PressStyle(scale: 0.98))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Open page: \(page.title)")
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: The reply field

/// The agents a half-typed @name could mean: the text must end in "@" and the start of a handle or name.
private func feedMentionQuery(_ text: String) -> String? {
    guard let re = try? NSRegularExpression(pattern: "(^|\\s)@([a-zA-Z0-9_-]*)$") else { return nil }
    let ns = text as NSString
    guard let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
    let range = m.range(at: 2)
    guard range.location != NSNotFound else { return nil }
    return ns.substring(with: range)
}

/// A growing text field where typing @ offers the owner's agents. Return sends.
struct FeedMentionField: View {
    @Binding var text: String
    var placeholder: String
    var busy: Bool
    var send: () -> Void

    @Environment(AppModel.self) private var app
    @FocusState private var focused: Bool

    private var matches: [Agent] {
        guard let query = feedMentionQuery(text) else { return [] }
        let ql = query.lowercased()
        let mine = app.me?.id
        let found = app.agents.filter { a in
            a.id != mine && (a.handle.lowercased().hasPrefix(ql) || a.name.lowercased().hasPrefix(ql))
        }
        return Array(found.prefix(6))
    }

    var body: some View {
        let found = matches
        let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        VStack(alignment: .leading, spacing: 6) {
            if !found.isEmpty {
                FeedMentionMenu(matches: found, pick: pick)
                    .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .bottom)))
            }
            HStack(alignment: .top, spacing: 10) {
                AvatarView(agent: app.me, size: 30).padding(.top, 6)
                HStack(alignment: .bottom, spacing: 8) {
                    TextField(placeholder, text: $text, axis: .vertical)
                        .lineLimit(1...6)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.ink)
                        .tint(Theme.accent)
                        .focused($focused)
                        .submitLabel(.send)
                        .onSubmit { submit(found) }
                        .padding(.vertical, 6)
                        .frame(minHeight: 32)
                        .accessibilityIdentifier("feed.reply.field")
                    SendButton(show: hasText, busy: busy) { send() }
                        .accessibilityIdentifier("feed.reply.send")
                }
                .padding(.leading, 14)
                .padding(.trailing, 6)
                .padding(.vertical, 5)
                .background(Theme.fill, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
        }
        .animation(.ssSpring, value: found.count)
    }

    /// Return picks the first suggestion when there is one, as Enter does on the web; otherwise it sends.
    private func submit(_ found: [Agent]) {
        if let first = found.first {
            pick(first)
        } else {
            send()
        }
        // Return takes the caret out of a growing field; put it back so typing can carry on.
        Task { @MainActor in focused = true }
    }

    private func pick(_ agent: Agent) {
        guard let re = try? NSRegularExpression(pattern: "@[a-zA-Z0-9_-]*$") else { return }
        let ns = text as NSString
        guard let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return }
        text = ns.replacingCharacters(in: m.range, with: "@\(agent.handle) ")
        focused = true
    }
}

/// The agents offered while an @name is being typed.
private struct FeedMentionMenu: View {
    var matches: [Agent]
    var pick: (Agent) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(matches, id: \.id) { agent in
                Button {
                    pick(agent)
                } label: {
                    HStack(spacing: 10) {
                        AvatarView(agent: agent, size: 26)
                        Text(agent.name)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text("@\(agent.handle)")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 8)
                    .frame(minHeight: 40)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.98))
                .accessibilityLabel("Mention \(agent.name)")
                .accessibilityIdentifier("feed.mention.\(agent.handle)")
            }
        }
        .padding(6)
        .background(Theme.solid, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
        .shadow(color: Theme.shadow, radius: 12, x: 0, y: 6)
        .frame(maxWidth: 260)
    }
}

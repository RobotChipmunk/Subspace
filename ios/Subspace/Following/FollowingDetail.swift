import SwiftUI

struct FollowingDetailResponse: Decodable {
    var tracker: Tracker?
    var updates: [Post]
}

enum FollowingField: Hashable {
    case about
    case label
}

/// Reports the height its parent was given. Used to tell whether text runs past three lines.
struct FollowingHeightReader: View {
    @Binding var height: CGFloat

    var body: some View {
        GeometryReader { geo in
            Color.clear
                .onAppear { height = geo.size.height }
                .onChange(of: geo.size.height) { _, now in height = now }
        }
    }
}

/// What an opened topic shows: what it tracks, who is on it, its label, and its updates.
struct FollowingDetail: View {
    var tracker: Tracker
    var onChanged: () async -> Void
    var onRemoved: () async -> Void

    @Environment(AppModel.self) private var app
    @State private var about: String
    @State private var label: String
    @State private var assigned: [String]
    /// Three lines until asked for; an empty description opens straight into the editor.
    @State private var full: Bool
    @State private var fullHeight: CGFloat = 0
    @State private var clampHeight: CGFloat = 0
    @State private var updates: [Post]? = nil
    @State private var hasMore = false
    @State private var loadingMore = false
    @State private var problem = ""
    @FocusState private var focus: FollowingField?

    private static let pageSize = 30
    private static let aboutFont = Font.system(size: 15)

    init(tracker: Tracker, onChanged: @escaping () async -> Void, onRemoved: @escaping () async -> Void) {
        self.tracker = tracker
        self.onChanged = onChanged
        self.onRemoved = onRemoved
        let text = tracker.description ?? ""
        _about = State(initialValue: text)
        _label = State(initialValue: tracker.label)
        _assigned = State(initialValue: tracker.agents ?? [])
        _full = State(initialValue: text.isEmpty)
    }

    var body: some View {
        let visible = app.tab == .following
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(Theme.line).frame(height: 1)
            aboutPart.padding(.top, 16)
            agentsPart.padding(.top, 12)
            controlsPart.padding(.top, 8)
            if !problem.isEmpty {
                Text(problem).font(.ssMeta).foregroundStyle(Theme.danger).padding(.top, 6)
            }
            updatesPart.padding(.top, 24)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 20)
        .task(id: visible) {
            guard visible else { return }
            while !Task.isCancelled {
                await loadUpdates()
                try? await Task.sleep(for: .seconds(15))
            }
        }
        .onChange(of: focus) { old, now in
            if old == .about && now != .about { saveAbout() }
            if old == .label && now != .label { saveLabel() }
        }
        .onChange(of: tracker.agents) { _, now in assigned = now ?? [] }
        .onDisappear {
            saveAbout()
            saveLabel()
        }
    }

    // MARK: What it tracks

    private var over: Bool {
        !about.isEmpty && fullHeight > clampHeight + 1
    }

    private var aboutPart: some View {
        VStack(alignment: .leading, spacing: 4) {
            if full {
                TextField("Describe what to track in detail: what counts as news, sources, what to ignore.", text: $about, axis: .vertical)
                    .font(Self.aboutFont)
                    .lineSpacing(4)
                    .foregroundStyle(focus == .about ? Theme.ink : Theme.ink2)
                    .focused($focus, equals: .about)
                    .accessibilityLabel("What to track")
                    .accessibilityIdentifier("following.description")
            } else {
                Button {
                    edit()
                } label: {
                    Text(about)
                        .font(Self.aboutFont)
                        .lineSpacing(4)
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("What to track: \(about)")
                .accessibilityIdentifier("following.description")
            }
            if over {
                Button {
                    focus = nil
                    withAnimation(.ssSoft) { full.toggle() }
                } label: {
                    Text(full ? "Show less" : "Show more")
                        .font(.system(size: 13.5, weight: .medium))
                        .foregroundStyle(Theme.accent)
                        .frame(minHeight: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("following.more")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .top) { measure }
    }

    /// The same text drawn out of sight twice, at three lines and in full, to compare heights.
    private var measure: some View {
        ZStack(alignment: .top) {
            Text(about)
                .font(Self.aboutFont)
                .lineSpacing(4)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
                .background(FollowingHeightReader(height: $clampHeight))
            Text(about)
                .font(Self.aboutFont)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .background(FollowingHeightReader(height: $fullHeight))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .hidden()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func edit() {
        full = true
        Task {
            try? await Task.sleep(for: .milliseconds(60))
            focus = .about
        }
    }

    private func saveAbout() {
        guard about != (tracker.description ?? "") else { return }
        patch(["description": about])
    }

    // MARK: Who is on it

    private var agentsPart: some View {
        let unassigned = app.agents.filter { $0.kind == "agent" && !assigned.contains($0.id) }
        return FlowRow(spacing: 6) {
            ForEach(assigned, id: \.self) { id in
                FollowingAgentChip(agent: app.agent(id)) { remove(id) }
            }
            Menu {
                if unassigned.isEmpty {
                    Text("Every agent is already on this.")
                } else {
                    ForEach(unassigned, id: \.id) { a in
                        Button(a.name) { add(a.id) }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus").font(.system(size: 12, weight: .medium))
                    Text("Agent").font(.system(size: 13.5))
                }
                .foregroundStyle(Theme.ink2)
                .padding(.horizontal, 10)
                .frame(minHeight: 36)
                .overlay(Capsule().strokeBorder(Theme.fill2, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                .contentShape(Capsule())
            }
            .accessibilityLabel("Add an agent")
            .accessibilityIdentifier("following.assign")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func add(_ id: String) {
        withAnimation(.ssSpring) {
            if !assigned.contains(id) { assigned.append(id) }
        }
        patch(["add_agents": [id]])
    }

    private func remove(_ id: String) {
        withAnimation(.ssSpring) { assigned.removeAll { $0 == id } }
        patch(["remove_agents": [id]])
    }

    // MARK: Label and stop following

    private var controlsPart: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Text("Label").font(.ssMeta).foregroundStyle(Theme.ink3)
                TextField("", text: $label)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 120)
                    .focused($focus, equals: .label)
                    .submitLabel(.done)
                    .onSubmit { focus = nil }
                    .onChange(of: label) { _, now in
                        if now.count > 18 { label = String(now.prefix(18)) }
                    }
                    .accessibilityLabel("Feed label")
                    .accessibilityIdentifier("following.label")
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(Theme.fill, in: Capsule())
            Spacer(minLength: 0)
            ConfirmDelete(label: "Stop following", confirm: "Stop following", size: 15) {
                await stop()
            }
            .accessibilityIdentifier("following.stop")
        }
    }

    private func saveLabel() {
        let text = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            label = tracker.label
            return
        }
        guard text != tracker.label else { return }
        patch(["label": text])
    }

    private func stop() async {
        do {
            try await app.api.send("DELETE", "trackers/\(tracker.id)")
            await onRemoved()
        } catch {
            problem = error.localizedDescription
        }
    }

    private func patch(_ body: [String: Any]) {
        let id = tracker.id
        let before = tracker
        Task {
            do {
                try await app.api.send("PATCH", "trackers/\(id)", body: body)
                problem = ""
            } catch {
                // Put back what the server still has, and say why.
                label = before.label
                assigned = before.agents ?? []
                problem = error.localizedDescription
            }
            await onChanged()
        }
    }

    // MARK: Updates

    private var updatesPart: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let list = updates {
                if list.isEmpty {
                    Text("No updates yet. Assigned agents post here as things happen.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.ink3)
                } else {
                    ForEach(Array(list.enumerated()), id: \.element.id) { item in
                        FollowingUpdateRow(post: item.element, first: item.offset == 0, last: item.offset == list.count - 1)
                    }
                    if hasMore { earlierButton }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var earlierButton: some View {
        Button {
            Task { await loadEarlier() }
        } label: {
            Text("Show earlier")
        }
        .buttonStyle(PillStyle())
        .disabled(loadingMore)
        .padding(.top, 16)
        .accessibilityIdentifier("following.earlier")
    }

    private func loadUpdates() async {
        do {
            let r = try await app.api.get("trackers/\(tracker.id)", as: FollowingDetailResponse.self)
            let fresh = r.updates
            guard let current = updates else {
                hasMore = fresh.count >= Self.pageSize
                withAnimation(.ssSoft) { updates = fresh }
                return
            }
            // Keep the earlier pages already loaded beneath the newest one.
            var merged = fresh
            if let oldest = fresh.last {
                merged.append(contentsOf: current.filter { $0.id < oldest.id })
            }
            if merged != current {
                withAnimation(.ssSoft) { updates = merged }
            }
        } catch {
            // Keep what is shown; the next round tries again.
        }
    }

    private func loadEarlier() async {
        guard !loadingMore, let oldest = updates?.last else { return }
        loadingMore = true
        do {
            let r = try await app.api.get("trackers/\(tracker.id)?before=\(q(oldest.id))", as: FollowingDetailResponse.self)
            let known = Set((updates ?? []).map { $0.id })
            let more = r.updates.filter { !known.contains($0.id) }
            hasMore = r.updates.count >= Self.pageSize
            withAnimation(.ssSoft) { updates = (updates ?? []) + more }
        } catch {
            problem = error.localizedDescription
        }
        loadingMore = false
    }
}

/// An assigned agent as a small pill with a way to take it off.
struct FollowingAgentChip: View {
    var agent: Agent?
    var onRemove: () -> Void

    var body: some View {
        let name = agent?.name ?? "Unknown"
        HStack(spacing: 6) {
            AvatarView(agent: agent, size: 24)
            Text(name)
                .font(.system(size: 13.5, weight: .medium))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.ink3)
                    .frame(width: 28, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle(scale: 0.85))
            .accessibilityLabel("Remove \(name)")
        }
        .padding(.leading, 6)
        .padding(.trailing, 2)
        .frame(minHeight: 36)
        .background(Theme.fill, in: Capsule())
    }
}

/// One update on a topic's timeline: when and who, the line itself, a picture and the source.
struct FollowingUpdateRow: View {
    var post: Post
    var first: Bool
    var last: Bool

    @Environment(AppModel.self) private var app

    private var thumbnail: String? {
        guard let media = post.media else { return nil }
        if media.type == "image" { return media.url.isEmpty ? nil : media.url }
        guard let poster = media.poster, !poster.isEmpty else { return nil }
        return poster
    }

    /// Where a tap goes: the page behind the update, or else its source.
    private var target: String? {
        if let page = post.page_id, !page.isEmpty { return "/page/\(page)" }
        if let url = post.source?.url, !url.isEmpty { return url }
        return nil
    }

    private var meta: String {
        let when = ago(post.created_at)
        guard let name = app.agent(post.author)?.name else { return when }
        return "\(when) · \(name)"
    }

    var body: some View {
        let link = target
        Button {
            if let link { app.open(link) }
        } label: {
            HStack(alignment: .top, spacing: 14) {
                dot
                words
                if let ref = thumbnail {
                    RemoteImage(ref)
                        .frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(.bottom, last ? 0 : 20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(alignment: .topLeading) { line }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle(scale: link == nil ? 1 : 0.985))
        .disabled(link == nil)
        .accessibilityIdentifier("following.update.\(post.id)")
    }

    private var dot: some View {
        Circle()
            .fill(first ? Theme.accent : Theme.ink3)
            .frame(width: 9, height: 9)
            .background(Circle().fill(first ? Theme.accentSoft : Color.clear).frame(width: 17, height: 17))
            .padding(.top, 5)
    }

    private var line: some View {
        let single = first && last
        let length: CGFloat = last ? 8 : .infinity
        return Rectangle()
            .fill(Theme.fill2)
            .frame(width: 1)
            .frame(maxHeight: length, alignment: .top)
            .padding(.top, first ? 12 : 0)
            .padding(.leading, 4)
            .opacity(single ? 0 : 1)
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(meta).font(.ssMeta).foregroundStyle(Theme.ink3).lineLimit(1)
            Text(richText(post.body, handles: app.handles))
                .font(.system(size: 15))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            if let source = post.source, !source.name.isEmpty {
                Text(source.name)
                    .font(.ssMeta)
                    .underline()
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

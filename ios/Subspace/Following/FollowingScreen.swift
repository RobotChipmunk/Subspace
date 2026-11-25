import SwiftUI

// Following: the topics agents keep an eye on. Mirrors src/app/(app)/following/page.tsx.

struct FollowingListResponse: Decodable {
    var trackers: [Tracker]
}

struct FollowingScreen: View {
    @Environment(AppModel.self) private var app
    @State private var trackers: [Tracker]? = nil
    @State private var openID: String? = nil
    @State private var adding = false
    /// Each topic's standing as it was when first shown: what the order is kept by.
    @State private var placed: [String: Int] = [:]

    init() {}

    var body: some View {
        let visible = app.tab == .following
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                PageHeader("Following", sub: "Things your agents keep an eye on for you.")
                rows
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 24)
            .column(680)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
        .task(id: visible) {
            guard visible else { return }
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(15))
            }
        }
        .showing(.following, "tracker", id: openID, title: (trackers ?? app.trackers).first { $0.id == openID }?.title)
        .onChange(of: (trackers ?? app.trackers).map { $0.id }, initial: true) { _, _ in
            for t in trackers ?? app.trackers where placed[t.id] == nil { placed[t.id] = t.standing }
        }
        // opening a topic reads it: a moment later the list hears that nothing in it is new any more
        .task(id: openID) {
            guard openID != nil else { return }
            try? await Task.sleep(for: .milliseconds(1500))
            if !Task.isCancelled { await load() }
        }
        // an address that names a topic ("/following?topic=<id>", as a search result does) opens it
        .onChange(of: app.pendingTopicID, initial: true) { _, id in
            guard let id else { return }
            app.pendingTopicID = nil
            withAnimation(.ssSoft) { openID = id }
        }
    }

    /// By standing: what has something new first, then what is going along, then what has gone
    /// quiet, then what never started. A topic keeps the place it had when it was first shown, so
    /// reading one does not send it down the list under the owner's finger.
    private var ordered: [Tracker] {
        let list: [Tracker] = trackers ?? app.trackers
        return list.enumerated().sorted { a, b in
            let pa = placed[a.element.id] ?? a.element.standing
            let pb = placed[b.element.id] ?? b.element.standing
            return pa == pb ? a.offset < b.offset : pa < pb
        }.map { $0.element }
    }

    private var rows: some View {
        let list = ordered
        return VStack(spacing: 10) {
            ForEach(list, id: \.id) { t in
                FollowingRow(
                    tracker: t,
                    open: openID == t.id,
                    onToggle: { toggle(t.id) },
                    onChanged: { await changed() },
                    onRemoved: { await removed(t.id) }
                )
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
            if adding {
                FollowingAddForm(onDone: { made in finishAdding(made) })
                    .transition(.opacity)
            } else {
                addButton.transition(.opacity)
            }
        }
    }

    private var addButton: some View {
        Button {
            withAnimation(.ssSoft) { adding = true }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 15, weight: .medium))
                Text("Follow something").font(.system(size: 14.5))
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
        .accessibilityIdentifier("following.add")
    }

    private func toggle(_ id: String) {
        withAnimation(.ssSoft) { openID = openID == id ? nil : id }
    }

    private func finishAdding(_ made: Tracker?) {
        withAnimation(.ssSoft) { adding = false }
        guard let made else { return }
        var list = trackers ?? app.trackers
        if !list.contains(where: { $0.id == made.id }) { list.append(made) }
        withAnimation(.ssSoft) {
            trackers = list
            openID = made.id
        }
        Task { await changed() }
    }

    private func removed(_ id: String) async {
        withAnimation(.ssSoft) {
            if openID == id { openID = nil }
            if var list = trackers {
                list.removeAll { $0.id == id }
                trackers = list
            }
        }
        await changed()
    }

    private func changed() async {
        await load()
        await app.refreshMe()
    }

    private func load() async {
        do {
            let r = try await app.api.get("trackers", as: FollowingListResponse.self)
            if trackers != r.trackers {
                withAnimation(.ssSoft) { trackers = r.trackers }
            }
        } catch {
            // Keep showing what is already here; the next round tries again.
        }
    }
}

/// "Follow something": a title and what counts as news.
struct FollowingAddForm: View {
    var onDone: (Tracker?) -> Void

    @Environment(AppModel.self) private var app
    @State private var title = ""
    @State private var details = ""
    @State private var problem = ""
    @State private var busy = false
    @FocusState private var titleFocused: Bool

    var body: some View {
        let ready = !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        VStack(alignment: .leading, spacing: 8) {
            TextField("What should they follow?", text: $title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .focused($titleFocused)
                .submitLabel(.done)
                .onSubmit { submit() }
                .accessibilityLabel("Title")
                .accessibilityIdentifier("following.add.title")
            TextField("Describe what counts as news, which sources matter and what to ignore.", text: $details, axis: .vertical)
                .lineLimit(3...8)
                .font(.system(size: 15))
                .foregroundStyle(Theme.ink2)
                .accessibilityLabel("Description")
                .accessibilityIdentifier("following.add.description")
            if !problem.isEmpty {
                Text(problem).font(.system(size: 13)).foregroundStyle(Theme.danger)
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button {
                    onDone(nil)
                } label: {
                    Text("Cancel")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.ink2)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 36)
                        .contentShape(Capsule())
                }
                .buttonStyle(PressStyle())
                .accessibilityIdentifier("following.add.cancel")
                Button {
                    submit()
                } label: {
                    Text("Follow")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.bg)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 36)
                        .background(Theme.ink, in: Capsule())
                }
                .buttonStyle(PressStyle(scale: 0.95))
                .disabled(!ready || busy)
                .opacity(ready ? 1 : 0.3)
                .accessibilityIdentifier("following.add.submit")
            }
        }
        .padding(20)
        .glass(radius: 24, lifted: true)
        .onAppear { titleFocused = true }
    }

    private func submit() {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !busy else { return }
        busy = true
        problem = ""
        let about = details
        Task {
            do {
                let body: [String: Any] = ["title": name, "description": about]
                let made = try await app.api.send("POST", "trackers", body: body, as: Tracker.self)
                busy = false
                onDone(made)
            } catch {
                busy = false
                problem = error.localizedDescription
            }
        }
    }
}

/// One followed topic: a glass card whose header opens the detail in place.
struct FollowingRow: View {
    var tracker: Tracker
    var open: Bool
    var onToggle: () -> Void
    var onChanged: () async -> Void
    var onRemoved: () async -> Void

    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if open {
                FollowingDetail(tracker: tracker, onChanged: onChanged, onRemoved: onRemoved)
                    .transition(.opacity)
            }
        }
        .glass(radius: 24, lifted: open)
    }

    private var latestLine: String {
        let latest = tracker.latest ?? ""
        if !latest.isEmpty { return latest }
        let assigned = tracker.agents ?? []
        return assigned.isEmpty ? "No agent assigned yet." : "Waiting for the first update."
    }

    /// Beside the title: what is new since the owner last looked, how long it has been quiet, or when it last had an update.
    private var status: String {
        let fresh = tracker.new_count ?? 0
        if !open && fresh > 0 { return "\(fresh) new" }
        if let days = tracker.quietDays, days >= Tracker.quietAfter { return "Quiet for \(days) days" }
        return ago(tracker.latest_at)
    }

    private var header: some View {
        let hasLatest = !(tracker.latest ?? "").isEmpty
        let assigned = Array((tracker.agents ?? []).prefix(3))
        let fresh = !open && (tracker.new_count ?? 0) > 0
        // quiet and never-updated topics stand back until they are opened
        let dim = !open && tracker.standing >= 2
        return Button(action: onToggle) {
            HStack(spacing: 14) {
                TrackerTile(tracker: tracker)
                    .scaleEffect(open ? 1.08 : 1)
                    .rotationEffect(.degrees(open ? -4 : 0))
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(tracker.title)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        if fresh {
                            Circle().fill(Theme.accent).frame(width: 8, height: 8).alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 1 }
                        }
                        Text(status)
                            .font(fresh ? .system(size: 12.5, weight: .medium) : .ssMeta)
                            .foregroundStyle(fresh ? Theme.accent : Theme.ink3)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    Text(latestLine)
                        .font(.system(size: 14))
                        .foregroundStyle(hasLatest ? Theme.ink2 : Theme.ink3)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                HStack(spacing: -6) {
                    ForEach(assigned, id: \.self) { id in
                        AvatarView(agent: app.agent(id), size: 22)
                    }
                }
                Image(systemName: "chevron.down")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.ink3)
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
            .padding(14)
            .opacity(dim ? 0.6 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle(scale: 0.985))
        .accessibilityLabel(tracker.title)
        .accessibilityValue("\(status). \(latestLine)")
        .accessibilityAddTraits(open ? .isSelected : [])
        .accessibilityIdentifier("following.row.\(tracker.id)")
    }
}

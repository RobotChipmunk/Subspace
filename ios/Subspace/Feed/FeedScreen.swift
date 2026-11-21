import SwiftUI

/// The feed: short updates from the owner's agents, newest first, with comments beside them.
struct FeedScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = FeedModel()

    init() {}

    var body: some View {
        let visible = app.tab == .feed && phase == .active
        GeometryReader { geo in
            // Comments sit beside the feed when there is room for both; otherwise they are a sheet.
            let beside = sizeClass == .regular && geo.size.width >= 680
            let panelWidth = min(408, max(324, geo.size.width * 0.36)) - 28
            // The feed's own room, once the comments beside it have taken theirs.
            let room = geo.size.width - (beside && model.commentsOpen ? panelWidth + 16 : 0)
            HStack(spacing: 0) {
                FeedList(model: model, room: room)
                if beside && model.commentsOpen {
                    FeedCommentsPanel(model: model, sheet: false)
                        .frame(width: panelWidth)
                        .padding(.vertical, 16)
                        .padding(.trailing, 16)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .onAppear {
                model.beside = beside
                model.setViewport(geo.size.height)
            }
            .onChange(of: beside) { _, now in model.beside = now }
            // While comments are open beside the feed they take the docked rail's place.
            .onChange(of: beside && model.commentsOpen && app.tab == .feed, initial: true) { _, now in app.commentsBeside = now }
            .onChange(of: geo.size.height) { _, now in model.setViewport(now) }
            .sheet(isPresented: sheetBinding(beside)) {
                FeedCommentsPanel(model: model, sheet: true)
                    .environment(app)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
                    .presentationBackground(.regularMaterial)
            }
        }
        .task(id: visible) {
            model.api = app.api
            model.visible = visible
            model.reduceMotion = reduceMotion
            model.settingsChanged()
            guard visible else { return }
            // The web page refreshes every 12 seconds while it is on screen.
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(12))
            }
        }
        .onChange(of: reduceMotion) { _, now in
            model.reduceMotion = now
            model.settingsChanged()
        }
    }

    private func sheetBinding(_ beside: Bool) -> Binding<Bool> {
        let m = self.model
        return Binding(
            get: { m.commentsOpen && !beside },
            set: { open in
                if !open { m.close() }
            }
        )
    }
}

/// The scrolling posts: as many columns as fit, each at least as wide as a post on a phone; one
/// where not even two fit.
private struct FeedList: View {
    var model: FeedModel
    /// The width the feed has, its margins included.
    var room: CGFloat

    var body: some View {
        // as many columns as fit inside the page's margins, each at least as wide as on a phone
        let space = room - 32
        let columns = FeedModel.columnCount(space)
        let laneWidth = (space - CGFloat(columns - 1) * FeedModel.gutter) / CGFloat(columns)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    PageHeader("Feed") {
                        FeedBookmarkedToggle(model: model)
                    }
                    FeedListBody(model: model, columns: columns, laneWidth: laneWidth)
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 24)
                // one column keeps the reading width it always had; several use the room they are given
                .column(columns > 1 ? .infinity : 652)
                .background {
                    FeedFrameReporter { frame in model.contentMoved(frame) }
                }
            }
            .coordinateSpace(name: feedScrollSpace)
            .refreshable { await model.refresh() }
            .onChange(of: model.bringToken) { _, _ in bring(proxy) }
            .onChange(of: columns) { _, _ in keep(proxy) }
        }
    }

    /// When the number of columns changes, the post being read stays in view. At the very top the
    /// feed simply stays at the top, heading and all.
    private func keep(_ proxy: ScrollViewProxy) {
        guard !model.nearTop || model.commentsOpen else { return }
        guard let id = (model.commentsOpen ? model.activeID : nil) ?? model.reading() else { return }
        Task { @MainActor in
            // let the new columns be laid out first
            try? await Task.sleep(for: .seconds(0.05))
            proxy.scrollTo(id, anchor: UnitPoint(x: 0.5, y: 0.3))
        }
    }

    /// Brings a post to where posts are read, so it stays the current one when scrolling carries on.
    private func bring(_ proxy: ScrollViewProxy) {
        guard let id = model.bringID, model.beside else { return }
        let delay = model.bringDelay
        let m = self.model
        Task { @MainActor in
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            guard m.commentsOpen, m.activeID == id else { return }
            guard let anchor = m.bringAnchor(id) else { return }
            withAnimation(.ssSoft) { proxy.scrollTo(id, anchor: anchor) }
        }
    }
}

private struct FeedListBody: View {
    var model: FeedModel
    var columns: Int
    /// How wide each column is when there are several.
    var laneWidth: CGFloat

    var body: some View {
        let posts = model.posts
        if columns > 1 && !posts.isEmpty {
            // Several columns, laid out like masonry (`FeedModel.columns`). Each ends in its own mark
            // that asks for older posts, so whichever runs out first fetches them.
            let lanes = model.columns(columns, width: laneWidth)
            // VoiceOver meets the posts newest first, across the columns, as on the web, rather than
            // one whole column and then the next.
            let newness = Dictionary(posts.enumerated().map { ($1.id, Double(posts.count - $0)) }, uniquingKeysWith: { first, _ in first })
            HStack(alignment: .top, spacing: FeedModel.gutter) {
                ForEach(lanes.indices, id: \.self) { c in
                    LazyVStack(spacing: FeedModel.gutter) {
                        ForEach(lanes[c], id: \.id) { post in
                            FeedListCard(post: post, model: model)
                                .accessibilitySortPriority(newness[post.id] ?? 0)
                        }
                        FeedMoreMark(model: model)
                    }
                }
            }
            .accessibilityElement(children: .contain)
        } else {
            FeedOneColumn(model: model, columns: columns)
        }
    }
}

private struct FeedListCard: View {
    var post: Post
    var model: FeedModel

    var body: some View {
        FeedPostCard(post: post, model: model)
            .id(post.id)
            .transition(.opacity.combined(with: .scale(scale: 0.97)))
    }
}

/// Reaching the end asks for older posts.
private struct FeedMoreMark: View {
    var model: FeedModel

    var body: some View {
        Color.clear
            .frame(height: 32)
            .onAppear {
                Task { await model.loadMore() }
            }
    }
}

/// One column of posts, and what the feed says while it has none to show.
private struct FeedOneColumn: View {
    var model: FeedModel
    var columns: Int

    var body: some View {
        let posts = model.posts
        LazyVStack(spacing: 12) {
            ForEach(posts, id: \.id) { post in
                FeedListCard(post: post, model: model)
            }
            if model.loaded && posts.isEmpty && model.onlyBookmarked {
                Text("Nothing bookmarked yet.")
                    .font(.ssSecondary)
                    .foregroundStyle(Theme.ink3)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 96)
                    .accessibilityIdentifier("feed.bookmarked.empty")
            } else if model.loaded && posts.isEmpty {
                FeedEmptyState()
            }
            if !model.loaded {
                if model.problem.isEmpty {
                    FeedSkeletons(columns: columns)
                } else {
                    Text(model.problem)
                        .font(.ssSecondary)
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 24)
                        .accessibilityIdentifier("feed.error")
                }
            }
            FeedMoreMark(model: model)
        }
    }
}

/// Nothing posted yet.
private struct FeedEmptyState: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathe = false

    private var line: AttributedString {
        var a = AttributedString("Updates from your agents appear here. ")
        a.foregroundColor = Theme.ink2
        var link = AttributedString("Connect one")
        link.foregroundColor = Theme.accent
        var rest = AttributedString(" to get started.")
        rest.foregroundColor = Theme.ink2
        return a + link + rest
    }

    var body: some View {
        let colors: [Color] = ["#FFC9B5", "#C9B8FF", "#A8E6FF", "#B5F5D8", "#FFC9B5"].map { Color(hex: $0) }
        VStack(spacing: 0) {
            Circle()
                .fill(AngularGradient(colors: colors, center: .center))
                .frame(width: 64, height: 64)
                .blur(radius: 2)
                .scaleEffect(breathe ? 0.94 : 1)
                .opacity(breathe ? 0.55 : 1)
                .padding(.bottom, 24)
                .accessibilityHidden(true)
            Text("Quiet for now")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.ink)
            Button {
                app.open("/agents")
            } label: {
                Text(line)
                    .font(.system(size: 15))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 280)
                    .padding(.top, 4)
                    .frame(minHeight: 36)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("feed.empty.connect")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 96)
        .accessibilityIdentifier("feed.empty")
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.3).repeatForever(autoreverses: true)) { breathe = true }
        }
    }
}

/// Quiet placeholder cards, two to a column, while the first posts load.
private struct FeedSkeletons: View {
    var columns: Int

    var body: some View {
        HStack(alignment: .top, spacing: FeedModel.gutter) {
            ForEach(0..<max(1, columns), id: \.self) { _ in
                VStack(spacing: columns > 1 ? FeedModel.gutter : 12) {
                    FeedSkeletonCard()
                    FeedSkeletonCard()
                }
            }
        }
        .accessibilityHidden(true)
    }
}

private struct FeedSkeletonCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RoundedRectangle(cornerRadius: feedPictureRadius, style: .continuous)
                .fill(Theme.fill)
                .aspectRatio(2, contentMode: .fit)
            VStack(alignment: .leading, spacing: 10) {
                Capsule().fill(Theme.fill).frame(height: 12)
                Capsule().fill(Theme.fill).frame(width: 160, height: 12)
                HStack(spacing: 8) {
                    Circle().fill(Theme.fill).frame(width: 22, height: 22)
                    Capsule().fill(Theme.fill).frame(width: 112, height: 12)
                }
                .padding(.top, 6)
            }
            .padding(.horizontal, 10)
            .padding(.top, 16)
            .padding(.bottom, 14)
        }
        .padding(6)
        .glass(radius: 26)
    }
}

/// The quiet bookmark in the feed's header: narrows the feed to bookmarked posts. No label or
/// surface at rest; filled accent on accent-soft while on.
private struct FeedBookmarkedToggle: View {
    var model: FeedModel

    var body: some View {
        let on = model.onlyBookmarked
        Button {
            Task { await model.setOnlyBookmarked(!on) }
        } label: {
            Image(systemName: on ? "bookmark.fill" : "bookmark")
                .font(.system(size: 17))
                .foregroundStyle(on ? Theme.accent : Theme.ink3)
                .frame(width: 40, height: 40)
                .background(on ? Theme.accentSoft : Color.clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(PressStyle(scale: 0.9))
        .accessibilityLabel("Bookmarked")
        .accessibilityHint(on ? "Shows everything" : "Shows bookmarked posts only")
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("feed.bookmarked")
    }
}

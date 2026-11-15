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
            HStack(spacing: 0) {
                FeedList(model: model)
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

/// The scrolling column of posts.
private struct FeedList: View {
    var model: FeedModel

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    PageHeader("Feed")
                    FeedListBody(model: model)
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 24)
                .column(652)
                .background {
                    FeedFrameReporter { frame in model.contentMoved(frame) }
                }
            }
            .coordinateSpace(name: feedScrollSpace)
            .refreshable { await model.refresh() }
            .onChange(of: model.bringToken) { _, _ in bring(proxy) }
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

    var body: some View {
        let posts = model.posts
        LazyVStack(spacing: 12) {
            ForEach(posts, id: \.id) { post in
                FeedPostCard(post: post, model: model)
                    .id(post.id)
                    .transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
            if model.loaded && posts.isEmpty {
                FeedEmptyState()
            }
            if !model.loaded {
                if model.problem.isEmpty {
                    FeedSkeletons()
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
            // Reaching the end asks for older posts.
            Color.clear
                .frame(height: 32)
                .onAppear {
                    Task { await model.loadMore() }
                }
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

/// Two quiet placeholder cards while the first posts load.
private struct FeedSkeletons: View {
    var body: some View {
        VStack(spacing: 12) {
            FeedSkeletonCard()
            FeedSkeletonCard()
        }
        .accessibilityHidden(true)
    }
}

private struct FeedSkeletonCard: View {
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(Theme.fill).frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 10) {
                Capsule().fill(Theme.fill).frame(width: 128, height: 12)
                Capsule().fill(Theme.fill).frame(height: 12)
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Theme.fill)
                    .aspectRatio(2, contentMode: .fit)
            }
            .padding(.top, 4)
        }
        .padding(16)
        .glass(radius: 26)
    }
}

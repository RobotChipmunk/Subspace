import SwiftUI
import Observation

/// The name of the feed scroll view's coordinate space. Cards and clips report where they are in it.
let feedScrollSpace = "feed.scroll"

struct FeedPostsResponse: Decodable {
    var posts: [Post]
}

struct FeedThreadResponse: Decodable {
    var replies: [Post]
}

/// Everything the feed screen holds: the posts, whose comments are open, drafts, and which clip plays.
@MainActor
@Observable
final class FeedModel {
    // Posts
    var first: [Post] = []
    var older: [Post] = []
    var loaded = false
    var done = false
    var problem = ""

    // Comments
    var commentsOpen = false
    /// The post being read: its card is lifted and its comments are wanted.
    var activeID: String?
    /// The post whose comments are on show. It trails `activeID` until the new replies have arrived.
    var shownID: String?
    /// Which side the new comments arrive from: 1 from below, -1 from above, 0 in place.
    var shownFrom = 0
    var threads: [String: [Post]] = [:]
    var drafts: [String: String] = [:]
    var notice = ""
    /// Counts up each time a post should be brought to the reading line.
    var bringToken = 0

    // Clips
    var playingClip: String?
    /// Sound is one choice for the whole feed.
    var sound = false

    /// Show bookmarked posts only. Off unless asked for.
    var onlyBookmarked = false

    @ObservationIgnored var api: API?
    @ObservationIgnored var beside = false
    @ObservationIgnored var visible = true
    @ObservationIgnored var reduceMotion = false
    @ObservationIgnored var bringID: String?
    @ObservationIgnored var bringDelay: Double = 0

    @ObservationIgnored private var viewport: CGFloat = 0
    @ObservationIgnored private var content: CGRect = .zero
    @ObservationIgnored private var cards: [String: CGRect] = [:]
    @ObservationIgnored private var clips: [String: CGRect] = [:]
    @ObservationIgnored private var holdUntil = Date.distantPast
    @ObservationIgnored private var scheduled = false
    @ObservationIgnored private var loadingMore = false
    /// Posts that arrived while the owner was reading further down. They wait out of sight until
    /// the feed is back at the top: added at the top of one of several columns, one would push
    /// that column down under the reader.
    @ObservationIgnored private var waiting: [Post]?
    /// For each number of columns: the column each post sits in, and how much has been added to the
    /// top of each since. Each count keeps its own, so going from two to three and back to two
    /// returns every post to where it was.
    @ObservationIgnored private var layouts: [Int: (lanes: [String: Int], added: [CGFloat])] = [:]

    // Columns
    /// The narrowest a post is shown in columns: about its width on a phone.
    static let postMin: CGFloat = 340
    /// The space between posts in columns, across and down.
    static let gutter: CGFloat = 16

    /// How many columns fit in this much room (inside the page's margins): as many as are at least
    /// `postMin` wide with a gutter between each, and never fewer than one.
    static func columnCount(_ room: CGFloat) -> Int {
        max(1, Int((room + gutter) / (postMin + gutter)))
    }

    var posts: [Post] {
        let ids = Set(first.map { $0.id })
        return first + older.filter { !ids.contains($0.id) }
    }

    func post(_ id: String?) -> Post? {
        guard let id else { return nil }
        return posts.first { $0.id == id }
    }

    // MARK: Loading

    func refresh() async {
        guard let api else { return }
        do {
            let only = onlyBookmarked
            let r: FeedPostsResponse = try await api.get(feedPath)
            // the filter changed while this was on its way: the answer is for the other view
            guard only == onlyBookmarked else { return }
            let incoming = r.posts
            if !nearTop, let top = first.first?.id, let at = incoming.firstIndex(where: { $0.id == top }), at > 0 {
                // newer posts wait above, out of sight, until the feed is back at the top
                waiting = incoming
                let rest = Array(incoming[at...])
                if rest != first { withAnimation(.ssSoft) { first = rest } }
            } else {
                waiting = nil
                if incoming != first { withAnimation(.ssSoft) { first = incoming } }
            }
            loaded = true
            problem = ""
        } catch is CancellationError {
            return
        } catch {
            if !loaded { problem = error.localizedDescription }
        }
    }

    func loadMore() async {
        guard let api else { return }
        let all = posts
        guard let last = all.last, !done, !loadingMore, all.count >= 20 else { return }
        loadingMore = true
        defer { loadingMore = false }
        guard let r: FeedPostsResponse = try? await api.get("\(feedPath)&before=\(q(last.id))") else { return }
        if r.posts.isEmpty { done = true }
        older.append(contentsOf: r.posts)
    }

    func loadThread(_ id: String) async {
        guard let api else { return }
        guard let r: FeedThreadResponse = try? await api.get("posts/\(id)") else { return }
        if threads[id] != r.replies { threads[id] = r.replies }
    }

    // MARK: Comments

    func toggleComments(_ id: String) {
        if commentsOpen && activeID == id {
            close()
            return
        }
        let wasOpen = commentsOpen
        // Opening makes the feed narrower; wait for it to settle before moving the post into place.
        let wait: Double = wasOpen ? 0 : 0.56
        holdUntil = Date().addingTimeInterval(wait + 0.9)
        notice = ""
        if !wasOpen && shownID != id { shownID = nil }
        withAnimation(.ssSoft) { commentsOpen = true }
        setActive(id)
        bringID = id
        bringDelay = wait
        bringToken += 1
    }

    func close() {
        withAnimation(.ssSoft) { commentsOpen = false }
    }

    func setActive(_ id: String) {
        if activeID != id {
            withAnimation(.ssSoft) { activeID = id }
        }
        let all = posts
        if let at = all.firstIndex(where: { $0.id == id }) {
            // Fetch the comments of the posts either side, so they are there when the feed reaches them.
            if at > 0 { prefetch(all[at - 1].id) }
            if at + 1 < all.count { prefetch(all[at + 1].id) }
        }
        let known = threads[id] != nil
        if known { show(id) }
        Task {
            await loadThread(id)
            if !known && activeID == id { show(id) }
        }
    }

    private func prefetch(_ id: String) {
        guard threads[id] == nil else { return }
        Task { await loadThread(id) }
    }

    private func show(_ id: String) {
        guard shownID != id else { return }
        let all = posts
        let old = all.firstIndex(where: { $0.id == shownID })
        let new = all.firstIndex(where: { $0.id == id })
        var from = 0
        if let old, let new {
            from = new > old ? 1 : -1
        }
        shownFrom = from
        withAnimation(.easeOut(duration: 0.3)) { shownID = id }
    }

    func reply(_ id: String, _ body: String) async throws {
        guard let api else { return }
        try await api.send("POST", "posts/\(id)/replies", body: ["body": body])
        await loadThread(id)
        await refresh()
    }

    func delete(_ id: String) async {
        guard let api else { return }
        do {
            try await api.send("DELETE", "posts/\(id)")
        } catch {
            notice = error.localizedDescription
            return
        }
        withAnimation(.ssSoft) {
            first.removeAll { $0.id == id }
            older.removeAll { $0.id == id }
        }
        waiting?.removeAll { $0.id == id }
        threads[id] = nil
        drafts[id] = nil
        cards[id] = nil
        clips[id] = nil
        if activeID == id {
            // The post whose comments were open has gone: take the one in view.
            if beside, let next = reading() {
                setActive(next)
            } else {
                close()
            }
        }
        await refresh()
    }

    private var feedPath: String { onlyBookmarked ? "feed?channel=feed&bookmarked=1" : "feed?channel=feed" }

    /// Narrows the feed to bookmarked posts, or shows everything again.
    func setOnlyBookmarked(_ on: Bool) async {
        guard on != onlyBookmarked else { return }
        close()
        onlyBookmarked = on
        withAnimation(.ssSoft) {
            first = []
            older = []
        }
        waiting = nil
        layouts = [:]
        done = false
        loaded = false
        await refresh()
    }

    /// Bookmarks a post or takes the bookmark off. It shows at once; in the bookmarked view a
    /// post that loses its bookmark leaves. Bookmarking also keeps the source in Links (the
    /// server does that).
    func toggleBookmark(_ post: Post) async {
        guard let api else { return }
        let on = post.bookmarked_at == nil
        let before = (first, older)
        let stamp = ISO8601DateFormatter().string(from: Date())
        func apply(_ list: [Post]) -> [Post] {
            if !on && onlyBookmarked { return list.filter { $0.id != post.id } }
            return list.map { p in
                guard p.id == post.id else { return p }
                var changed = p
                changed.bookmarked_at = on ? stamp : nil
                return changed
            }
        }
        withAnimation(.ssSoft) {
            first = apply(first)
            older = apply(older)
        }
        waiting = waiting.map(apply)
        do {
            try await api.send(on ? "PUT" : "DELETE", "posts/\(post.id)/bookmark")
        } catch {
            withAnimation(.ssSoft) {
                first = before.0
                older = before.1
            }
        }
    }

    // MARK: Where things are

    func setViewport(_ height: CGFloat) {
        viewport = height
        schedule()
    }

    func contentMoved(_ frame: CGRect) {
        content = frame
        // back at the top: the posts that came in meanwhile take their places
        if let w = waiting, nearTop {
            waiting = nil
            withAnimation(.ssSoft) { first = w }
        }
        schedule()
    }

    /// The feed is at its top, or close enough that a post added there is seen arriving.
    private var nearTop: Bool { content.minY > -80 }

    // MARK: Columns

    /// The posts shared between `count` columns, like masonry: each goes to the shortest column
    /// when it first appears and stays there, so nothing changes sides as pictures load or posts
    /// come and go. Posts that came in at the top take turns between the columns, oldest first.
    func columns(_ count: Int, width: CGFloat) -> [[Post]] {
        let all = posts
        guard count > 1 else { return [all] }
        var layout = layouts[count] ?? (lanes: [:], added: Array(repeating: 0, count: count))
        /// The leftmost of the columns with the least in them.
        func least(_ xs: [CGFloat]) -> Int { xs.indices.min { xs[$0] < xs[$1] } ?? 0 }
        if let known = all.firstIndex(where: { layout.lanes[$0.id] != nil }), known > 0 {
            for p in all[..<known].reversed() {
                let c = least(layout.added)
                layout.lanes[p.id] = c
                layout.added[c] += height(p, width) + Self.gutter
            }
        }
        var out: [[Post]] = Array(repeating: [], count: count)
        var tops: [CGFloat] = Array(repeating: 0, count: count)
        for p in all {
            let c: Int
            if let lane = layout.lanes[p.id], lane < count {
                c = lane
            } else {
                c = least(tops)
                layout.lanes[p.id] = c
            }
            out[c].append(p)
            tops[c] += height(p, width) + Self.gutter
        }
        layouts[count] = layout
        return out
    }

    /// How tall a post's card is: as drawn when it has been, otherwise about what it will be.
    private func height(_ p: Post, _ width: CGFloat) -> CGFloat {
        if let drawn = cards[p.id]?.height, drawn > 0 { return drawn }
        let inner = max(120, width - 12)
        // the card's padding, the room above the words and the byline under them
        var h: CGFloat = 12 + 12 + 42
        if let m = p.media, m.type == "video" {
            h += min(560, inner * 9 / 16)
        } else if let m = p.media, m.type == "image" {
            h += min(520, inner / 1.6) + ((m.images?.count ?? 0) > 1 ? 16 : 0)
        } else if let art = p.art, (art.status ?? "none") != "none" {
            h += inner / 2
        }
        let perLine = max(16, (width - 32) / 8.6)
        h += min(4, (CGFloat(p.body.count) / perLine).rounded(.up)) * 22.5
        if p.page != nil { h += 78 }
        return h
    }

    func cardMoved(_ id: String, _ frame: CGRect) {
        cards[id] = frame
        schedule()
    }

    func cardGone(_ id: String) {
        cards[id] = nil
    }

    func clipMoved(_ id: String, _ frame: CGRect?) {
        clips[id] = frame
        schedule()
    }

    /// Call after `visible` or `reduceMotion` change.
    func settingsChanged() {
        schedule()
    }

    /// Many frames change in one scroll step; look at them once, after they have all been reported.
    private func schedule() {
        guard !scheduled else { return }
        scheduled = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.scheduled = false
            self.chooseClip()
            self.follow()
        }
    }

    /// Plays the clip that is most on screen (a little over half of it at least), and stops the others.
    private func chooseClip() {
        var best: String?
        var most: CGFloat = 0.55
        if visible && !reduceMotion && viewport > 0 {
            for (id, frame) in clips {
                guard frame.height > 0 else { continue }
                let top = max(frame.minY, 0)
                let bottom = min(frame.maxY, viewport)
                let share = max(0, bottom - top) / frame.height
                if share > most {
                    most = share
                    best = id
                }
            }
        }
        if playingClip != best { playingClip = best }
    }

    /// While comments are open beside the feed, scrolling changes whose comments are shown.
    private func follow() {
        guard commentsOpen, beside, Date() >= holdUntil else { return }
        guard let id = reading(), id != activeID else { return }
        setActive(id)
    }

    /// The post being read: the one crossing a line a little above the middle of the screen. The
    /// line slides to the top or bottom edge as the feed reaches its ends. While comments are open
    /// only the column of the post they show counts, so in columns they follow down the
    /// column the owner is reading.
    func reading() -> String? {
        let vh = viewport
        guard vh > 0 else { return nil }
        var line = vh * 0.38
        if content.height > 0 {
            let top = -content.minY
            let left = content.maxY - vh
            line = max(min(vh * 0.38, 150 + top), vh - 220 - left)
        }
        let lane = commentsOpen ? activeID.flatMap { cards[$0] } : nil
        var best: String?
        var nearest = CGFloat.greatestFiniteMagnitude
        for p in posts {
            guard let r = cards[p.id] else { continue }
            if let lane, r.maxX < lane.midX || r.minX > lane.midX { continue }
            let inside = r.minY <= line && r.maxY >= line
            let d: CGFloat = inside ? 0 : min(abs(r.minY - line), abs(r.maxY - line))
            if d < nearest {
                nearest = d
                best = p.id
            }
        }
        return best
    }

    /// Where to scroll a post so it sits on the reading line; nil when it is already there.
    func bringAnchor(_ id: String) -> UnitPoint? {
        guard viewport > 0 else { return nil }
        guard let r = cards[id] else { return UnitPoint(x: 0.5, y: 0.38) }
        let line = viewport * 0.38
        if r.minY >= 12 && r.minY <= line - 24 && r.maxY >= line + 24 { return nil }
        if r.height < viewport * 0.7 { return UnitPoint(x: 0.5, y: 0.38) }
        return UnitPoint.top
    }
}

/// Reports the frame of whatever it sits behind, in the feed's scroll space, as it moves.
struct FeedFrameReporter: View {
    var report: (CGRect) -> Void

    var body: some View {
        GeometryReader { geo in
            let frame = geo.frame(in: .named(feedScrollSpace))
            Color.clear
                .onAppear { report(frame) }
                .onChange(of: frame) { _, now in report(now) }
        }
        .accessibilityHidden(true)
    }
}

import SwiftUI

/// One post in the feed: its picture first, then the words, then one line saying who posted it,
/// when and where it came from, with the bookmark and the way into its comments at its end. The
/// same card at every width, so a post reads alike in one column, in two and on a phone.
struct FeedPostCard: View {
    var post: Post
    var model: FeedModel

    var body: some View {
        let open = model.commentsOpen && model.activeID == post.id
        VStack(alignment: .leading, spacing: 0) {
            FeedPicture(post: post, model: model)
            VStack(alignment: .leading, spacing: 0) {
                FeedPostBody(post: post)
                if let page = post.page {
                    PageCard(page: page).padding(.top, 10)
                }
                FeedByline(post: post, model: model, open: open)
            }
            .padding(.horizontal, 10)
            .padding(.top, FeedPicture.shows(post) ? 12 : 10)
        }
        .padding(6)
        .glass(radius: 26, lifted: open)
        .background {
            FeedFrameReporter { frame in model.cardMoved(post.id, frame) }
        }
        .onDisappear { model.cardGone(post.id) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feed.post.\(post.id)")
    }
}

/// The words of a post, with @mentions picked out. Tapping them opens where the post came from.
private struct FeedPostBody: View {
    var post: Post
    @Environment(AppModel.self) private var app

    private var words: AttributedString {
        var a = richText(post.body, handles: app.handles)
        a.font = Font.system(size: 16.5, weight: .medium)
        return a
    }

    var body: some View {
        Text(words)
            .foregroundStyle(Theme.ink)
            .tracking(-0.23)
            .lineSpacing(2)
            .lineLimit(4)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .modifier(FeedToSource(source: post.source))
            .accessibilityIdentifier("feed.post.body.\(post.id)")
    }
}

/// Makes part of a post open where the post came from. Without a source it is plain content.
struct FeedToSource: ViewModifier {
    var source: Source?
    @Environment(AppModel.self) private var app

    func body(content: Content) -> some View {
        if let source {
            content
                .contentShape(Rectangle())
                .onTapGesture { app.open(source.url) }
        } else {
            content
        }
    }
}

/// The last line of a card: who posted it and how long ago, the source's name, save to links,
/// and the comment button. The source gives way first when the line is short of room.
private struct FeedByline: View {
    var post: Post
    var model: FeedModel
    var open: Bool
    @Environment(AppModel.self) private var app

    var body: some View {
        let author = app.agent(post.author)
        HStack(spacing: 8) {
            AvatarView(agent: author, size: 22)
            Text(author?.name ?? "Unknown")
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .layoutPriority(1)
            Text(ago(post.created_at))
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink3)
                .lineLimit(1)
                .fixedSize()
            if let source = post.source {
                Text("·")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.ink3)
                    .accessibilityHidden(true)
                Button {
                    app.open(source.url)
                } label: {
                    Text(source.name)
                        .font(.system(size: 13))
                        .underline(true, color: Theme.line)
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(1)
                        .frame(minHeight: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.97))
                .accessibilityHint("Opens the source")
                .accessibilityIdentifier("feed.source.\(post.id)")
            }
            Spacer(minLength: 0)
            if post.source != nil {
                FeedSaveLink(post: post, model: model)
            }
            FeedCommentButton(post: post, model: model, open: open)
        }
        .frame(minHeight: 36)
        .padding(.top, 6)
        .padding(.trailing, -6)
    }
}

/// Bookmarks a post to come back to. The mark is stored with the post, and its source is kept
/// in the saved links. It fills in accent and stays so until tapped again.
private struct FeedSaveLink: View {
    var post: Post
    var model: FeedModel

    var body: some View {
        let on = post.bookmarked_at != nil
        Button {
            Task { await model.toggleBookmark(post) }
        } label: {
            Image(systemName: on ? "bookmark.fill" : "bookmark")
                .font(.system(size: 15))
                .foregroundStyle(on ? Theme.accent : Theme.ink3)
                .frame(width: 36, height: 36)
                .contentShape(Circle())
        }
        .buttonStyle(PressStyle(scale: 0.9))
        .accessibilityLabel(on ? "Remove bookmark" : "Bookmark")
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("feed.save.\(post.id)")
    }
}

private struct FeedCommentButton: View {
    var post: Post
    var model: FeedModel
    var open: Bool

    private var label: String {
        if open { return "Close comments" }
        let n = post.reply_count ?? 0
        if n == 0 { return "Comments" }
        return "Comments, \(n) \(n == 1 ? "reply" : "replies")"
    }

    var body: some View {
        let n = post.reply_count ?? 0
        Button {
            model.toggleComments(post.id)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: open ? "bubble.left.fill" : "bubble.left")
                    .font(.system(size: 15))
                if n > 0 {
                    Text("\(n)")
                        .font(.system(size: 13))
                        .monospacedDigit()
                }
            }
            .foregroundStyle(open ? Theme.accent : Theme.ink3)
            .padding(.horizontal, 10)
            .frame(minWidth: 36, minHeight: 36)
            .background(open ? Theme.accentSoft : Color.clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(PressStyle(scale: 0.94))
        .accessibilityLabel(label)
        .accessibilityIdentifier("feed.comments.\(post.id)")
    }
}

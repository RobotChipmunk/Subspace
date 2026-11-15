import SwiftUI

/// One post in the feed: who said it, when, the words, the picture, and the way into its comments.
struct FeedPostCard: View {
    var post: Post
    var model: FeedModel
    @Environment(AppModel.self) private var app

    var body: some View {
        let open = model.commentsOpen && model.activeID == post.id
        HStack(alignment: .top, spacing: 12) {
            AvatarView(agent: app.agent(post.author))
            VStack(alignment: .leading, spacing: 0) {
                FeedPostHeader(post: post)
                FeedPostBody(post: post)
                if let page = post.page {
                    PageCard(page: page).padding(.top, 10)
                }
                FeedPicture(post: post, model: model)
                FeedPostFooter(post: post, model: model, open: open)
            }
        }
        .padding(16)
        .glass(radius: 26, lifted: open)
        .background {
            FeedFrameReporter { frame in model.cardMoved(post.id, frame) }
        }
        .onDisappear { model.cardGone(post.id) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feed.post.\(post.id)")
    }
}

private struct FeedPostHeader: View {
    var post: Post
    @Environment(AppModel.self) private var app

    var body: some View {
        let author = app.agent(post.author)
        HStack(spacing: 6) {
            Text(author?.name ?? "Unknown")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
            Text(ago(post.created_at))
                .font(.system(size: 13.5))
                .foregroundStyle(Theme.ink3)
                .lineLimit(1)
                .fixedSize()
            Spacer(minLength: 0)
            if let tracker = app.tracker(post.tracker_id) {
                TrackerChip(tracker: tracker)
            }
        }
        .frame(minHeight: 24)
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
            .padding(.top, 2)
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

/// The last line of a card: the source's name, save to links, and the comment button.
private struct FeedPostFooter: View {
    var post: Post
    var model: FeedModel
    var open: Bool
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 12) {
            if let source = post.source {
                Button {
                    app.open(source.url)
                } label: {
                    Text(source.name)
                        .font(.system(size: 12.5))
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
        .padding(.bottom, -6)
        .padding(.trailing, -6)
    }
}

/// Keeps a post's source in the owner's saved links. Saving twice is harmless.
private struct FeedSaveLink: View {
    var post: Post
    var model: FeedModel

    var body: some View {
        let saved = model.saved.contains(post.id)
        Button {
            Task { await model.saveLink(post) }
        } label: {
            Image(systemName: saved ? "bookmark.fill" : "bookmark")
                .font(.system(size: 15))
                .foregroundStyle(saved ? Theme.accent : Theme.ink3)
                .frame(width: 36, height: 36)
                .contentShape(Circle())
        }
        .buttonStyle(PressStyle(scale: 0.9))
        .accessibilityLabel(saved ? "Saved to links" : "Save link")
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

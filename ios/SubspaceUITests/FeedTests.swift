import XCTest

/// The feed: posts with pictures, clips and illustrations, and comments.
final class FeedTests: SubspaceTestCase {
    private func body(_ part: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'feed.post.body.' AND label CONTAINS %@", part)).firstMatch
    }

    func testFeedShowsSeededPostsAndScrolls() {
        launchSignedIn()
        expect(body("Italian place for Saturday"), "the newest seeded post")
        shot("50-feed-top")
        // Scroll through the feed: pictures, a clip and illustrations pass by.
        for i in 1...4 {
            app.swipeUp()
            shot("50-feed-scroll-\(i)")
        }
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'feed.post.'")).firstMatch, "posts further down the feed")
    }

    func testReadCommentsAndReply() {
        launchSignedIn()
        expect(body("Italian place for Saturday"), "the post that has a reply")
        let button = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'feed.comments.' AND label CONTAINS '1 reply'")).firstMatch
        expect(button, "its comment button, showing one reply").tap()
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'feed.reply.' AND identifier != 'feed.reply.field' AND identifier != 'feed.reply.send'")).firstMatch, "the existing reply")
        shot("51-feed-comments")

        let field = expect(app.descendants(matching: .any)["feed.reply.field"], "the reply field")
        field.tap()
        field.typeText("Saturday at seven works")
        expect(app.buttons["feed.reply.send"], "the send button").tap()
        expect(textContaining("Saturday at seven works"), "the reply just sent, in the thread")
        shot("51-feed-replied")
    }
}

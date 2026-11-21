import XCTest

/// The feed: posts with pictures, clips and illustrations, and comments.
final class FeedTests: SubspaceTestCase {
    private func body(_ part: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'feed.post.body.' AND label CONTAINS %@", part)).firstMatch
    }

    func testFeedShowsSeededPostsAndScrolls() {
        launchSignedIn()
        expect(body("Italian place for Saturday"), "the newest seeded post")
        // As many columns as fit, each at least as wide as a post on a phone: one on a phone, two or
        // more on an iPad. Counted from where the words of every post on screen start (the same
        // distance inside every card), once the posts have settled, by the clear gaps between them.
        Thread.sleep(forTimeInterval: 1.2)
        let words = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'feed.post.body.'"))
        let lefts = words.allElementsBoundByIndex.map { $0.frame.minX }.sorted()
        let columns = lefts.isEmpty ? 0 : 1 + zip(lefts, lefts.dropFirst()).filter { $1 - $0 > 60 }.count
        if isPad {
            XCTAssertGreaterThanOrEqual(columns, 2, "On an iPad the feed should run in columns; the posts' words start at \(lefts.map { Int($0) })")
        } else {
            XCTAssertEqual(columns, 1, "On a phone the feed should be one column; the posts' words start at \(lefts.map { Int($0) })")
        }
        // No post shows the topic it belongs to (the seeded topics are labelled these).
        XCTAssertFalse(app.staticTexts["Robotics"].exists || app.staticTexts["West Seattle"].exists, "A post should not carry its topic's label")
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

    func testBookmarkAPostAndShowBookmarkedOnly() {
        launchSignedIn()
        expect(body("Italian place for Saturday"), "the feed")

        // Nothing is bookmarked in the seeded data.
        press(app.buttons["feed.bookmarked"], "the Bookmarked toggle in the header")
        expect(app.descendants(matching: .any)["feed.bookmarked.empty"], "the empty bookmarked view")
        shot("52-feed-bookmarked-empty")
        press(app.buttons["feed.bookmarked"], "the Bookmarked toggle, to show everything again")
        expect(body("Italian place for Saturday"), "the whole feed again")

        // Bookmark the first post that has a source (only those can be bookmarked).
        let mark = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'feed.save.' AND label == 'Bookmark'")).firstMatch
        var swipes = 0
        while !mark.exists && swipes < 6 {
            app.swipeUp()
            swipes += 1
        }
        // let the feed come to rest, so the tap lands on the button and not on what slides under it
        Thread.sleep(forTimeInterval: 0.8)
        expect(mark, "a bookmark button on a post with a source").tap()
        XCTAssertEqual(app.state, .runningForeground, "Tapping the bookmark should stay in the app, not open the post's source")
        expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'feed.save.' AND label == 'Remove bookmark'")).firstMatch, "the bookmark, filled in")
        shot("52-feed-bookmarked-post")

        // Back to the top, and narrow the feed to bookmarked posts.
        for _ in 0..<(swipes + 1) { app.swipeDown() }
        press(app.buttons["feed.bookmarked"], "the Bookmarked toggle")
        expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'feed.save.' AND label == 'Remove bookmark'")).firstMatch, "the bookmarked post, alone in the bookmarked view")
        waitToVanish(body("Italian place for Saturday"), "posts that are not bookmarked")
        shot("52-feed-bookmarked-only")
    }
}

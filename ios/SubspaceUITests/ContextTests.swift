import XCTest

/// The context tree, pages with blocks, saved links and search.
final class ContextTests: SubspaceTestCase {
    func testBrowseAreasAndOpenAPage() {
        launchSignedIn()
        go("context")
        let home = expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'context.node.' AND label == 'Home'")).firstMatch, "the Home area")
        expect(textContaining("Portland dinner options"), "a recent page on the shelf")
        shot("20-context")

        home.tap()
        expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'context.node.' AND label == 'Travel'")).firstMatch, "Travel inside Home")
        shot("20-context-home")
        app.buttons["context.crumb.root"].tap()

        let page = expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'context.page.' AND label CONTAINS 'Portland dinner options'")).firstMatch, "the Portland page tile")
        page.tap()
        expect(app.descendants(matching: .any)["page.title"], "the page's title")
        expect(textContaining("Nostrana"), "a card from the page's blocks")
        shot("21-page-top")
        app.swipeUp()
        shot("21-page-scrolled")
    }

    func testSearchFindsAcrossTheWorkspace() {
        launchSignedIn()
        go("context")
        let search = expect(app.textFields["context.search"], "the search field")
        search.tap()
        search.typeText("portland")
        expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'context.hit.'")).firstMatch, "search results")
        expect(textContaining("Portland dinner options"), "the page among the results")
        shot("22-context-search")
    }

    func testSaveALink() {
        launchSignedIn()
        go("context")
        expect(app.buttons["context.links"], "the Links pill").tap()
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'context.link.' AND NOT identifier BEGINSWITH 'context.link.notes.'"))
        expect(rows.firstMatch, "the seeded links")
        let before = rows.count
        shot("23-links")

        let url = expect(app.textFields["context.addlink.url"], "the address field")
        url.tap()
        url.typeText("https://example.com/ios-ui-test")
        let why = expect(app.textFields["context.addlink.why"], "the reason field, once the address is valid")
        why.tap()
        why.typeText("Saved by the UI test")
        app.buttons["context.addlink.save"].tap()
        expect(textContaining("Saved by the UI test"), "the new link with its reason", timeout: 30)
        XCTAssertEqual(rows.count, before + 1, "One more link than before")
        shot("23-links-added")
    }
}

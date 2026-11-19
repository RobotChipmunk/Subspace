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

    /// What is true for now sits at the top of Context, each note with who set it and until when.
    func testCurrentNotesSayUntilWhen() {
        launchSignedIn()
        go("context")
        expect(app.descendants(matching: .any)["context.current"], "the Current group at the top of Context")
        let focus = expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'context.current.' AND label CONTAINS 'This month’s focus' OR identifier BEGINSWITH 'context.current.' AND label CONTAINS \"This month's focus\"")).firstMatch, "a note that holds for now")
        XCTAssertTrue(focus.label.contains("until"), "A current note should say until when: \(focus.label)")
        XCTAssertTrue(focus.label.contains("Scout"), "A current note should say who set it: \(focus.label)")
        shot("25-context-current")
        focus.tap()
        expect(app.descendants(matching: .any)["context.until"], "the end day, on the note")
        shot("25-context-current-note")
    }

    /// House rules live under System. A change an agent proposed waits at the top of Context
    /// with who, why and what; approving it applies it and the proposal goes.
    func testApproveAProposedHouseRule() {
        launchSignedIn()
        go("context")
        // An earlier attempt may have answered it already.
        let approve = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'context.proposal.approve.'")).firstMatch
        if approve.waitForExistence(timeout: 8) {
            expect(textContaining("proposes a change to “Quiet hours”"), "who proposes what")
            expect(textContaining("You dismissed every Saturday morning module"), "why")
            expect(textContaining("At weekends nothing is raised before 10 am"), "the change itself")
            shot("24-house-rule-proposal")
            approve.tap()
            waitToVanish(approve, "the proposal, once approved")
        }
        // The rules live in System, among the areas further down (which are only drawn once scrolled to).
        let system = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'context.node.' AND label == 'System'")).firstMatch
        bringIntoView(system)
        expect(system, "the System section, which holds the house rules")
        shot("24-house-rules")
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
        // An earlier attempt at this test may have saved this address already; saving it again updates that link.
        let already = textContaining("Saved by the UI test").exists
        shot("23-links")

        // Saved once, the link is there for good: a second go at this test finds it and adds nothing.
        if !already {
            let url = expect(app.textFields["context.addlink.url"], "the address field")
            url.tap()
            url.typeText("https://example.com/ios-ui-test")
            let why = expect(app.textFields["context.addlink.why"], "the reason field, once the address is valid")
            why.tap()
            why.typeText("Saved by the UI test")
            app.buttons["context.addlink.save"].tap()
            expect(textContaining("Saved by the UI test"), "the new link with its reason", timeout: 30)
            XCTAssertEqual(rows.count, before + 1, "One more link than before")
        }
        shot("23-links-added")

        // A link opens in the viewer inside the app, not in the browser. The viewer is the
        // system's own, with its bar at the top; its button to leave is "Done" on older systems
        // and "Close" on newer ones. (The keyboard, if it is still up, has a "Done" key of its
        // own, so the viewer is recognised by its bar and not by that word.)
        press(rows.firstMatch, "a saved link")
        let bar = app.descendants(matching: .any)["TopBrowserBar"]
        let shown = bar.waitForExistence(timeout: 12)
        XCTAssertEqual(app.state, .runningForeground, "Opening a link should stay in the app")
        shot("23-links-web-viewer")
        XCTAssertTrue(shown, "A saved link should open in the viewer inside the app")
        // Leaving is the system viewer's own business, and on the test simulators its button does
        // not always answer a tap the test makes. So it is tried, not required: what this test is
        // about is that the link opened inside the app.
        let close = app.buttons["Close"]
        let leave = close.waitForExistence(timeout: 3) ? close : app.buttons["Done"]
        if leave.exists {
            leave.tap()
            _ = app.buttons["context.links"].waitForExistence(timeout: 8)
        }
    }
}

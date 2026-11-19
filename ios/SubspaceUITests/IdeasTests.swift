import XCTest

/// Ideas: the shelf of canvases, and one canvas with the owner's words and the pieces agents grew from them.
final class IdeasTests: SubspaceTestCase {
    /// Under its name an idea says what stands: that an agent thinks it is ready to act on, with the
    /// first step, and which other idea it has something in common with. (Making the task is checked
    /// on the web; here it would leave a task in Today for the tests that follow.)
    func testAnIdeaSaysItIsReadyAndWhatItIsNear() {
        launchSignedIn()
        go("ideas")
        let card = expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'ideas.card.' AND label CONTAINS 'A cargo trailer for the bike'")).firstMatch, "the seeded idea, on the shelf")
        card.tap()
        expect(app.descendants(matching: .any)["ideas.canvas.surface"], "the canvas")

        // The way across to the idea it is near, and back again.
        let nearIt = NSPredicate(format: "identifier BEGINSWITH 'ideas.near.' AND NOT (identifier BEGINSWITH 'ideas.near.aside.')")
        let across = expect(app.buttons.matching(nearIt).firstMatch, "the idea this one is near")
        XCTAssertTrue(across.label.contains("A workshop corner in the garage"), "A near idea should be named: \(across.label)")
        expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'ideas.near.aside.'")).firstMatch, "Not related, on a near idea")
        shot("51-idea-ready-and-near")
        across.tap()
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'ideas.piece.' AND label CONTAINS 'A bench under the window'")).firstMatch, "the near idea's canvas")
        let back = expect(app.buttons.matching(nearIt).firstMatch, "the way back from the near idea")
        XCTAssertTrue(back.label.contains("A cargo trailer for the bike"), "The near idea should name the one it came from: \(back.label)")
        back.tap()
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'ideas.piece.' AND label BEGINSWITH 'Yours: A cargo trailer'")).firstMatch, "the first idea's canvas again")

        // Ready to act on: who thinks so, the first step, and the two answers. "Not yet" takes the
        // note away. (A second attempt at this test finds it already answered, and stops here.)
        let step = app.staticTexts["Measure the garage wall for a fold-flat trailer"]
        guard step.waitForExistence(timeout: 10) else { return }
        expect(app.staticTexts["Scout thinks this is ready"], "who thinks the idea is ready")
        expect(app.buttons["ideas.ripe.task"], "Make a task")
        let notYet = expect(app.buttons["ideas.ripe.notyet"], "Not yet")
        notYet.tap()
        waitToVanish(step, "the ready note, after Not yet")
    }

    func testOpenAnIdeaAndKeepAPiece() {
        launchSignedIn()
        go("ideas")
        let card = expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'ideas.card.' AND label CONTAINS 'A cargo trailer for the bike'")).firstMatch, "the seeded idea, on the shelf")
        expect(app.buttons["ideas.new"], "New idea")
        shot("50-ideas")
        card.tap()

        // The canvas: the owner's own words, and what agents branched from them.
        expect(app.descendants(matching: .any)["ideas.canvas.surface"], "the canvas")
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'ideas.piece.' AND label BEGINSWITH 'Yours: A cargo trailer'")).firstMatch, "the owner's words on the canvas")
        let found = expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'ideas.piece.' AND label CONTAINS 'Burley'")).firstMatch, "a piece an agent found")
        XCTAssertTrue(found.label.hasPrefix("Atlas"), "An agent's piece should say whose it is: \(found.label)")
        shot("50-idea-canvas")

        // A chosen piece offers keep, more and prune. Keeping marks it; letting go takes the mark off again.
        found.tap()
        let keep = expect(app.buttons["ideas.act.keep"], "Keep, for the chosen piece")
        expect(app.buttons["ideas.act.more"], "More of this")
        expect(app.buttons["ideas.act.prune"], "Prune")
        if !keep.label.hasPrefix("Kept") { keep.tap() }
        let kept = NSPredicate(format: "label BEGINSWITH 'Kept'")
        wait(for: [XCTNSPredicateExpectation(predicate: kept, object: keep)], timeout: 8)
        shot("50-idea-piece-kept")
        keep.tap()
        wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'Keep'"), object: keep)], timeout: 8)

        // Back to the shelf. If the tap does not get there, say where the button was and what else
        // was at that spot, so the reason can be read from the failure.
        let back = expect(app.buttons["ideas.back"], "the way back to the shelf")
        let spot = "back at \(back.frame), hittable \(back.isHittable), in a window of \(app.windows.firstMatch.frame); the canvas is \(app.descendants(matching: .any)["ideas.canvas.surface"].frame), the name field \(app.textFields["ideas.title"].frame), the app bar's first button \(app.buttons["nav.feed"].frame)"
        back.tap()
        if !app.buttons["ideas.new"].waitForExistence(timeout: 8) {
            let stillChosen = app.buttons["ideas.act.keep"].exists
            back.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let second = app.buttons["ideas.new"].waitForExistence(timeout: 8)
            XCTFail("Back did not return to the shelf (\(spot)); the piece was \(stillChosen ? "still" : "no longer") chosen afterwards; a tap at the button's centre \(second ? "did" : "did not") work")
        }
        expect(app.buttons["ideas.new"], "the shelf again")
    }
}

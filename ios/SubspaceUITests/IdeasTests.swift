import XCTest

/// Ideas: the shelf of canvases, and one canvas with the owner's words and the pieces agents grew from them.
final class IdeasTests: SubspaceTestCase {
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

        app.buttons["ideas.back"].tap()
        expect(app.buttons["ideas.new"], "the shelf again")
    }
}

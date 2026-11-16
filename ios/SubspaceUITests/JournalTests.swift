import XCTest

/// The journal: entries under their months, tags that narrow the list, an entry with its blocks,
/// and writing a new one that the app tags by itself.
final class JournalTests: SubspaceTestCase {
    private func row(_ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'journal.entry.' AND label == %@", title)).firstMatch
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// Entries an earlier, unfinished run of the writing test left behind (a failed test is run once more).
    private func removeLeftovers() {
        let leftovers = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'journal.entry.' AND (label BEGINSWITH 'Scratch entry' OR label == 'Untitled')"))
        for _ in 0..<4 {
            let leftover = leftovers.firstMatch
            if !leftover.waitForExistence(timeout: 2) { return }
            leftover.tap()
            let delete = expect(element("journal.delete"), "the delete control of a leftover entry")
            delete.tap()
            Thread.sleep(forTimeInterval: 0.5)
            delete.tap()
            expect(row("Sketching again"), "the list again after removing a leftover entry")
        }
    }

    func testListTagsAndAnEntryWithALinkPreview() {
        launchSignedIn()
        go("journal")
        XCTAssertTrue(app.buttons["nav.journal"].isSelected, "Journal should be the selected screen")
        expect(row("What the agents are for"), "today's seeded entry")
        expect(row("Sketching again"), "yesterday's seeded entry")
        expect(row("A lesson from the roof"), "the seeded entry from four days ago")
        expect(row("Walking the bridge"), "the seeded entry from last month")
        let months = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'journal.month.' AND NOT (identifier ENDSWITH '.summary')"))
        expect(months.firstMatch, "a month heading")
        XCTAssertGreaterThanOrEqual(months.count, 2, "Entries 38 days apart sit under different months")
        // The month at a glance: a dot per entry by mood, the mood most share, its themes.
        // The seed dates entries by the UTC day, so this month is the UTC month.
        let month = DateFormatter()
        month.locale = Locale(identifier: "en_US_POSIX")
        month.timeZone = TimeZone(secondsFromGMT: 0)
        month.dateFormat = "yyyy-MM"
        let glance = expect(element("journal.month.\(month.string(from: Date())).summary"), "this month's summary under its name")
        XCTAssertTrue(glance.label.lowercased().contains("mostly"), "The month should name its leading mood, not \(glance.label)")
        shot("15-journal")

        // A tag narrows the list; the same tag again shows everything.
        let creativity = expect(app.buttons["journal.tag.Creativity"], "the Creativity tag above the list")
        creativity.tap()
        waitToVanish(row("A lesson from the roof"), "an entry without the chosen tag")
        expect(row("Sketching again"), "the entry tagged Creativity")
        XCTAssertTrue(app.buttons["journal.tag.Creativity"].isSelected, "The chosen tag should read as selected")
        shot("15-journal-tag")
        app.buttons["journal.tag.Creativity"].tap()
        expect(row("A lesson from the roof"), "every entry again once the tag is cleared")

        // An entry opens in place of the list, with its blocks drawn.
        row("What the agents are for").tap()
        expect(element("journal.title"), "the entry's title")
        expect(app.buttons["journal.date"], "the date pill")
        expect(textContaining("The case for slow interfaces"), "the link preview card in the entry")
        shot("16-journal-entry")

        // The date pill opens the month calendar in place, and closes it again.
        app.buttons["journal.date"].tap()
        expect(element("journal.calendar"), "the month calendar")
        shot("16-journal-calendar")
        app.buttons["journal.date"].tap()
        waitToVanish(element("journal.calendar"), "the month calendar, closed")

        app.buttons["journal.crumb.root"].tap()
        expect(row("Sketching again"), "the list again after leaving the entry")
    }

    func testWriteAnEntryThatTagsItselfThenDeleteIt() {
        launchSignedIn()
        go("journal")
        expect(row("Sketching again"), "the seeded entries")
        removeLeftovers()

        // New entry: it opens ready to be named.
        expect(app.buttons["journal.new"], "New entry").tap()
        let titleField = expect(element("journal.title"), "the new entry's title")
        let title = "Scratch entry \(Int.random(in: 1000...9999))"
        enter(title, into: titleField, "the title of the new entry")
        shot("17-journal-new")

        let editor = expect(app.textViews["journal.body.editor"], "the editor of a new entry")
        enter("Thinking about how AI models and prompts change the way agents work for me.", into: editor, "the editor")
        Thread.sleep(forTimeInterval: 1.5) // typing stops; the save goes out after 700ms
        press(app.buttons["journal.edit"], "Done")

        // A moment after writing stops the app reads the entry and tags it.
        expect(element("journal.tags.item.AI"), "the tag AI, chosen by the app", timeout: 30)
        expect(element("journal.tags.auto"), "the line saying the app chose the tags")
        expect(element("journal.gist"), "the entry's gist under its title")
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'journal.body' OR identifier == 'blocks.document'")).firstMatch, "what was written, drawn")
        expect(element("journal.addimage"), "Add a picture")
        shot("17-journal-tagged")

        // A mood chosen by hand shows on the pill at once.
        expect(element("journal.mood"), "the mood pill").tap()
        expect(app.buttons["Hopeful"], "Hopeful in the mood menu").tap()
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'journal.mood' AND label CONTAINS 'Hopeful'")).firstMatch, "the mood pill reading Hopeful")
        shot("17-journal-mood")

        // A tag added by hand: from then on the tags are the owner's.
        press(app.buttons["journal.tags.add"], "the Tag pill")
        let field = expect(element("journal.tags.field"), "the field for a new tag")
        enter("Scratch\n", into: field, "the field for a new tag")
        expect(element("journal.tags.item.Scratch"), "the tag added by hand")
        waitToVanish(element("journal.tags.auto"), "the line saying the app chose the tags")
        shot("17-journal-tag-added")

        // Delete: the first tap arms, the second does it, and the list is as it was.
        let delete = element("journal.delete")
        expect(delete, "the delete control").tap()
        shot("17-journal-delete-armed")
        delete.tap()
        expect(row("Sketching again"), "the list after deleting the entry")
        waitToVanish(row(title), "the deleted entry")
    }
}

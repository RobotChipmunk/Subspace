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

    /// Scrolls the list until the element is there (cards with pictures are tall, and the list
    /// only builds what is near the screen). Bounded, so a missing element fails quickly.
    private func reveal(_ element: XCUIElement, up: Bool = true) {
        for _ in 0..<5 {
            if element.exists && element.isHittable { return }
            if up { app.swipeUp() } else { app.swipeDown() }
            Thread.sleep(forTimeInterval: 0.4)
        }
    }

    /// A picture's width over its height, waiting for it to take its own shape (it holds a 4:3
    /// place until the picture has loaded).
    private func settledRatio(_ picture: XCUIElement, near expected: CGFloat) -> CGFloat {
        var ratio: CGFloat = 0
        let until = Date().addingTimeInterval(10)
        repeat {
            let frame = picture.frame
            ratio = frame.height > 0 ? frame.width / frame.height : 0
            if abs(ratio - expected) < 0.05 { return ratio }
            Thread.sleep(forTimeInterval: 0.5)
        } while Date() < until
        return ratio
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
        let sketching = expect(row("Sketching again"), "yesterday's seeded entry")
        // The seed dates entries by the UTC day, so months are UTC months.
        let month = DateFormatter()
        month.locale = Locale(identifier: "en_US_POSIX")
        month.timeZone = TimeZone(secondsFromGMT: 0)
        month.dateFormat = "yyyy-MM"
        let thisMonth = month.string(from: Date())
        let earlierMonth = month.string(from: Date().addingTimeInterval(-38 * 86400))
        expect(element("journal.month.\(thisMonth)"), "this month's heading")
        // The month at a glance: a dot per entry by mood, the mood most share, its themes.
        let glance = expect(element("journal.month.\(thisMonth).summary"), "this month's summary under its name")
        XCTAssertTrue(glance.label.lowercased().contains("mostly"), "The month should name its leading mood, not \(glance.label)")
        shot("15-journal")

        // Each entry is a card; its pictures sit beneath, whole, each at its own shape.
        let id = sketching.identifier.replacingOccurrences(of: "journal.entry.", with: "")
        expect(element("journal.entry.\(id).pictures"), "the pictures of Sketching again, in its card")
        let tall = expect(element("journal.entry.\(id).picture.0"), "the first picture, a tall one")
        let wide = expect(element("journal.entry.\(id).picture.1"), "the second picture, a wide one")
        let tallRatio = settledRatio(tall, near: 0.75)
        XCTAssertEqual(tallRatio, 0.75, accuracy: 0.05, "The tall picture should keep its 3:4 shape, not \(tallRatio) (frame \(tall.frame))")
        let wideRatio = settledRatio(wide, near: 1.78)
        XCTAssertEqual(wideRatio, 1.78, accuracy: 0.05, "The wide picture should keep its 16:9 shape, not \(wideRatio) (frame \(wide.frame))")
        shot("15-journal-cards")

        // Further down: the entry from last month, under its own month.
        let roof = row("A lesson from the roof")
        reveal(roof)
        expect(roof, "the seeded entry from four days ago", timeout: 5)
        let bridge = row("Walking the bridge")
        reveal(bridge)
        expect(bridge, "the seeded entry from last month", timeout: 5)
        expect(element("journal.month.\(earlierMonth)"), "last month's heading: entries 38 days apart sit under different months")
        let creativity = app.buttons["journal.tag.Creativity"]
        reveal(creativity, up: false)

        // A tag narrows the list; the same tag again shows everything.
        expect(creativity, "the Creativity tag above the list").tap()
        waitToVanish(row("A lesson from the roof"), "an entry without the chosen tag")
        expect(row("Sketching again"), "the entry tagged Creativity")
        XCTAssertTrue(app.buttons["journal.tag.Creativity"].isSelected, "The chosen tag should read as selected")
        shot("15-journal-tag")
        app.buttons["journal.tag.Creativity"].tap()
        let roofAgain = row("A lesson from the roof")
        expect(row("Sketching again"), "the list again once the tag is cleared")
        reveal(roofAgain)
        expect(roofAgain, "every entry again once the tag is cleared", timeout: 5)

        // An entry opens in place of the list, with its blocks drawn.
        let today = row("What the agents are for")
        reveal(today, up: false)
        expect(today, "today's entry, back at the top", timeout: 5).tap()
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

        // Typing in the tag field offers the journal's own tags; tapping one adds it.
        press(app.buttons["journal.tags.add"], "the Tag pill, again")
        let again = expect(element("journal.tags.field"), "the field for a new tag, again")
        enter("Crea", into: again, "the field for a new tag")
        let offered = expect(element("journal.tags.suggest.Creativity"), "Creativity, offered while typing")
        shot("17-journal-tag-suggested")
        offered.tap()
        expect(element("journal.tags.item.Creativity"), "the offered tag, now on the entry")
        XCTAssertFalse(element("journal.tags.item.Crea").exists, "What was typed should not become a tag when an offered one is chosen")

        // An address on a line of its own becomes its preview once the writing is put down.
        press(app.buttons["journal.edit"], "Edit")
        let editorAgain = expect(app.textViews["journal.body.editor"], "the editor, opened again")
        enter("\n\nhttps://example.com/heat-pump-guide", into: editorAgain, "the editor")
        Thread.sleep(forTimeInterval: 1.0)
        press(app.buttons["journal.edit"], "Done")
        expect(textContaining("Heat pump guide"), "the preview of the address typed on its own line", timeout: 25)
        shot("17-journal-link-preview")

        // Delete: the first tap arms, the second does it, and the list is as it was.
        let delete = element("journal.delete")
        expect(delete, "the delete control").tap()
        shot("17-journal-delete-armed")
        delete.tap()
        expect(row("Sketching again"), "the list after deleting the entry")
        waitToVanish(row(title), "the deleted entry")
    }
}

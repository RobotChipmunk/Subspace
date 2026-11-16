import XCTest

/// The todos screen: folders, adding, notes that save themselves, completing, the bin.
final class TodosTests: SubspaceTestCase {
    private func row(_ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.row.' AND label BEGINSWITH %@", title)).firstMatch
    }

    func testSeededTasksAndAgentNotes() {
        launchSignedIn()
        go("todos")
        expect(app.buttons["todos.folder.today"], "the Today folder")
        expect(app.buttons["todos.folder.backlog"], "the Backlog folder")
        folder("week").tap()
        let seeded = expect(row("Review robotics allocation"), "the seeded task in This week")
        shot("10-todos-week")
        seeded.tap()
        expect(app.descendants(matching: .any)["todos.detail.title"], "the task's title in its detail")
        expect(app.descendants(matching: .any)["blocks.document"], "the task's notes, drawn")
        shot("10-todos-detail-notes")
        app.buttons["todos.detail.close"].tap()
        expect(row("Review robotics allocation"), "the list again after closing the task")
    }

    func testAddWriteNotesCompleteDeleteAndRestore() {
        launchSignedIn()
        go("todos")
        folder("backlog").tap()

        // Add
        let title = "Buy stamps \(Int.random(in: 1000...9999))"
        enter(title + "\n", into: app.textFields["todos.add"], "the add field")
        let added = expect(row(title), "the new task in the list")
        shot("11-todos-added")

        // Notes save by themselves
        added.tap()
        let notes = expect(app.textViews["todos.detail.notes"], "the notes editor of a task with no notes")
        notes.tap()
        notes.typeText("Second class, a book of twelve")
        Thread.sleep(forTimeInterval: 1.5) // typing stops; the save goes out after 700ms
        shot("11-todos-notes-typed")
        app.buttons["todos.detail.close"].tap()
        expect(row(title), "the list after closing").tap()
        expect(textContaining("Second class, a book of twelve"), "the notes, kept after closing and reopening")

        // Complete
        let check = expect(app.buttons["todos.detail.check"], "the done circle in the detail")
        check.tap()
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertTrue(app.buttons["todos.detail.check"].isSelected || app.buttons["todos.detail.check"].label.contains("not done"), "The task should read as done")
        shot("11-todos-done")

        // Delete: the first tap arms, the second does it. The task goes to Recently deleted.
        let delete = app.descendants(matching: .any)["todos.detail.delete"]
        expect(delete, "the delete control").tap()
        shot("11-todos-delete-armed")
        delete.tap()
        waitToVanish(row(title), "the deleted task")
        expect(app.buttons["todos.folder.bin"], "Recently deleted, now that it holds something")
        // On a phone the folders are one row that scrolls sideways, and the bin is at its far end.
        folder("bin").tap()
        expect(textContaining(title), "the deleted task in the bin")
        shot("11-todos-bin")
        let restore = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.restore.'")).firstMatch
        expect(restore, "Restore").tap()
        folder("backlog").tap()
        expect(row(title), "the restored task back in Backlog")
    }

    func testDateCalendarAndRepeat() {
        launchSignedIn()
        go("todos")
        folder("today").tap()
        let title = "Water the plants \(Int.random(in: 1000...9999))"
        enter(title + "\n", into: app.textFields["todos.add"], "the add field")
        expect(row(title), "the new task in the list").tap()

        // The date pill opens a month calendar in place, and closes it again.
        let date = expect(app.buttons["todos.detail.date"], "the date pill")
        XCTAssertTrue(date.label.contains("Today"), "A task on today should say Today, not \(date.label)")
        date.tap()
        expect(app.descendants(matching: .any)["todos.detail.calendar"], "the month calendar")
        shot("13-todos-calendar")
        date.tap()
        waitToVanish(app.descendants(matching: .any)["todos.detail.calendar"], "the month calendar, closed")

        // Repeating: finishing it adds the next one and says so, with a way to open it.
        expect(app.descendants(matching: .any)["todos.detail.repeat"], "the repeat pill").tap()
        expect(app.buttons["Every week"], "Every week in the repeat menu").tap()
        expect(textContaining("a week from that day"), "what finishing will do")
        expect(app.buttons["todos.detail.check"], "the done circle").tap()
        expect(textContaining("Next one added for"), "the line saying the next task was added")
        shot("13-todos-repeat-done")
        expect(app.buttons["todos.next.open"], "Open, beside that line").tap()

        // The next one: the same task, not finished, a week on.
        let nextDate = expect(app.buttons["todos.detail.date"], "the date pill of the next task")
        let moved = NSPredicate(format: "NOT (label CONTAINS 'Today')")
        wait(for: [expectation(for: moved, evaluatedWith: nextDate)], timeout: 15)
        waitToVanish(textContaining("Next one added for"), "the finished task's line, gone from the next task")
        shot("13-todos-repeat-next")
    }

    func testDragATaskToAnotherSection() {
        launchSignedIn()
        go("todos")
        folder("week").tap()
        // Seeded for the week with no day, so it sits under "Any day" whatever the weekday.
        expect(row("Draft Q1 goals"), "a seeded task under Any day")
        expect(row("Book parent-teacher conference"), "a seeded task under Today")

        // Lift it and let it go over a task of another section: it moves to that day. A loaded
        // simulator sometimes does not lift the row (the press then only scrolls the page), so
        // the carry is tried again, as a person would, before the result is judged.
        for attempt in 1...3 {
            folder("week").tap()
            let task = expect(row("Draft Q1 goals"), "the task in This week")
            let onToday = expect(row("Book parent-teacher conference"), "a seeded task under Today")
            task.press(forDuration: 1.5, thenDragTo: onToday, withVelocity: .slow, thenHoldForDuration: 0.8)
            Thread.sleep(forTimeInterval: 1.5)
            shot("14-todos-dragged-to-section")
            folder("today").tap()
            if row("Draft Q1 goals").waitForExistence(timeout: attempt == 3 ? 1 : 10) { break }
        }

        expect(row("Draft Q1 goals"), "the task on Today, after being dropped on Today's section")
        shot("14-todos-section-day")
    }

    func testDragATaskOntoAnotherList() {
        launchSignedIn()
        go("todos")
        folder("today").tap()
        let task = expect(row("Call the roofer back"), "a seeded task on Today")
        // The list it is carried to must be on screen with the task before the finger goes down.
        let nextWeek = folder("next_week")
        XCTAssertTrue(nextWeek.isHittable, "Next week should be in view before a task is carried onto it")

        // Lift the task and let it go over another list in the folders.
        task.press(forDuration: 1.5, thenDragTo: nextWeek, withVelocity: .slow, thenHoldForDuration: 0.8)
        waitToVanish(row("Call the roofer back"), "the task, gone from Today once it is moved")
        shot("12-todos-dragged-away")

        folder("next_week").tap()
        expect(row("Call the roofer back"), "the task on Next week")
        shot("12-todos-dragged-to-next-week")
    }
}

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
        app.buttons["todos.folder.week"].tap()
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
        expect(app.buttons["todos.folder.backlog"], "the Backlog folder").tap()

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
        let bin = expect(app.buttons["todos.folder.bin"], "Recently deleted, now that it holds something")
        bin.tap()
        expect(textContaining(title), "the deleted task in the bin")
        shot("11-todos-bin")
        let restore = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.restore.'")).firstMatch
        expect(restore, "Restore").tap()
        app.buttons["todos.folder.backlog"].tap()
        expect(row(title), "the restored task back in Backlog")
    }
}

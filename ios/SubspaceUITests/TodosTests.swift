import XCTest

/// The todos screen: folders, adding, notes that save themselves, completing, the bin, tags.
final class TodosTests: SubspaceTestCase {
    private func row(_ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.row.' AND label BEGINSWITH %@", title)).firstMatch
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    /// The tag menu stays open while tags are ticked. A tap away from it closes it; `item` is one
    /// of its choices, there only while it is open, so nothing behind is tapped once it has closed.
    private func closeTagMenu(showing item: String) {
        if app.buttons[item].waitForExistence(timeout: 2) {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72)).tap()
            waitToVanish(app.buttons[item], "the tag menu")
        }
    }

    func testAllListAndTagFilter() {
        launchSignedIn()
        go("todos")
        // "All" holds every task, under the day or list it is on.
        folder("all").tap()
        expect(row("Review robotics allocation"), "a task on Today, in All")
        expect(row("Draft Q1 goals"), "a task set for the week, in All")
        expect(row("Replace the hallway light"), "a task in the backlog, in All")
        expect(element("todos.group.backlog"), "the Backlog section of All")
        shot("16-todos-all")

        // The filter sits at the right of the heading. Choosing a tag narrows the list to it.
        expect(element("todos.tags.filter"), "the tag filter, on a list with tagged tasks").tap()
        expect(app.buttons["finance"], "finance among the tags to choose from")
        shot("16-todos-tag-menu")
        expect(app.buttons["house"], "house among the tags to choose from").tap()
        closeTagMenu(showing: "finance")
        waitToVanish(row("Review robotics allocation"), "a task without the chosen tag")
        expect(row("Replace the hallway light"), "a task carrying the chosen tag")
        expect(row("Call the roofer back"), "another task carrying the chosen tag")
        shot("16-todos-all-house")

        // A second tag narrows it further: only tasks carrying both are left.
        element("todos.tags.filter").tap()
        expect(app.buttons["diy"], "diy among the tags to choose from").tap()
        closeTagMenu(showing: "finance")
        waitToVanish(row("Call the roofer back"), "a task carrying only one of the two chosen tags")
        expect(row("Replace the hallway light"), "the task carrying both chosen tags")
        shot("16-todos-all-house-diy")

        // The choice stays until it is taken off: on another list, and after a visit to another screen.
        folder("backlog").tap()
        expect(row("Replace the hallway light"), "the task carrying both tags, on Backlog")
        XCTAssertEqual(expect(element("todos.tags.filter"), "the tag filter on Backlog").label, "Tags: house, diy", "The chosen tags should follow to another list")
        go("feed")
        go("todos")
        XCTAssertEqual(expect(element("todos.tags.filter"), "the tag filter, back on Todos").label, "Tags: house, diy", "The chosen tags should still be on after leaving Todos and coming back")
        shot("16-todos-tags-kept")

        // "Show all" takes the choice off again.
        folder("all").tap()
        element("todos.tags.filter").tap()
        expect(app.buttons["Show all"], "Show all in the tag menu").tap()
        expect(row("Review robotics allocation"), "every task again, once the choice is off")
    }

    /// A line of the plan, by the words on it.
    private func planLine(_ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.plan.line.' AND label BEGINSWITH %@", title)).firstMatch
    }

    /// A task under an open line of the plan.
    private func planRow(_ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.plan.row.' AND label BEGINSWITH %@", title)).firstMatch
    }

    private func first(_ prefix: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
    }

    func testThePlan() {
        launchSignedIn()
        go("todos")
        // The plan sits with "All" in the folders: priorities, their parts, and the tasks under each.
        folder("plan").tap()
        expect(planLine("Start the year with a clear plan"), "a priority in the plan")
        let gap = expect(planLine("A budget we both agree on"), "a part with no tasks")
        XCTAssertFalse(gap.label.contains("Nothing yet"), "A line with no tasks should not be marked, but reads \(gap.label)")
        shot("17-todos-plan")

        // Tapping a line opens its tasks in place, each saying where it sits.
        let goals = expect(planLine("Goals for the first quarter"), "a part with a task")
        goals.tap()
        expect(planRow("Draft Q1 goals"), "the task under the opened line")
        // Open, its name is a field to type over, with the bin beside it.
        expect(first("todos.plan.name."), "the name of the open line, as a field")
        expect(first("todos.plan.remove."), "the bin beside the open line's name")
        shot("17-todos-plan-open")
        expect(app.buttons["Close Goals for the first quarter"], "the control that closes the open line").tap()
        waitToVanish(planRow("Draft Q1 goals"), "the tasks of a line that was closed")

        // A new priority goes at the end, with nothing under it yet.
        let name = "Sleep better \(Int.random(in: 1000...9999))"
        let adder = app.textFields["todos.plan.addPriority"]
        bringIntoView(adder)
        enter(name + "\n", into: adder, "the field that adds a priority")
        let line = expect(planLine(name), "the new priority")

        // Opened, its name can be typed over; return saves it.
        bringIntoView(line)
        line.tap()
        let field = expect(first("todos.plan.name."), "the name of the new priority, as a field")
        enter(" well\n", into: field, "the name of the new priority")
        let renamed = name + " well"
        expect(app.buttons["Close \(renamed)"], "the priority under its new name").tap()
        expect(planLine(renamed), "the renamed priority, closed again")

        // The plus under a priority offers a task first, then a part. A task typed there waits in
        // the backlog, and the priority opens to show it.
        let plus = app.buttons["Add to \(renamed)"]
        bringIntoView(plus)
        expect(plus, "the plus under the new priority").tap()
        expect(app.buttons["Add a part"], "Add a part, offered beside adding a task")
        shot("17-todos-plan-plus")
        expect(app.buttons["Add a task"], "Add a task in the plus menu").tap()
        let task = "Buy blackout blinds \(Int.random(in: 1000...9999))"
        enter(task + "\n", into: first("todos.plan.add."), "the field that adds a task to the priority")
        expect(planRow(task), "the new task under its line")
        let place = expect(first("todos.plan.place."), "where the new task sits")
        XCTAssertTrue(place.label.hasPrefix("Backlog"), "A task added in the plan should wait in the backlog, not \(place.label)")
        shot("17-todos-plan-added")

        // Carried onto a list in the folders, it takes that list's day and stays under its line.
        // A loaded simulator sometimes does not lift the row, so the carry is tried again. Where
        // the folders and the task are not on screen together it is left in the backlog.
        var home = "backlog"
        var other = "Replace the hallway light"
        if folder("today").isHittable && planRow(task).isHittable {
            for attempt in 1...3 {
                planRow(task).press(forDuration: 1.5, thenDragTo: folder("today"), withVelocity: .slow, thenHoldForDuration: 0.8)
                Thread.sleep(forTimeInterval: 2)
                if first("todos.plan.place.").label.hasPrefix("Today") || attempt == 3 { break }
            }
            expect(planRow(task), "the task, still under its line after being carried to Today")
            XCTAssertTrue(first("todos.plan.place.").label.hasPrefix("Today"), "A task carried onto Today should say Today, not \(first("todos.plan.place.").label)")
            shot("17-todos-plan-carried-to-list")
            home = "today"
            other = "Book parent-teacher conference"
        }

        // Back in the lists the task carries its line, and the list can be narrowed to it.
        folder(home).tap()
        expect(row(task), "the task, in its list")
        expect(element("todos.plan.filter"), "the priority filter, on a list with tasks in the plan").tap()
        expect(app.buttons[renamed], "the new priority among the lines to choose from").tap()
        waitToVanish(row(other), "a task that is not part of the chosen line")
        expect(row(task), "the task that is part of the chosen line")
        XCTAssertEqual(element("todos.plan.filter").label, "Priority: \(renamed)", "The filter should name the chosen line")
        shot("17-todos-plan-filter")
        element("todos.plan.filter").tap()
        expect(app.buttons["Show all"], "Show all in the priority menu").tap()
        expect(row(other), "every task again, once the choice is off")

        // An open task says what it is part of.
        row(task).tap()
        let partOf = expect(element("todos.detail.partOf"), "the Part of pill on the task")
        XCTAssertEqual(partOf.label, "Part of. Now: \(renamed)", "The task should say which line it is part of")
        // Deleted, so the next test finds the list as it was.
        let delete = element("todos.detail.delete")
        expect(delete, "the delete control").tap()
        delete.tap()
        waitToVanish(row(task), "the deleted task")

        // Taking the line out of the plan: the first tap arms, the second does it.
        folder("plan").tap()
        let remove = first("todos.plan.remove.")
        bringIntoView(remove)
        expect(remove, "the control that removes the open line").tap()
        remove.tap()
        waitToVanish(app.buttons["Close \(renamed)"], "the removed priority")
    }

    func testAddATagToATaskAndTakeItOff() {
        launchSignedIn()
        go("todos")
        folder("backlog").tap()
        let title = "Order furnace filters \(Int.random(in: 1000...9999))"
        enter(title + "\n", into: app.textFields["todos.add"], "the add field")
        expect(row(title), "the new task in the list").tap()

        // "Add tag" follows the date and repeat pills. A typed tag becomes a chip on the task.
        press(app.buttons["todos.detail.tags.add"], "the Add tag pill")
        let field = expect(element("todos.detail.tags.field"), "the field for a new tag")
        enter("errands\n", into: field, "the field for a new tag")
        expect(element("todos.detail.tags.item.errands"), "the tag, on the task")
        shot("17-todos-tagged")

        // A tag the tasks already carry is offered while typing; tapping it adds it.
        press(app.buttons["todos.detail.tags.add"], "the Add tag pill, again")
        let again = expect(element("todos.detail.tags.field"), "the field for a new tag, again")
        enter("hou", into: again, "the field for a new tag")
        expect(element("todos.detail.tags.suggest.house"), "house, offered while typing").tap()
        expect(element("todos.detail.tags.item.house"), "the offered tag, now on the task")
        XCTAssertFalse(element("todos.detail.tags.item.hou").exists, "What was typed should not become a tag when an offered one is chosen")
        shot("17-todos-tag-suggested")

        // Both are kept: the list can be narrowed to the new one, and the task still has it.
        app.buttons["todos.detail.close"].tap()
        expect(row(title), "the list after closing the task")
        Thread.sleep(forTimeInterval: 1.5) // the list is read again on the way out of a task
        expect(element("todos.tags.filter"), "the tag filter on Backlog").tap()
        expect(app.buttons["errands"], "the new tag among those the list can be narrowed to").tap()
        closeTagMenu(showing: "house")
        waitToVanish(row("Replace the hallway light"), "a task without the new tag")
        shot("17-todos-narrowed")
        expect(row(title), "the tagged task, still in the narrowed list").tap()

        // The x on a chip takes the tag off.
        expect(element("todos.detail.tags.remove.errands"), "the x on the tag").tap()
        waitToVanish(element("todos.detail.tags.item.errands"), "the tag taken off")
        expect(element("todos.detail.tags.item.house"), "the other tag, left alone")
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

    /// A title too long for one line wraps, the row grows to hold it, and the circle stays level
    /// with the first line instead of sitting halfway down the block.
    func testALongTitleWrapsUnderItsCircle() {
        launchSignedIn()
        go("todos")
        folder("backlog").tap()

        let title = "Wrap \(Int.random(in: 1000...9999)) " + String(repeating: "and then one more thing to remember ", count: 6).trimmingCharacters(in: .whitespaces)
        enter(title + "\n", into: app.textFields["todos.add"], "the add field")
        let added = expect(row(title), "the long task in the list")
        // the row is first drawn under a temporary id; its circle is named once it has been saved
        let saved = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.row.' AND NOT (identifier BEGINSWITH 'todos.row.new_') AND label BEGINSWITH %@", title)).firstMatch
        expect(saved, "the long task, saved")
        let check = expect(app.buttons[saved.identifier.replacingOccurrences(of: "todos.row.", with: "todos.check.")], "its circle")
        shot("16-todos-long-title")

        XCTAssertGreaterThan(added.frame.height, 50, "A long title should wrap and its row grow to hold every line")
        XCTAssertEqual(check.frame.minY, added.frame.minY, accuracy: 3, "The circle should sit at the top of the row, level with the first line")
        XCTAssertLessThan(check.frame.midY, added.frame.minY + 24, "The circle should be beside the first line, not centred on the block")
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

    func testHideDone() {
        // The task is made on the server before the app opens, so no keyboard is up when the
        // control is tapped: with the add field still focused, the list moved under the tap and
        // it opened a task instead. Today is short, so nothing has to be scrolled either.
        let title = "Return the parcel \(Int.random(in: 1000...9999))"
        XCTAssertNotNil(Self.request("POST", "todos", ["title": title, "view": "today"])?["id"], "The test's task could not be made on the server")
        launchSignedIn()
        go("todos")
        folder("today").tap()
        expect(row(title), "the new task in Today")

        // Finished tasks can be hidden; the control sits with the filters and says when it is on.
        let hide = expect(app.buttons["todos.hideDone"], "the control that hides finished tasks")
        XCTAssertFalse(hide.isSelected, "Finished tasks should show until hiding them is asked for")
        // what the tap is aimed at, to explain it if something else answers
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.row.'"))
        let aim = "Hide done at \(hide.frame) hittable \(hide.isHittable) in \(app.windows.firstMatch.frame); rows " + (0..<min(6, rows.count)).map { i in
            let r = rows.element(boundBy: i)
            return "\(r.label.prefix(24))@\(Int(r.frame.minY))-\(Int(r.frame.maxY))"
        }.joined(separator: ", ")
        hide.tap()
        // The list redraws as finished tasks leave; wait for the control rather than read it at once.
        let on = NSPredicate(format: "isSelected == true")
        let lit = XCTWaiter().wait(for: [expectation(for: on, evaluatedWith: app.buttons["todos.hideDone"])], timeout: 10)
        if lit != .completed {
            let opened = app.descendants(matching: .any)["todos.detail.title"]
            XCTFail("Tapping Hide done did not turn it on. " + aim + ". Open now: " + (opened.exists ? "\(opened.value ?? opened.label)" : "nothing"))
            return
        }

        // A task ticked now stays for a moment, shown as done, then goes with the rest.
        let check = expect(app.buttons[row(title).identifier.replacingOccurrences(of: "todos.row.", with: "todos.check.")], "the task's circle")
        check.tap()
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertTrue(row(title).exists, "A task ticked while finished tasks are hidden should stay for a moment")
        XCTAssertTrue(expect(check, "the ticked task's circle, while it stays").isSelected || check.label.contains("not done"), "While it stays it should read as done")
        shot("12-todos-hide-done-lingering")
        waitToVanish(row(title), "the ticked task, three seconds on")
        shot("12-todos-hide-done")

        // The plan has the same control, and shows the same choice.
        folder("plan").tap()
        XCTAssertTrue(expect(app.buttons["todos.hideDone"], "the control in the plan").isSelected, "The plan should show that finished tasks are hidden")

        // Taken off, the finished task is back.
        folder("today").tap()
        expect(app.buttons["todos.hideDone"], "the control, back in the list").tap()
        expect(row(title), "the finished task, showing again")
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

    func testEachSectionHasItsOwnAdd() {
        launchSignedIn()
        go("todos")
        folder("week").tap()

        // Today's section has its own plus, and a task typed there lands on today.
        let todayPlus = app.buttons.matching(NSPredicate(format: "label == 'Add task to Today'")).firstMatch
        expect(todayPlus, "the plus at the end of Today's section").tap()
        let title = "Post the parcel \(Int.random(in: 1000...9999))"
        let field = app.textFields.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.add.2'")).firstMatch
        expect(field, "Today's own add field, open")
        Thread.sleep(forTimeInterval: 0.4)
        app.typeText(title + "\n")
        expect(row(title), "the new task in This week")
        shot("15-todos-section-add")
        folder("today").tap()
        expect(row(title), "the task added under Today's section, on Today")

        // "Any day" has its own plus too, and keeps its task for the week with no day.
        folder("week").tap()
        expect(app.buttons["todos.addIn.any"], "the plus at the end of Any day").tap()
        let anyTitle = "Sort the photos \(Int.random(in: 1000...9999))"
        expect(app.textFields["todos.add.any"], "Any day's own add field, open")
        Thread.sleep(forTimeInterval: 0.4)
        app.typeText(anyTitle + "\n")
        expect(row(anyTitle), "the new task under Any day")
        folder("today").tap()
        XCTAssertFalse(row(anyTitle).waitForExistence(timeout: 3), "A task added to Any day should not be on Today")
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

import XCTest

/// Sign-in, the app bar and the Now rail.
final class ShellTests: SubspaceTestCase {
    func testWrongPasswordIsRefusedThenSignInWorks() {
        launch()
        let password = expect(app.secureTextFields["login.password"], "the password field", timeout: 20)
        shot("01-sign-in")
        password.tap()
        password.typeText("not-the-password")
        app.buttons["login.submit"].tap()
        expect(textContaining("That password is not right"), "the wrong-password message")
        XCTAssertFalse(app.buttons["nav.feed"].exists, "A wrong password must not sign in")
        shot("01-sign-in-refused")

        password.tap()
        // clear what was typed
        password.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20))
        password.typeText(Self.password)
        app.buttons["login.submit"].tap()
        expect(app.buttons["nav.feed"], "the app bar after signing in", timeout: 20)
    }

    func testEveryScreenOpensFromTheAppBar() {
        launch()
        signIn()
        for tab in ["feed", "todos", "journal", "context", "following", "agents"] {
            go(tab)
            XCTAssertTrue(app.buttons["nav.\(tab)"].isSelected, "\(tab) should be the selected screen")
            shot("02-\(tab)")
        }
    }

    func testSessionSurvivesRelaunch() {
        launch()
        signIn()
        app.terminate()
        launch(reset: false)
        expect(app.buttons["nav.feed"], "the app, still signed in after relaunch", timeout: 20)
        XCTAssertFalse(app.secureTextFields["login.password"].exists)
    }

    func testNowRailShowsModulesAndDismissesOne() {
        launchSignedIn()
        // Seeded data has rail modules. A wide iPad docks the rail; otherwise the Now button opens it.
        let rail = app.descendants(matching: .any)["rail"]
        if !rail.waitForExistence(timeout: 8) {
            expect(app.buttons["nav.now"], "the Now button with a count").tap()
        }
        let module = expect(app.buttons["rail.module.calendar-auth"], "the calendar warning module")
        shot("03-now-rail")
        module.tap()
        expect(text("Reconnect"), "the module's action once opened")
        shot("03-now-rail-open")
        app.buttons["rail.dismiss.calendar-auth"].tap()
        waitToVanish(module, "the dismissed module")
    }

    /// What an agent needs from the owner is a module pointing at a task. Opening the task is
    /// what clears it from the rail.
    func testFollowUpOpensItsTaskAndClears() {
        launchSignedIn()
        let rail = app.descendants(matching: .any)["rail"]
        let docked = rail.waitForExistence(timeout: 8)
        if !docked {
            expect(app.buttons["nav.now"], "the Now button with a count").tap()
        }
        let module = app.buttons["rail.module.agility-topup"]
        // An earlier attempt at this test may already have opened the task, which clears the
        // module for good. Then only the end state is left to check.
        if module.waitForExistence(timeout: 10) {
            module.tap()
            let open = expect(app.buttons["rail.action.agility-topup.0"], "Open task, once the module is opened")
            XCTAssertEqual(open.label, "Open task")
            shot("04-follow-up")
            open.tap()
        } else {
            if !docked {
                expect(app.buttons["rail.close"], "the rail's close button").tap()
            }
            go("todos")
            folder("all").tap()
            let task = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.row.' AND label BEGINSWITH 'Decide on the Agility top-up'")).firstMatch
            expect(task, "the follow-up's task in All").tap()
        }

        // The task itself, with the tag its agent gave it.
        let title = expect(app.descendants(matching: .any)["todos.detail.title"], "the task the module is about")
        let shown = (title.value as? String) ?? ""
        XCTAssertTrue(shown.contains("Agility top-up"), "The task opened from the module should be the one it is about, not \(shown)")
        expect(app.descendants(matching: .any)["todos.detail.tags.item.finance"], "the task's tag")
        shot("04-follow-up-task")

        // Seen, so the module has left the rail.
        if docked {
            waitToVanish(module, "the follow-up, once its task has been opened", timeout: 20)
        } else {
            expect(app.buttons["nav.now"], "the Now button, while other modules remain").tap()
            expect(rail, "the rail, opened again")
            expect(app.buttons["rail.module.portland-hotel"], "another module, still there")
            XCTAssertFalse(module.exists, "The follow-up should have left the rail once its task was opened")
        }
    }
}

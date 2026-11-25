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

    /// Search and chat are beside the app bar on every screen. Search looks through everything and
    /// a result opens where it lives (a post is read in place); a chat message says what was on
    /// screen and goes to the default agent unless it names another.
    func testSearchAndChatFromAnyScreen() {
        launchSignedIn()
        go("following")
        press(app.buttons["dock.search"], "the search button beside the app bar")
        expect(app.textFields["search.field"], "the search field")
        // the field has the keyboard as the sheet opens: nothing needs tapping first
        Thread.sleep(forTimeInterval: 1.0)
        app.typeText("robot")
        func hit(_ kind: String) -> XCUIElement {
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "search.hit.\(kind).")).firstMatch
        }
        for kind in ["todo", "post", "tracker"] {
            expect(hit(kind), "a \(kind) among the results for robot")
        }
        shot("06-search")

        // a post has no place of its own: it is read where it was found
        bringIntoView(hit("post"))
        press(hit("post"), "a post among the results")
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'search.peek.'")).firstMatch, "the post, read in place")
        shot("06-search-post")

        // everything else opens where it lives
        bringIntoView(hit("todo"), down: false)
        press(hit("todo"), "a task among the results")
        expect(app.buttons["todos.detail.close"], "the task that was found, open on Todos")
        waitToVanish(app.textFields["search.field"], "the search sheet once a result was opened")

        // chat, about the task that is open
        press(app.buttons["dock.chat"], "the chat button beside the app bar")
        expect(app.descendants(matching: .any)["chat.message"], "the chat field")
        let about = expect(app.buttons["chat.about"], "what the message is about")
        XCTAssertFalse(about.label == "Leave out Todos" || about.label == "Leave out ", "The open task should be what the message is about, not just the screen (\(about.label))")
        let stamp = String(Int(Date().timeIntervalSince1970) % 100_000)
        Thread.sleep(forTimeInterval: 1.0)
        app.typeText("What changed here \(stamp)")
        expect(app.buttons["chat.send"], "the send button, once there is something to send").tap()
        func bubble(_ words: String) -> XCUIElement {
            app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'chat.bubble.' AND label CONTAINS %@", words)).firstMatch
        }
        expect(bubble("What changed here \(stamp)"), "the sent message in the conversation")
        // naming an agent sends it to that one
        app.typeText("@scout anything new \(stamp)")
        expect(app.buttons["chat.send"], "the send button for the second message").tap()
        expect(bubble("anything new \(stamp)"), "the second message in the conversation")
        shot("06-chat")

        // what the server kept: which task was on screen, and who each message went to
        let chat = Self.request("GET", "chat")
        let me = Self.request("GET", "me")
        let messages = chat?["messages"] as? [[String: Any]] ?? []
        let usual = chat?["default_agent"] as? String ?? ""
        let scout = (me?["agents"] as? [[String: Any]] ?? []).first { $0["handle"] as? String == "scout" }?["id"] as? String ?? ""
        let first = messages.first { $0["body"] as? String == "What changed here \(stamp)" }
        let second = messages.first { ($0["body"] as? String ?? "").hasSuffix("anything new \(stamp)") }
        XCTAssertEqual((first?["about"] as? [String: Any])?["type"] as? String, "todo", "The message should say that a task was on screen")
        XCTAssertEqual(first?["channel"] as? String, "dm:" + usual, "A message naming nobody goes to the default agent")
        XCTAssertEqual(second?["channel"] as? String, "dm:" + scout, "A message naming an agent goes to that agent")
    }

    func testSessionSurvivesRelaunch() {
        launch()
        signIn()
        app.terminate()
        launch(reset: false)
        expect(app.buttons["nav.feed"], "the app, still signed in after relaunch", timeout: 20)
        XCTAssertFalse(app.secureTextFields["login.password"].exists)
    }

    /// The Now rail is notifications: each says the one thing to do on its face, acting on it takes
    /// it away, and "Later" keeps it as a task that still carries its button.
    func testNowRailModulesClearWhenActedOn() {
        launchSignedIn()
        // Seeded data has rail modules. A wide iPad docks the rail; otherwise the Now button opens it.
        let rail = app.descendants(matching: .any)["rail"]
        let docked = rail.waitForExistence(timeout: 8)
        if !docked {
            expect(app.buttons["nav.now"], "the Now button with a count").tap()
        }
        // The hotel is never cleared by these tests, so it is there on a second attempt too.
        expect(app.buttons["rail.module.portland-hotel"], "the hotel module")
        let first = expect(app.buttons["rail.action.portland-hotel.0"], "the hotel's first button, without opening the module")
        XCTAssertTrue(first.label.contains("Get directions"), "A module's first button should say the one thing to do, not \(first.label)")
        XCTAssertFalse(app.buttons["rail.action.portland-hotel.1"].exists, "A closed module should show only its first button")
        shot("03-now-rail")

        // Nothing to do about the roofer but know it. Saying so clears it, and so does closing it:
        // a docked rail checks the one, a sheet the other. An earlier attempt may have cleared it already.
        let roof = app.buttons["rail.module.roof-inspection"]
        if roof.waitForExistence(timeout: 5) {
            let gotIt = expect(app.buttons["rail.gotit.roof-inspection"], "Got it, on a module with nothing to do")
            if docked {
                gotIt.tap()
            } else {
                expect(app.buttons["rail.dismiss.roof-inspection"], "the module's dismiss button").tap()
            }
            waitToVanish(roof, "the module, once acknowledged or dismissed")
        }

        // A button can send an action to the agent that raised the module. The app says at once
        // that it was sent, in the buttons' place, and then the module goes. An earlier attempt
        // may have sent it already.
        let suggest = app.buttons["rail.module.follow-shaders"]
        if suggest.waitForExistence(timeout: 5) {
            let follow = expect(app.buttons["rail.action.follow-shaders.0"], "the suggestion's first answer")
            XCTAssertTrue(follow.label.contains("Follow it"), "The first button should be the agent's own answer, not \(follow.label)")
            follow.tap()
            expect(app.descendants(matching: .any)["rail.sent.follow-shaders"], "word that it was sent, in the buttons' place", timeout: 10)
            shot("03-now-rail-sent")
            waitToVanish(suggest, "the module, once its action was sent")
        }

        // An answer sent to an agent shows beside that agent as waiting, until it has read it.
        if !docked, app.buttons["rail.close"].waitForExistence(timeout: 3) {
            app.buttons["rail.close"].tap()
        }
        go("agents")
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'agents.waiting.' AND label CONTAINS 'waiting'")).firstMatch, "the answer, waiting beside the agent it was sent to")
        shot("03-agents-waiting")
        go("feed")
        if !docked {
            expect(app.buttons["nav.now"], "the Now button, to open the rail again").tap()
        }

        // "Later": not now, but not lost. The problem becomes a task for tomorrow and leaves the rail.
        let auth = app.buttons["rail.module.calendar-auth"]
        if auth.waitForExistence(timeout: 5) {
            auth.tap()
            let fix = expect(app.buttons["rail.action.calendar-auth.0"], "the problem's fix, as its first button")
            XCTAssertTrue(fix.label.contains("Reconnect"), "The first button should be the fix, not \(fix.label)")
            shot("03-now-rail-open")
            expect(app.buttons["rail.later.calendar-auth"], "Later, once the module is opened").tap()
            let tomorrow = expect(app.buttons["rail.later.calendar-auth.tomorrow"], "Tomorrow, as a day to keep it for")
            expect(app.buttons["rail.later.calendar-auth.week"], "This week, as a day to keep it for")
            shot("03-now-rail-later")
            tomorrow.tap()
            waitToVanish(auth, "the module kept for later")
        }

        // The follow-up remains: a task in the list, with the module's button still on it.
        if !docked, app.buttons["rail.close"].waitForExistence(timeout: 3) {
            app.buttons["rail.close"].tap()
        }
        go("todos")
        folder("all").tap()
        let task = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todos.row.' AND label BEGINSWITH 'Calendar connection expired'")).firstMatch
        expect(task, "the task the module was kept as").tap()
        expect(app.descendants(matching: .any)["todos.detail.rail.from"], "whose module the task came from")
        let again = expect(app.buttons["todos.detail.rail.action.0"], "the module's button, on its task")
        XCTAssertTrue(again.label.contains("Reconnect"), "The task should keep the module's button, not \(again.label)")
        shot("03-now-rail-kept-task")
    }

    /// What an agent needs from the owner is a module pointing at a task. Its one button opens the
    /// task, which clears the module; the task stays in the list.
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
            // what to do is on the module's face: it does not have to be opened first
            let open = expect(app.buttons["rail.action.agility-topup.0"], "Open task, on the closed module")
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

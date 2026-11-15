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
        for tab in ["feed", "todos", "context", "following", "agents"] {
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
}

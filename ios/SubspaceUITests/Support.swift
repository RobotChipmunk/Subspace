import XCTest

/// Shared by every UI test: launching signed out against the test server, signing in, moving
/// between screens, and attaching named screenshots (CI collects them per device).
class SubspaceTestCase: XCTestCase {
    var app: XCUIApplication!

    /// The server the tests drive. CI and `ios/scripts/e2e-server.sh` run it on this address.
    static let server = ProcessInfo.processInfo.environment["SUBSPACE_SERVER"] ?? "http://localhost:3000"
    static let password = ProcessInfo.processInfo.environment["SUBSPACE_PASSWORD"] ?? "subspace"

    var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
    }

    /// Starts the app with no saved session, pointed at the test server.
    func launch(reset: Bool = true) {
        app.launchEnvironment["SUBSPACE_SERVER"] = Self.server
        app.launchEnvironment["SUBSPACE_RESET"] = reset ? "1" : "0"
        app.launch()
    }

    func signIn() {
        let password = app.secureTextFields["login.password"]
        XCTAssertTrue(password.waitForExistence(timeout: 60), "The sign-in screen did not appear")
        // The first launch on a fresh simulator can swallow the first keystrokes while the keyboard
        // sets itself up, so try once more before calling it a failure.
        for attempt in 1...2 {
            password.tap()
            password.typeText(Self.password)
            app.buttons["login.submit"].tap()
            if app.buttons["nav.feed"].waitForExistence(timeout: 25) { break }
            shot("sign-in-attempt-\(attempt)")
            if attempt == 2 { XCTFail("Signing in did not reach the app") }
            password.tap()
            password.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 24))
        }
        declineSavingPassword()
    }

    /// iOS offers to save the password just typed, over the app. Say no, so it is not in the way.
    func declineSavingPassword() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for owner in [springboard, app!] {
            let notNow = owner.buttons["Not Now"]
            if notNow.waitForExistence(timeout: owner === springboard ? 6 : 1) {
                notNow.tap()
                waitToVanish(notNow, "the Save Password prompt")
                return
            }
        }
    }

    /// Taps where the element is, as a finger would, without asking the accessibility tree whether
    /// something overlaps it. If something really is in the way, the next expectation fails.
    func press(_ element: XCUIElement, _ what: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        expect(element, what, timeout: timeout, file: file, line: line)
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    /// Taps a field and types into it.
    func enter(_ text: String, into element: XCUIElement, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        press(element, what, file: file, line: line)
        Thread.sleep(forTimeInterval: 0.4)
        app.typeText(text)
    }

    func launchSignedIn() {
        launch()
        signIn()
    }

    func go(_ tab: String) {
        press(app.buttons["nav.\(tab)"], "the \(tab) button in the app bar")
        Thread.sleep(forTimeInterval: 0.4)
    }

    /// Attaches a screenshot named for the report, e.g. "03-todos".
    func shot(_ name: String) {
        // let springs settle so the picture shows the resting state
        Thread.sleep(forTimeInterval: 0.7)
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// Waits for an element, failing with a clear message.
    @discardableResult
    func expect(_ element: XCUIElement, _ what: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        if !element.waitForExistence(timeout: timeout) {
            // What the app was showing, as text, to explain the failure.
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "hierarchy"
            tree.lifetime = .keepAlways
            add(tree)
            shot("failed")
            XCTFail("Expected \(what)", file: file, line: line)
        }
        return element
    }

    /// Any element showing exactly this text.
    func text(_ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    /// Any element whose text contains this.
    func textContaining(_ part: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", part)).firstMatch
    }

    func waitToVanish(_ element: XCUIElement, _ what: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: timeout), .completed, "Expected \(what) to go away", file: file, line: line)
    }
}

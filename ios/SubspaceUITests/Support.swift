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
        XCTAssertTrue(password.waitForExistence(timeout: 20), "The sign-in screen did not appear")
        password.tap()
        password.typeText(Self.password)
        app.buttons["login.submit"].tap()
        XCTAssertTrue(app.buttons["nav.feed"].waitForExistence(timeout: 20), "Signing in did not reach the app")
    }

    func launchSignedIn() {
        launch()
        signIn()
    }

    func go(_ tab: String) {
        let button = app.buttons["nav.\(tab)"]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "No \(tab) button in the app bar")
        button.tap()
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
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "Expected \(what)", file: file, line: line)
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

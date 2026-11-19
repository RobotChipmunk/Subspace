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
        // The notification permission alert would sit over every tap.
        app.launchEnvironment["SUBSPACE_NOTIFICATIONS"] = "0"
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
            if !password.exists {
                // signed in, just slowly
                XCTAssertTrue(app.buttons["nav.feed"].waitForExistence(timeout: 40), "Signing in did not reach the app")
                break
            }
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
            if notNow.waitForExistence(timeout: owner === springboard ? 12 : 1) {
                // A tap while the prompt is still sliding in can miss, so tap again if it is still there.
                for _ in 1...3 {
                    notNow.tap()
                    let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: notNow)
                    if XCTWaiter().wait(for: [gone], timeout: 4) == .completed { return }
                }
                waitToVanish(notNow, "the Save Password prompt")
                return
            }
        }
    }

    /// Taps where the element is, as a finger would, without asking the accessibility tree whether
    /// something overlaps it. If something really is in the way, the next expectation fails.
    func press(_ element: XCUIElement, _ what: String, timeout: TimeInterval = 30, file: StaticString = #filePath, line: UInt = #line) {
        expect(element, what, timeout: timeout, file: file, line: line)
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    /// Taps a field and types into it.
    func enter(_ text: String, into element: XCUIElement, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        press(element, what, file: file, line: line)
        Thread.sleep(forTimeInterval: 0.4)
        app.typeText(text)
    }

    /// Starts the app already signed in, with a session fetched straight from the server. Signing
    /// in by hand is ShellTests' job; every other test begins from here.
    func launchSignedIn() {
        guard let token = Self.sessionToken() else {
            launch()
            signIn()
            return
        }
        app.launchEnvironment["SUBSPACE_TOKEN"] = token
        launch()
        XCTAssertTrue(app.buttons["nav.feed"].waitForExistence(timeout: 60), "The app did not open signed in")
    }

    private static var cachedToken: String?

    private static func sessionToken() -> String? {
        if let cachedToken { return cachedToken }
        guard let url = URL(string: server + "/api/v1/auth/login") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["password": password])
        let done = DispatchSemaphore(value: 0)
        var token: String?
        URLSession.shared.dataTask(with: request) { data, _, _ in
            if let data, let reply = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { token = reply["token"] as? String }
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 20)
        cachedToken = token
        return token
    }

    /// Opens a screen from the app bar, and makes sure it did open: a tap that lands while
    /// something is still settling over the bar is lost, and every later step would then fail
    /// with a message about the wrong thing.
    func go(_ tab: String, file: StaticString = #filePath, line: UInt = #line) {
        let button = app.buttons["nav.\(tab)"]
        for _ in 0..<3 {
            press(button, "the \(tab) button in the app bar", file: file, line: line)
            let until = Date().addingTimeInterval(4)
            while !button.isSelected && Date() < until { Thread.sleep(forTimeInterval: 0.3) }
            if button.isSelected { break }
        }
        XCTAssertTrue(button.isSelected, "\(tab) should be the selected screen after tapping it in the app bar (app state \(app.state.rawValue))", file: file, line: line)
        Thread.sleep(forTimeInterval: 0.3)
    }

    /// One of the todo lists ("today", "week", "next_week", "backlog", "bin", a date…), brought
    /// into view. On a phone the lists are one strip that scrolls sideways, and how long it is
    /// depends on the weekday (a Monday has every day of the week in it), so a list may sit beyond
    /// the edge of the screen, where it cannot be tapped or dropped on. This slides the strip until
    /// the list is wholly on screen. On an iPad the lists sit beside the tasks and nothing moves.
    @discardableResult
    func folder(_ key: String, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let button = expect(app.buttons["todos.folder.\(key)"], "the \(key) list among the folders", file: file, line: line)
        let screen = app.windows.firstMatch.frame
        let margin: CGFloat = 12
        // Beside the list (iPad) every folder is in view and there is nothing to slide or wait for.
        if isPad && button.isHittable { return button }
        // choosing a list slides the strip by itself: let that finish before measuring
        Thread.sleep(forTimeInterval: 0.6)
        for _ in 0..<12 {
            let frame = button.frame
            let hiddenRight = frame.maxX > screen.maxX - margin
            let hiddenLeft = frame.minX < screen.minX + margin
            // wider than the screen can show, or already in view
            if !(hiddenRight || hiddenLeft) || frame.width > screen.width - 2 * margin { break }
            // a finger on the strip, drawn a third of the screen towards the hidden side's opposite
            let reach = screen.width * 0.3
            let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: screen.midX + (hiddenRight ? reach / 2 : -reach / 2), dy: frame.midY))
            let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: screen.midX + (hiddenRight ? -reach / 2 : reach / 2), dy: frame.midY))
            // slowly and held at the end, so the strip stops where the finger leaves it
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.2)
            Thread.sleep(forTimeInterval: 0.4)
        }
        return button
    }

    /// Attaches a screenshot named for the report, e.g. "03-todos".
    /// Scrolls the screen a little at a time until an element further down (or, with `down` false,
    /// further up) can be tapped.
    func bringIntoView(_ element: XCUIElement, down: Bool = true) {
        var tries = 0
        while !(element.exists && element.isHittable) && tries < 12 {
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.68 : 0.36))
            let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.36 : 0.68))
            from.press(forDuration: 0.05, thenDragTo: to)
            tries += 1
        }
    }

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
    func expect(_ element: XCUIElement, _ what: String, timeout: TimeInterval = 30, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        if !element.waitForExistence(timeout: timeout) {
            // What the app was showing, as text, to explain the failure.
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "hierarchy"
            tree.lifetime = .keepAlways
            add(tree)
            shot("failed")
            // 4 is running in the foreground; anything else means the app was left or has stopped
            XCTFail("Expected \(what) (app state \(app.state.rawValue))", file: file, line: line)
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

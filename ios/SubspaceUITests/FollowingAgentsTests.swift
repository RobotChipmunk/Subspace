import XCTest

/// Followed topics, agents, a direct conversation, and signing out.
final class FollowingAgentsTests: SubspaceTestCase {
    func testOpenATopicAndFollowSomethingNew() {
        launchSignedIn()
        go("following")
        let topic = expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'following.row.' AND label CONTAINS 'Robotics investments'")).firstMatch, "the seeded topic")
        shot("30-following")
        topic.tap()
        expect(app.descendants(matching: .any)["following.stop"], "Stop following, inside the opened topic")
        expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'following.update.'")).firstMatch, "the topic's updates")
        shot("30-following-open")
        topic.tap()

        // Follow something new
        expect(app.buttons["following.add"], "Follow something").tap()
        let title = expect(app.textFields["following.add.title"], "the title field")
        title.tap()
        title.typeText("Tide tables")
        let what = app.descendants(matching: .any)["following.add.description"]
        if what.exists {
            what.tap()
            what.typeText("High and low tides for Alki this week")
        }
        app.buttons["following.add.submit"].tap()
        expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'following.row.' AND label CONTAINS 'Tide tables'")).firstMatch, "the new topic in the list")
        shot("31-following-added")

        // Stop following it again: arm, then confirm
        let stop = expect(app.descendants(matching: .any)["following.stop"], "Stop following on the new topic")
        stop.tap()
        stop.tap()
        waitToVanish(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'following.row.' AND label CONTAINS 'Tide tables'")).firstMatch, "the topic that is no longer followed")
    }

    func testAgentsListConnectDetailsAndMessage() {
        launchSignedIn()
        go("agents")
        expect(text("Scout"), "the agent Scout")
        expect(text("Claude"), "the agent Claude")
        shot("40-agents")

        // Connection details open in place
        let connect = expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'agents.connect.'")).firstMatch, "a Connect button")
        connect.tap()
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'agents.address.'")).firstMatch, "the connector address")
        shot("40-agents-connect")

        // Access is set on the agent: read only, then one part of the app off, each saved as it is changed.
        let readOnly = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'agents.access.readonly.'")).firstMatch
        bringIntoView(readOnly)
        expect(readOnly, "the Read only switch").tap()
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'agents.access.badge.' AND label CONTAINS 'Read only'")).firstMatch, "Read only beside the agent's name")
        let journal = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'agents.access.section.journal.'")).firstMatch
        bringIntoView(journal)
        XCTAssertTrue(expect(journal, "Journal among the parts of the app").isSelected, "Every part of the app starts allowed")
        journal.tap()
        let off = NSPredicate(format: "isSelected == false")
        wait(for: [XCTNSPredicateExpectation(predicate: off, object: journal)], timeout: 8)
        expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'agents.access.context.'")).firstMatch, "the top-level sections of context")
        shot("40-agents-access")
        // Everything back on and able to write is no limit at all.
        journal.tap()
        wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"), object: journal)], timeout: 8)
        readOnly.tap()
        waitToVanish(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'agents.access.badge.'")).firstMatch, "the badge once the limits are off")
        bringIntoView(connect, down: false)
        connect.tap()

        // A direct message is sent and shows in the conversation
        expect(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'agents.chat.'")).firstMatch, "a Message button").tap()
        let field = expect(app.descendants(matching: .any)["agents.message"], "the message field")
        field.tap()
        field.typeText("Anything new today?")
        expect(app.buttons["agents.send"], "the send button, once there is something to send").tap()
        expect(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'agents.bubble.' AND label CONTAINS 'Anything new today?'")).firstMatch, "the sent message in the conversation")
        shot("41-agents-conversation")
        app.buttons["agents.messages.done"].tap()
    }

    func testSignOutReturnsToSignIn() {
        launchSignedIn()
        go("agents")
        let out = app.descendants(matching: .any)["agents.signout"]
        var tries = 0
        while !out.isHittable && tries < 8 {
            app.swipeUp()
            tries += 1
        }
        expect(out, "Sign out at the foot of the Agents screen").tap()
        expect(app.secureTextFields["login.password"], "the sign-in screen after signing out")
        XCTAssertFalse(app.buttons["nav.feed"].exists)
    }
}

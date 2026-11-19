import BackgroundTasks
import SwiftUI
import UserNotifications

/// System notifications for the Now rail, so the owner hears about a new module with the app closed.
///
/// The server pushes them through Apple (src/lib/core/push.ts): the app registers this device with
/// Apple, hands the token to the server (`POST devices`), and the server sends a notification the
/// moment an agent adds or changes a module. Where the server has no Apple key, the app falls back
/// to noticing new modules itself when it refreshes the rail: every 30 seconds while open, and
/// when iOS wakes it for a background refresh (`Notifier.refreshTask`), which iOS spaces out.
///
/// A module's buttons go with its notification, so it can be answered from the lock screen. iOS
/// shows buttons only for a category registered beforehand, so a category's name spells out its
/// buttons (`category(for:)`, the same as `railCategory` in push.ts) and the app registers every
/// set it has met: on the modules themselves, and in the list the server keeps of recent ones
/// (`button_sets`). The first notification ever to carry a new set may arrive without buttons.
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()
    /// The background refresh task. Listed under `BGTaskSchedulerPermittedIdentifiers` in Info.plist.
    static let refreshTask = "com.robotchipmunk.subspace.rail"

    private let center = UNUserNotificationCenter.current()
    private let seenKey = "rail_notified"
    /// True once the server has this device and says it can push; the app then posts nothing itself.
    private let pushKey = "push_active"
    /// The names of the button sets registered with iOS, newest first.
    private let categoriesKey = "rail_categories"
    /// This device's token from Apple, in hex, once it has one.
    private(set) var deviceToken: String?
    /// The app's model, which the background refresh asks for a fresh rail.
    weak var model: AppModel?

    /// UI tests launch with `SUBSPACE_NOTIFICATIONS=0`: the permission alert would sit over every tap.
    private var enabled: Bool { ProcessInfo.processInfo.environment["SUBSPACE_NOTIFICATIONS"] != "0" }

    override private init() {
        super.init()
        center.delegate = self
    }

    /// Asks once, on the first launch that has not asked yet. Later launches leave the answer alone.
    func askIfNeeded() async {
        guard enabled else { return }
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
        // Every launch: the token can change, and the answer comes back through the app delegate.
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Apple gave this device a token: the server needs it to reach the device.
    func gotDeviceToken(_ data: Data) {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        Task { await sendToken() }
    }

    /// Hands the token to the server. Called when the token arrives and again after signing in.
    func sendToken() async {
        guard enabled, let deviceToken, let model, model.signedIn else { return }
        // A build run from Xcode gets a token for Apple's sandbox; TestFlight and the App Store, production.
        #if DEBUG
        let env = "sandbox"
        #else
        let env = "production"
        #endif
        struct R: Codable { var configured: Bool? }
        guard let r: R = try? await model.api.send("POST", "devices", body: ["token": deviceToken, "env": env]) else { return }
        UserDefaults.standard.set(r.configured == true, forKey: pushKey)
    }

    /// Signing out: the server forgets this device. `session` is the token of the session that is ending.
    func forgetDevice(server: URL?, session: String?) {
        UserDefaults.standard.removeObject(forKey: pushKey)
        guard let deviceToken, let server, let session, let url = URL(string: "api/v1/devices/\(deviceToken)", relativeTo: server) else { return }
        var r = URLRequest(url: url)
        r.httpMethod = "DELETE"
        r.setValue("Bearer " + session, forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: r).resume()
    }

    /// The notification category for a set of buttons: "rail:" then, for each, "s:" (it sends to
    /// the agent) or "u:" (it opens an address) and its label, joined by "|". Nil for no buttons.
    nonisolated static func category(for actions: [RailAction]?) -> String? {
        let list = (actions ?? []).prefix(4)
        guard !list.isEmpty else { return nil }
        return "rail:" + list.map { ($0.sends ? "s:" : "u:") + $0.label.replacingOccurrences(of: "|", with: "/") }.joined(separator: "|")
    }

    /// The buttons a category's name spells out: each one's label, and whether it sends.
    nonisolated static func buttons(in category: String) -> [(label: String, sends: Bool)] {
        guard category.hasPrefix("rail:") else { return [] }
        return category.dropFirst(5).split(separator: "|").compactMap { part in
            guard part.count > 2 else { return nil }
            return (String(part.dropFirst(2)), part.hasPrefix("s:"))
        }
    }

    /// Tells iOS about these sets of buttons, with every set told of before (iOS keeps only the
    /// last list it is given). A button that sends needs the device unlocked and leaves the app
    /// closed; one that opens an address opens the app.
    func register(_ categories: [String]) {
        guard enabled else { return }
        let defaults = UserDefaults.standard
        let known = defaults.stringArray(forKey: categoriesKey) ?? []
        var all: [String] = []
        for name in categories + known where !all.contains(name) && !Self.buttons(in: name).isEmpty { all.append(name) }
        all = Array(all.prefix(60))
        guard all != known else { return }
        defaults.set(all, forKey: categoriesKey)
        center.setNotificationCategories(Set(all.map { name in
            let actions = Self.buttons(in: name).enumerated().map { item in
                UNNotificationAction(identifier: "rail.a\(item.offset)", title: item.element.label, options: item.element.sends ? [.authenticationRequired] : [.foreground])
            }
            return UNNotificationCategory(identifier: name, actions: actions, intentIdentifiers: [], options: [])
        }))
    }

    /// Called with every fresh copy of the rail. Notifies once for each module not seen before, and
    /// keeps the app icon's badge at the number of modules waiting. The first copy after signing in
    /// (or after installing) is taken as already known, so an old backlog does not arrive at once.
    /// `buttonSets` are the sets of buttons the server says modules have carried lately.
    func railChanged(_ modules: [RailModule], buttonSets: [String] = []) async {
        guard enabled else { return }
        register(modules.compactMap { Self.category(for: $0.actions) } + buttonSets)
        let defaults = UserDefaults.standard
        let ids = modules.map(\.id)
        let known = defaults.stringArray(forKey: seenKey)
        defaults.set(ids, forKey: seenKey)
        let settings = await center.notificationSettings()
        let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
        guard allowed else { return }
        if settings.badgeSetting == .enabled { try? await center.setBadgeCount(modules.count) }
        guard let known else { return }
        let seen = Set(known)
        // With the server pushing, a notification from here as well would be a second one.
        let pushed = defaults.bool(forKey: pushKey)
        for m in modules where !pushed && !seen.contains(m.id) {
            let content = UNMutableNotificationContent()
            content.title = m.title
            if let label = m.label, !label.isEmpty { content.subtitle = label }
            if let s = m.subtitle, !s.isEmpty { content.body = s }
            content.sound = .default
            content.threadIdentifier = "rail"
            content.userInfo = ["rail": m.id, "rail_actions": (m.actions ?? []).prefix(4).map { a in a.sends ? ["label": a.label] : ["label": a.label, "url": a.link] }]
            if let category = Self.category(for: m.actions) { content.categoryIdentifier = category }
            try? await center.add(UNNotificationRequest(identifier: "rail-\(m.id)", content: content, trigger: nil))
        }
        // A module that left the rail takes its notification with it (a pushed one has the same name).
        let gone = seen.subtracting(ids).map { "rail-\($0)" }
        if !gone.isEmpty { center.removeDeliveredNotifications(withIdentifiers: gone) }
    }

    /// Signing out forgets what was seen and clears what was shown.
    func reset() {
        UserDefaults.standard.removeObject(forKey: seenKey)
        center.removeAllDeliveredNotifications()
        Task { try? await center.setBadgeCount(0) }
    }

    /// What iOS runs when it wakes the app in the background: one rail check, then the next is asked for.
    func backgroundRefresh() async {
        Self.scheduleRefresh()
        await model?.refreshRail()
    }

    /// Asks iOS to wake the app for a rail check in a while.
    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTask)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    // Shown as a banner even while the app is open, as the rail updates beside it.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        // A push about the rail: fetch it now instead of at the next 30-second check.
        if notification.request.trigger is UNPushNotificationTrigger { Task { @MainActor in await self.model?.refreshRail() } }
        return [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let content = response.notification.request.content
        guard let rail = content.userInfo["rail"] as? String else { return }
        let action = response.actionIdentifier
        // One of the module's own buttons, tapped on the notification: the same as tapping it in the rail.
        if action.hasPrefix("rail.a"), let index = Int(action.dropFirst(6)) {
            let told = content.userInfo["rail_actions"] as? [[String: Any]] ?? []
            let named = Self.buttons(in: content.categoryIdentifier)
            let label = (index < told.count ? told[index]["label"] as? String : nil) ?? (index < named.count ? named[index].label : nil)
            let url = index < told.count ? told[index]["url"] as? String : nil
            guard let label else { return }
            await answer(rail: rail, label: label, url: url)
            return
        }
        guard action == UNNotificationDefaultActionIdentifier else { return }
        // Opening one shows the rail: docked on a wide screen, as a sheet on a narrower one.
        await MainActor.run { model?.railSheet = true }
    }

    /// A button on a notification was tapped. The server is told which (a button that sends goes to
    /// the module's agent; any button takes the module off the rail), and one with an address opens it.
    private func answer(rail: String, label: String, url: String?) async {
        guard let model, model.signedIn else { return }
        try? await model.api.send("POST", "rail/\(rail)/action", body: ["label": label])
        if let url, !url.isEmpty { model.open(url) }
        await model.refreshRail()
    }
}

/// Apple hands the device token to the app delegate and nowhere else.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in Notifier.shared.gotDeviceToken(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // No token (the simulator on some Macs, no network): the app's own notifications still work.
        print("push: no device token:", error.localizedDescription)
    }
}

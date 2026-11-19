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
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()
    /// The background refresh task. Listed under `BGTaskSchedulerPermittedIdentifiers` in Info.plist.
    static let refreshTask = "com.robotchipmunk.subspace.rail"

    private let center = UNUserNotificationCenter.current()
    private let seenKey = "rail_notified"
    /// True once the server has this device and says it can push; the app then posts nothing itself.
    private let pushKey = "push_active"
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

    /// Called with every fresh copy of the rail. Notifies once for each module not seen before, and
    /// keeps the app icon's badge at the number of modules waiting. The first copy after signing in
    /// (or after installing) is taken as already known, so an old backlog does not arrive at once.
    func railChanged(_ modules: [RailModule]) async {
        guard enabled else { return }
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
            content.userInfo = ["rail": m.id]
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
        guard response.notification.request.content.userInfo["rail"] != nil else { return }
        // Opening one shows the rail: docked on a wide screen, as a sheet on a narrower one.
        await MainActor.run { model?.railSheet = true }
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

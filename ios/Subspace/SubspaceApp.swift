import SwiftUI

@main
struct SubspaceApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .tint(Theme.accent)
                .task { await Notifier.shared.askIfNeeded() }
        }
        // iOS wakes the app now and then to look for new rail modules (see Notifier).
        .backgroundTask(.appRefresh(Notifier.refreshTask)) {
            await Notifier.shared.backgroundRefresh()
        }
    }
}

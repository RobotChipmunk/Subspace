import SwiftUI

// Search and chat: the two things within reach on every screen. On a wide screen they sit with the
// app bar, search above it and chat below; on a phone they float just above the bar, one at each
// side. Each opens as a sheet (see SearchSheet and ChatSheet).

/// One of the two round buttons beside the app bar.
struct DockButton: View {
    var panel: DockPanel
    @Environment(AppModel.self) private var app

    var body: some View {
        Button {
            app.railSheet = false
            app.dock = panel
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: panel == .search ? "magnifyingglass" : "bubble.left")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.ink2)
                    .frame(width: 44, height: 44)
                // an agent has answered since chat was last open
                if panel == .chat && app.anyDirectUnread {
                    Circle().fill(Theme.accent).frame(width: 8, height: 8).offset(x: -9, y: 9)
                }
            }
            .glass(radius: 22)
            .contentShape(Circle())
        }
        .buttonStyle(PressStyle(scale: 0.9))
        .accessibilityLabel(panel == .search ? "Search" : "Chat")
        .accessibilityIdentifier("dock.\(panel.rawValue)")
    }
}

/// The names of the screens, as chat says them when nothing in particular is open.
func screenLabel(_ screen: String) -> String {
    AppTab(rawValue: screen)?.label ?? ""
}

/// What a message was about, in a few words: the thing that was open, else the screen.
func aboutLabel(_ about: About?) -> String {
    guard let about else { return "" }
    if let title = about.title, !title.isEmpty { return title }
    return screenLabel(about.screen)
}

private struct ShowingOnScreen: ViewModifier {
    @Environment(AppModel.self) private var app
    var tab: AppTab
    var type: String
    var id: String?
    var title: String?

    func body(content: Content) -> some View {
        content
            .onChange(of: [id ?? "", type, title ?? ""], initial: true) { old, _ in
                if let was = old.first, !was.isEmpty, was != (id ?? "") { app.unshow(tab, id: was) }
                if let id { app.show(tab, type, id: id, title: title) }
            }
            .onDisappear {
                if let id { app.unshow(tab, id: id) }
            }
    }
}

extension View {
    /// Tells the app what this screen has open (a task, an entry, a topic), for as long as it is
    /// open, so chat can say what a message is about. `id` is nil while nothing is open.
    func showing(_ tab: AppTab, _ type: String, id: String?, title: String?) -> some View {
        modifier(ShowingOnScreen(tab: tab, type: type, id: id, title: title))
    }
}

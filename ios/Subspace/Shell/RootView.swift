import SwiftUI

/// Sign-in, or the app.
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ZStack {
            AmbientBackground()
            if app.signedIn {
                ShellView().transition(.opacity)
            } else {
                LoginView().transition(.opacity)
            }
        }
        .foregroundStyle(Theme.ink)
        .onChange(of: phase) { _, now in
            if now == .active, app.signedIn { Task { await app.refresh() } }
        }
    }
}

/// The frame around every screen: the app bar (left on wide screens, bottom on phones), the
/// screen itself, and the Now rail (docked from 1100 points wide, a sheet below that).
struct ShellView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var visited: Set<AppTab> = [.feed]
    @State private var keyboardUp = false
    @Namespace private var indicator

    static let railDockWidth: CGFloat = 1100
    static let railWidth: CGFloat = 288

    var body: some View {
        @Bindable var app = app
        GeometryReader { geo in
            let wide = sizeClass == .regular
            let docked = geo.size.width >= Self.railDockWidth && !app.rail.isEmpty && !app.commentsBeside
            ZStack {
                screens
                    .padding(.leading, wide ? 84 : 0)
                    .padding(.trailing, docked ? Self.railWidth : 0)
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        // room for the app bar on a phone, so the last row can scroll clear of it
                        if !wide && !keyboardUp { Color.clear.frame(height: 76) }
                    }

                // Content scrolls up behind the status bar; soften it there so the clock stays readable.
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.65), .init(color: .black.opacity(0), location: 1)], startPoint: .top, endPoint: .bottom))
                    .frame(height: geo.safeAreaInsets.top + 18)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)

                if docked {
                    RailView(sheet: false)
                        .frame(width: Self.railWidth)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }

                if wide {
                    NavBar(vertical: true, showNow: !docked, indicator: indicator)
                        .padding(.leading, 16)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                } else if !keyboardUp {
                    NavBar(vertical: false, showNow: true, indicator: indicator)
                        .padding(.bottom, 8)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                if app.railSheet && !docked && !app.rail.isEmpty {
                    Color.black.opacity(0.25)
                        .ignoresSafeArea()
                        .onTapGesture { withAnimation(.ssSpring) { app.railSheet = false } }
                        .transition(.opacity)
                        .accessibilityHidden(true)
                    RailView(sheet: true)
                        .frame(width: min(340, geo.size.width * 0.88))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .transition(.move(edge: .trailing))
                        .zIndex(2)
                }
            }
            .animation(.ssSoft, value: docked)
            .animation(.ssSpring, value: app.railSheet)
            .animation(.ssSoft, value: keyboardUp)
        }
        .sheet(item: $app.presentedPage) { target in
            PageView(pageID: target.id)
                .environment(app)
                .presentationDragIndicator(.visible)
        }
        .onChange(of: app.tab, initial: true) { _, tab in visited.insert(tab) }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardUp = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardUp = false }
    }

    /// Each screen is built the first time it is visited and then kept, so it stays where it was left.
    private var screens: some View {
        ZStack {
            ForEach(AppTab.allCases) { tab in
                if visited.contains(tab) {
                    screen(tab)
                        .opacity(app.tab == tab ? 1 : 0)
                        .allowsHitTesting(app.tab == tab)
                        .accessibilityHidden(app.tab != tab)
                }
            }
        }
    }

    @ViewBuilder private func screen(_ tab: AppTab) -> some View {
        switch tab {
        case .feed: FeedScreen()
        case .todos: TodosScreen()
        case .journal: JournalScreen()
        case .context: ContextScreen()
        case .following: FollowingScreen()
        case .agents: AgentsScreen()
        }
    }
}

/// The app bar: icons only, in one glass pill.
struct NavBar: View {
    var vertical: Bool
    var showNow: Bool
    var indicator: Namespace.ID
    @Environment(AppModel.self) private var app

    var body: some View {
        let layout = vertical ? AnyLayout(VStackLayout(spacing: 4)) : AnyLayout(HStackLayout(spacing: 4))
        // Six tabs and the Now button fit a phone's width at 44 points each; the side bar keeps 48.
        let side: CGFloat = vertical ? 48 : 44
        layout {
            ForEach(AppTab.allCases) { tab in
                let on = app.tab == tab
                Button {
                    withAnimation(.ssSpring) { app.tab = tab }
                } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 20, weight: on ? .semibold : .regular))
                            .foregroundStyle(on ? Theme.accent : Theme.ink2)
                            .frame(width: side, height: side)
                        if tab == .agents && app.anyDirectUnread {
                            Circle().fill(Theme.accent).frame(width: 8, height: 8).offset(x: -10, y: 10)
                        }
                    }
                    .background {
                        if on {
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .fill(Theme.solid)
                                .shadow(color: Theme.shadow, radius: 8, x: 0, y: 4)
                                .matchedGeometryEffect(id: "tab", in: indicator)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.9))
                .accessibilityLabel(tab.label)
                .accessibilityIdentifier("nav.\(tab.rawValue)")
                .accessibilityAddTraits(on ? .isSelected : [])
            }
            // A wide screen docks the rail on its own; a narrow one needs a way to open it, and only when there is something in it.
            if showNow && !app.rail.isEmpty {
                Rectangle().fill(Theme.line).frame(width: vertical ? 24 : 1, height: vertical ? 1 : 24).padding(vertical ? .vertical : .horizontal, 4)
                Button {
                    withAnimation(.ssSpring) { app.railSheet.toggle() }
                } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "sidebar.right")
                            .font(.system(size: 20))
                            .foregroundStyle(app.railSheet ? Theme.accent : Theme.ink2)
                            .frame(width: side, height: side)
                        Text("\(app.rail.count)")
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 17, minHeight: 17)
                            .background(app.railLevel == "error" ? Theme.danger : app.railLevel == "warning" ? Theme.warn : Theme.accent, in: Capsule())
                            .offset(x: -5, y: 7)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.9))
                .accessibilityLabel("Now: \(app.rail.count) \(app.rail.count == 1 ? "thing" : "things") to know")
                .accessibilityIdentifier("nav.now")
            }
        }
        .padding(6)
        .glass(radius: 26)
    }
}

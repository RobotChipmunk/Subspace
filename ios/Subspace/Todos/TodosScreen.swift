import SwiftUI

/// The owner's tasks: folders beside (or above) the selected folder's list, with the open task's
/// detail taking the list's place, as on the web.
struct TodosScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var store = TodosStore()

    init() {}

    var body: some View {
        let wide = sizeClass == .regular
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Color.clear.frame(height: 0).id("todos.top")
                    TodosLayout(store: store, wide: wide)
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 40)
                .column(920)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await store.refreshAll() }
            .onChange(of: store.openID) { _, _ in
                proxy.scrollTo("todos.top", anchor: .top)
            }
        }
        .task {
            store.app = app
            await poll()
        }
        .onChange(of: app.pendingTodoID, initial: true) { _, id in
            guard let id else { return }
            store.app = app
            app.pendingTodoID = nil
            Task { await store.openPending(id) }
        }
        .onChange(of: app.tab) { _, tab in
            guard tab == .todos else { return }
            store.app = app
            Task { await store.refreshAll() }
        }
    }

    /// The web page asks for the list every 15 seconds and for the folders and the bin every 30.
    private func poll() async {
        var tick = 0
        while !Task.isCancelled {
            if app.tab == .todos && app.signedIn {
                let slow = tick % 2 == 0
                if slow { await store.refreshFolders() }
                if store.isBin {
                    if slow { await store.refreshBin() }
                } else if store.openID == nil {
                    await store.refreshList()
                }
            }
            tick += 1
            try? await Task.sleep(for: .seconds(15))
        }
    }
}

/// Folders in a column beside the list on regular width; a row of folders above it on compact.
private struct TodosLayout: View {
    var store: TodosStore
    var wide: Bool

    var body: some View {
        if wide {
            HStack(alignment: .top, spacing: 32) {
                TodosFolderNav(store: store, vertical: true)
                    .frame(width: 200)
                    .padding(.top, 70)
                TodosSection(store: store)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        } else {
            VStack(alignment: .leading, spacing: 16) {
                // on a phone an open task reads as a pushed view: the folders step aside
                if store.openID == nil {
                    TodosFolderNav(store: store, vertical: false)
                }
                TodosSection(store: store)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
    }
}

/// The list, the bin or the open task.
private struct TodosSection: View {
    var store: TodosStore

    var body: some View {
        if let id = store.openID {
            TodosDetail(id: id, store: store)
                .id(id)
                .transition(.opacity)
        } else if store.isBin {
            TodosBinView(store: store)
                .transition(.opacity)
        } else {
            TodosListView(store: store)
                .transition(.opacity)
        }
    }
}

private struct TodosFolderEntry: Identifiable {
    let key: String
    let label: String
    let count: Int
    let gap: Bool
    let dim: Bool
    var id: String { key }
}

private struct TodosFolderNav: View {
    var store: TodosStore
    var vertical: Bool
    @Namespace private var indicator

    private var entries: [TodosFolderEntry] {
        var out: [TodosFolderEntry] = []
        let folders = store.folders
        for index in folders.indices {
            let folder = folders[index]
            var gap = folder.key == "next_week"
            if index == 2 && folder.key != "weekend" { gap = true }
            if folder.guest != nil && index > 0 && folders[index - 1].guest == nil { gap = true }
            out.append(TodosFolderEntry(key: folder.key, label: folder.label, count: folder.count, gap: gap, dim: false))
        }
        // appears only while there is something to bring back
        if store.binCount > 0 {
            out.append(TodosFolderEntry(key: TodosStore.binKey, label: "Recently deleted", count: store.binCount, gap: true, dim: true))
        }
        return out
    }

    var body: some View {
        if vertical {
            VStack(alignment: .leading, spacing: 2) {
                buttons
            }
        } else {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) {
                        buttons
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.horizontal, -16)
                .onChange(of: store.view) { _, key in
                    withAnimation(.ssSoft) { proxy.scrollTo(key, anchor: .center) }
                }
            }
        }
    }

    private var buttons: some View {
        ForEach(entries) { entry in
            TodosFolderButton(entry: entry, on: store.view == entry.key, fill: vertical, indicator: indicator) {
                store.select(entry.key)
            }
            .padding(.top, vertical && entry.gap ? 12 : 0)
            .id(entry.key)
        }
    }
}

private struct TodosFolderButton: View {
    var entry: TodosFolderEntry
    var on: Bool
    var fill: Bool
    var indicator: Namespace.ID
    var action: () -> Void

    var body: some View {
        let ink: Color = on ? Theme.ink : (entry.dim ? Theme.ink3 : Theme.ink2)
        let weight: Font.Weight = on ? .semibold : .regular
        let countInk: Color = on ? Theme.accent : Theme.ink3
        Button(action: action) {
            HStack(spacing: 8) {
                Text(entry.label)
                    .font(.system(size: 14.5, weight: weight))
                    .foregroundStyle(ink)
                    .lineLimit(1)
                    .fixedSize()
                if fill { Spacer(minLength: 0) }
                if entry.count > 0 {
                    Text("\(entry.count)")
                        .font(.system(size: 12.5))
                        .monospacedDigit()
                        .foregroundStyle(countInk)
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background {
                if on {
                    Color.clear
                        .glass(radius: 12)
                        .matchedGeometryEffect(id: "folder", in: indicator)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressStyle(scale: 0.97))
        .accessibilityIdentifier("todos.folder.\(entry.key)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The round box that marks a task done.
struct TodosCheck: View {
    var on: Bool
    var size: CGFloat = 22
    var label: String
    var action: () -> Void

    var body: some View {
        let edge: Color = on ? Theme.accent : Theme.ink3
        Button(action: action) {
            ZStack {
                Circle().fill(on ? Theme.accent : Color.clear)
                Circle().strokeBorder(edge, lineWidth: 1.5)
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.5, weight: .bold))
                    .foregroundStyle(Color.white)
                    .opacity(on ? 1 : 0)
            }
            .frame(width: size, height: size)
            .frame(minWidth: 36, minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle(scale: 0.86))
        .animation(.ssSpring, value: on)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The small tag on a task that came from a guest ("From Meredith").
struct TodosFromTag: View {
    var guestID: String?
    @Environment(AppModel.self) private var app

    var body: some View {
        if let guest = app.agent(guestID) {
            Text("From \(guest.name)")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(Theme.accent)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 8)
                .padding(.vertical, 1)
                .background(Theme.accentSoft, in: Capsule())
        }
    }
}

/// What went wrong, said quietly.
struct TodosProblem: View {
    var text: String?

    var body: some View {
        if let text, !text.isEmpty {
            Text(text)
                .font(.ssSecondary)
                .foregroundStyle(Theme.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
                .padding(.bottom, 10)
        }
    }
}

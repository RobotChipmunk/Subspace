import SwiftUI
import UniformTypeIdentifiers

/// The plan: the owner's priorities as a short outline, each with parts one level down, and the
/// tasks under each line. It is where they step back and look at everything; the day lists are
/// where the work is done. Nothing is counted.
///
/// Every priority and part starts open with its tasks showing; "Not in the plan" starts closed.
/// Only a line with something under it has a chevron, which closes it, and what the owner closes
/// or opens stays that way. A line with nothing under it is just its name.
struct TodosPlanView: View {
    var store: TodosStore

    private var tops: [TodosPlanItem] {
        store.plan.filter { $0.parent_id == nil }
    }

    private func parts(of id: String) -> [TodosPlanItem] {
        store.plan.filter { $0.parent_id == id }
    }

    var body: some View {
        let priorities = tops
        let loose = store.planTasks[TodosStore.noLine] ?? []
        VStack(alignment: .leading, spacing: 0) {
            PageHeader("Plans", sub: "What you are working towards, and the tasks under each.")
            TodosProblem(text: store.problem)
            ForEach(priorities) { top in
                let kids = store.hasKids(top)
                // a line with nothing under it cannot be closed: there is nothing to hide
                let open = !kids || store.isOpen(top.id)
                VStack(alignment: .leading, spacing: 0) {
                    TodosPlanLine(item: top, kids: kids, open: open, store: store)
                    if open {
                        ForEach(parts(of: top.id)) { part in
                            let partKids = store.hasKids(part)
                            TodosPlanLine(item: part, kids: partKids, open: !partKids || store.isOpen(part.id), store: store)
                        }
                        TodosPlanAdd(parent: top, store: store)
                    }
                }
                .padding(.bottom, 12)
            }
            if store.foldersLoaded && priorities.isEmpty {
                Text("Nothing here yet. Add what you are working towards; your tasks stay in their lists.")
                    .font(.ssBody)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
                    .padding(.bottom, 8)
            }
            TodosPlanAddPriority(store: store)
                .padding(.top, 4)
            if !priorities.isEmpty {
                TodosPlanLine(item: nil, kids: !loose.isEmpty, open: store.isOpen(TodosStore.noLine), store: store)
                    .padding(.top, 24)
            }
        }
        // a line let go anywhere else in the plan keeps the place it was dragged to
        .onDrop(of: [UTType.text], isTargeted: nil) { _ in
            store.endLineDrag()
            return true
        }
        .task { await store.refreshPlan() }
    }
}

/// One line of the plan and, while it is open, its tasks. Without an item it is "Not in the
/// plan": the tasks that are part of nothing.
///
/// A line's name becomes a field when its words are tapped; return or leaving saves. The bin that
/// takes the line out of the plan shows beside it while the name is being edited. Held, the line
/// lifts and can be dragged to another place among its neighbours.
/// The chevron is there only when the line has something under it; otherwise its place is kept
/// empty so the controls of every line stay in one column. A part has a small plus at its end
/// that adds a task to it.
private struct TodosPlanLine: View {
    var item: TodosPlanItem?
    var kids: Bool
    var open: Bool
    var store: TodosStore
    @State private var over = false
    @State private var name = ""
    @State private var adding = false
    @State private var draft = ""
    /// The name is a field (it was tapped); otherwise its words, which a finger can hold to drag.
    @State private var editing = false
    @FocusState private var nameFocused: Bool
    @FocusState private var draftFocused: Bool

    var body: some View {
        let key = item?.id ?? TodosStore.noLine
        let title = item?.title ?? "Not in the plan"
        let top = item != nil && item?.parent_id == nil
        let part = item?.parent_id != nil
        let font: Font = top ? .system(size: 17, weight: .semibold) : .system(size: 15.5)
        let rows = store.planTasks[key] ?? []
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 4) {
                if item != nil && editing {
                    TextField("Name", text: $name, axis: .vertical)
                        .font(font)
                        .foregroundStyle(over ? Theme.accent : Theme.ink)
                        .tint(Theme.accent)
                        .focused($nameFocused)
                        .submitLabel(.done)
                        .padding(.vertical, 7)
                        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                        .onChange(of: name) { _, now in
                            // return ends the name: it is one line of words, however it wraps
                            if now.contains("\n") {
                                name = now.replacingOccurrences(of: "\n", with: "")
                                nameFocused = false
                            }
                        }
                        .accessibilityLabel("Name of \(title)")
                        .accessibilityIdentifier("todos.plan.name.\(key)")
                        .task { nameFocused = true }
                } else if item != nil {
                    Button {
                        editing = true
                    } label: {
                        Text(title)
                            .font(font)
                            .foregroundStyle(over ? Theme.accent : Theme.ink)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.vertical, 7)
                            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Name of \(title)")
                    .accessibilityHint("Tap to rename. Hold to move.")
                    .accessibilityIdentifier("todos.plan.name.\(key)")
                } else {
                    Button {
                        store.toggleLine(key)
                    } label: {
                        Text(title)
                            .font(font)
                            .foregroundStyle(over ? Theme.accent : Theme.ink2)
                            .padding(.vertical, 7)
                            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("todos.plan.line.\(key)")
                }
                if item != nil && nameFocused {
                    ConfirmDelete(label: "Remove \(title) from the plan", confirm: "Remove", size: 15) {
                        await store.removeLine(key)
                    }
                    .accessibilityIdentifier("todos.plan.remove.\(key)")
                    .transition(.opacity)
                }
                if part {
                    Button {
                        draft = ""
                        adding = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.ink3)
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityLabel("Add a task to \(title)")
                    .accessibilityIdentifier("todos.plan.partPlus.\(key)")
                }
                if kids {
                    Button {
                        nameFocused = false
                        store.toggleLine(key)
                    } label: {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.ink3)
                            .rotationEffect(.degrees(open ? 90 : 0))
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityLabel((open ? "Close " : "Open ") + title)
                    .accessibilityAddTraits(open ? .isSelected : [])
                    .accessibilityIdentifier("todos.plan.toggle.\(key)")
                } else if item != nil {
                    // the chevron's place, kept empty, so the controls of every line line up
                    Color.clear.frame(width: 36, height: 36).accessibilityHidden(true)
                }
            }
            .padding(.leading, part ? 20 : 0)
            .animation(.ssSoft, value: nameFocused)
            // held, the line lifts to be dragged among its neighbours
            .onDrag {
                store.planDragging = nil
                if let id = item?.id { store.lineDragging = id }
                return NSItemProvider(object: key as NSString)
            }
            if open && (!rows.isEmpty || adding) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(rows) { row in
                        TodosPlanRow(row: row, line: key, store: store)
                            .transition(.opacity)
                    }
                    if adding, let item {
                        HStack(alignment: .center, spacing: 4) {
                            Circle()
                                .strokeBorder(Theme.ink3, lineWidth: 1.5)
                                .frame(width: 22, height: 22)
                                .opacity(0.4)
                                .frame(width: 36, height: 36)
                                .accessibilityHidden(true)
                            TextField("New task", text: $draft)
                                .font(.system(size: 16))
                                .foregroundStyle(Theme.ink)
                                .tint(Theme.accent)
                                .focused($draftFocused)
                                .submitLabel(.done)
                                .frame(minHeight: 36)
                                .onSubmit {
                                    addTask()
                                    draftFocused = true
                                }
                                .task { draftFocused = true }
                                .accessibilityLabel("New task for \(item.title)")
                                .accessibilityIdentifier("todos.plan.add.\(key)")
                        }
                    }
                }
                .padding(.leading, part ? 16 : 0)
                .padding(.bottom, 8)
                .transition(.opacity)
            }
        }
        .padding(.horizontal, 8)
        // lit the way a folder is when a task is held over it
        .background(over ? Theme.solid : Color.clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(over ? Theme.accent : Color.clear, lineWidth: 1.5))
        .padding(.horizontal, -8)
        .onDrop(of: [UTType.text], delegate: TodosPlanDrop(key: key, store: store, over: $over))
        .animation(.ssSpring, value: over)
        // the field shows the saved name whenever nothing is being typed over it
        .onChange(of: item?.title, initial: true) { _, saved in
            if !nameFocused { name = saved ?? "" }
        }
        .onChange(of: nameFocused) { _, on in
            if !on && editing {
                editing = false
                rename()
            }
        }
        .onChange(of: draftFocused) { _, on in
            if !on && adding {
                addTask()
                adding = false
            }
        }
    }

    private func rename() {
        let next = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let item else { return }
        guard !next.isEmpty, next != item.title else {
            name = item.title
            return
        }
        let id = item.id
        Task { await store.renameLine(id, to: next) }
    }

    private func addTask() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        guard !title.isEmpty, let item else { return }
        let id = item.id
        Task {
            let saved = await store.addPlanTask(title, to: id)
            // could not be saved: give the words back to the box
            if !saved && draft.isEmpty && adding { draft = title }
        }
    }
}

/// What a line of the plan does with something dragged over it: a line being moved takes its
/// place (when they are neighbours); a task being carried lights it and becomes part of it.
private struct TodosPlanDrop: DropDelegate {
    let key: String
    let store: TodosStore
    @Binding var over: Bool

    func dropEntered(info: DropInfo) {
        MainActor.assumeIsolated {
            if store.lineDragging != nil {
                store.lineEntered(key)
            } else {
                over = true
            }
        }
    }

    func dropExited(info: DropInfo) {
        MainActor.assumeIsolated { over = false }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        MainActor.assumeIsolated {
            over = false
            if store.lineDragging != nil {
                store.endLineDrag()
            } else {
                store.dropOnLine(key)
            }
        }
        return true
    }
}

/// A task under a line of the plan. Tap the circle to finish it, the words to open it. The word
/// at its end says where it sits; tapping it offers the other lists, and the other lines of the
/// plan it can be part of. Rest a finger on the row to lift it and carry it onto another line.
private struct TodosPlanRow: View {
    var row: Todo
    var line: String
    var store: TodosStore

    var body: some View {
        let id = row.id
        let label = TodosDates.placeLabel(scope: row.scope, date: row.date, today: store.today)
        let place = label.isEmpty ? "No date" : label
        HStack(alignment: .top, spacing: 4) {
            TodosCheck(on: row.done, label: row.done ? "Mark not done" : "Mark done") {
                Task { await store.togglePlanTask(id, in: line) }
            }
            .accessibilityIdentifier("todos.plan.check.\(id)")

            Button {
                store.open(id)
            } label: {
                Text(row.title)
                    .font(.system(size: 16))
                    .foregroundStyle(row.done ? Theme.ink3 : Theme.ink)
                    .strikethrough(row.done, color: Theme.line)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("todos.plan.row.\(id)")

            Menu {
                Section("Move to") {
                    ForEach(store.moveOptions(guest: row.guest_id)) { folder in
                        Button(folder.label) {
                            Task { await store.movePlanTask(id, to: folder.key) }
                        }
                    }
                }
                Section("Part of") {
                    ForEach(store.plan) { item in
                        let name = item.parent_id == nil ? item.title : "   " + item.title
                        Button {
                            Task { await store.setLine(id, from: line, to: item.id) }
                        } label: {
                            if item.id == row.plan_id { Label(name, systemImage: "checkmark") } else { Text(name) }
                        }
                    }
                    Button {
                        Task { await store.setLine(id, from: line, to: nil) }
                    } label: {
                        if row.plan_id == nil { Label("Not in the plan", systemImage: "checkmark") } else { Text("Not in the plan") }
                    }
                }
            } label: {
                Text(place)
                    .font(.ssMeta)
                    .foregroundStyle(place == "Today" ? Theme.accent : Theme.ink3)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 8)
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("\(place). Move \(row.title)")
            .accessibilityIdentifier("todos.plan.place.\(id)")
        }
        // As tall as its title needs, so the circle stays level with the first line.
        .fixedSize(horizontal: false, vertical: true)
        .contentShape(Rectangle())
        .onDrag {
            store.lineDragging = nil
            store.planDragging = (id: id, line: line)
            return NSItemProvider(object: id as NSString)
        }
    }
}

/// The plus under a priority. It opens the system menu: "Add a task" first, which is what is
/// wanted most often, then "Add a part". Parts are optional, so nothing about them shows until
/// asked for. Either choice turns the plus into a field; a task typed there goes on the priority
/// (in the backlog) and the priority opens to show it.
private struct TodosPlanAdd: View {
    var parent: TodosPlanItem
    var store: TodosStore
    /// "task" or "part" while its field is open.
    @State private var mode: String? = nil
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        let task = mode == "task"
        Group {
            if mode != nil {
                HStack(alignment: .center, spacing: 4) {
                    if task {
                        Circle()
                            .strokeBorder(Theme.ink3, lineWidth: 1.5)
                            .frame(width: 22, height: 22)
                            .opacity(0.4)
                            .frame(width: 36, height: 36)
                            .accessibilityHidden(true)
                    }
                    TextField(task ? "New task" : "New part", text: $draft)
                        .font(.system(size: task ? 16 : 15.5))
                        .foregroundStyle(Theme.ink)
                        .tint(Theme.accent)
                        .focused($focused)
                        .submitLabel(.done)
                        .frame(minHeight: 36)
                        .padding(.leading, task ? 0 : 20)
                        .onSubmit {
                            if task {
                                // stays for the next one
                                add()
                                focused = true
                            } else {
                                focused = false
                            }
                        }
                        .accessibilityLabel(task ? "New task for \(parent.title)" : "New part of \(parent.title)")
                        .accessibilityIdentifier(task ? "todos.plan.add.\(parent.id)" : "todos.plan.part.\(parent.id)")
                        // the field has only just appeared: it takes the keys once it is there
                        .task { focused = true }
                }
            } else {
                Menu {
                    Button("Add a task") { begin("task") }
                    Button("Add a part") { begin("part") }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.ink2)
                        .frame(width: 22, height: 22)
                        .background(Theme.fill2, in: Circle())
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Add to \(parent.title)")
                .accessibilityIdentifier("todos.plan.plus.\(parent.id)")
            }
        }
        .onChange(of: focused) { _, on in
            if !on && mode != nil {
                add()
                mode = nil
            }
        }
    }

    private func begin(_ what: String) {
        draft = ""
        mode = what
        focused = true
    }

    private func add() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let task = mode == "task"
        draft = ""
        if title.isEmpty { return }
        let id = parent.id
        Task {
            if task {
                let saved = await store.addPlanTask(title, to: id)
                // could not be saved: give the words back to the box
                if !saved && draft.isEmpty && mode == "task" { draft = title }
            } else {
                _ = await store.addLine(title, parent: id)
            }
        }
    }
}

/// The field at the end of the outline that adds a priority. Return adds it and stays for the next.
private struct TodosPlanAddPriority: View {
    var store: TodosStore
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("Add a priority", text: $draft)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .tint(Theme.accent)
            .focused($focused)
            .submitLabel(.done)
            .frame(minHeight: 40)
            .padding(.horizontal, 4)
            .onSubmit { add() }
            .onChange(of: focused) { _, on in
                if !on { add() }
            }
            .accessibilityLabel("Add a priority")
            .accessibilityIdentifier("todos.plan.addPriority")
    }

    private func add() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        if title.isEmpty { return }
        Task {
            let saved = await store.addLine(title)
            if !saved && draft.isEmpty { draft = title }
        }
    }
}

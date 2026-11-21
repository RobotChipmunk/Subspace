import SwiftUI
import UniformTypeIdentifiers

/// The plan: the owner's priorities as a short outline, each with parts one level down, and the
/// tasks under each line. It is where they step back and look at everything; the day lists are
/// where the work is done. A line shows nothing at its end but the way to open it: nothing is
/// counted, and a line with no tasks is not marked.
///
/// Tapping a line opens its tasks in place. A task shows where it sits (Today, This week,
/// Backlog), and that word offers the other lists and the other lines it can go to.
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
        VStack(alignment: .leading, spacing: 0) {
            PageHeader("Plans", sub: "What you are working towards, and the tasks under each.") {
                TodosHideDone(store: store)
            }
            TodosProblem(text: store.problem)
            ForEach(priorities) { top in
                VStack(alignment: .leading, spacing: 0) {
                    TodosPlanLine(item: top, store: store)
                    ForEach(parts(of: top.id)) { part in
                        TodosPlanLine(item: part, store: store)
                    }
                    TodosPlanAdd(parent: top, store: store)
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
                TodosPlanLine(item: nil, store: store)
                    .padding(.top, 24)
            }
        }
        .task { await store.refreshPlan() }
    }
}

/// One line of the plan with, once opened, its tasks. Without an item it is "Not in the plan":
/// the tasks that are part of nothing.
///
/// An open line's name is a field: tap the words and type, as with a task's name. The bin that
/// takes the line out of the plan sits beside it.
private struct TodosPlanLine: View {
    var item: TodosPlanItem?
    var store: TodosStore
    @State private var over = false
    @State private var name = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        let key = item?.id ?? TodosStore.noLine
        let title = item?.title ?? "Not in the plan"
        let open = store.openLines.contains(key)
        let top = item != nil && item?.parent_id == nil
        let part = item?.parent_id != nil
        let font: Font = top ? .system(size: 17, weight: .semibold) : .system(size: 15.5)
        let ink: Color = over ? Theme.accent : (item == nil ? Theme.ink2 : Theme.ink)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 4) {
                if open, item != nil {
                    TextField("Name", text: $name, axis: .vertical)
                        .font(font)
                        .foregroundStyle(Theme.ink)
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
                } else {
                    Button {
                        store.toggleLine(key)
                    } label: {
                        Text(title)
                            .font(font)
                            .foregroundStyle(ink)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.vertical, 7)
                            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(title)
                    .accessibilityIdentifier("todos.plan.line.\(key)")
                }
                if open, item != nil {
                    ConfirmDelete(label: "Remove \(title) from the plan", confirm: "Remove", size: 15) {
                        await store.removeLine(key)
                    }
                    .accessibilityIdentifier("todos.plan.remove.\(key)")
                }
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
                .accessibilityIdentifier("todos.plan.toggle.\(key)")
            }
            if open {
                TodosPlanTasks(line: key, item: item, store: store)
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 8)
        // lit the way a folder is when a task is held over it
        .background(over ? Theme.solid : Color.clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(over ? Theme.accent : Color.clear, lineWidth: 1.5))
        .padding(.horizontal, -8)
        .onDrop(of: [UTType.text], isTargeted: $over) { _ in
            store.dropOnLine(key)
            return true
        }
        .animation(.ssSpring, value: over)
        // the field shows the saved name whenever nothing is being typed over it
        .onChange(of: open, initial: true) { _, _ in
            name = item?.title ?? ""
        }
        .onChange(of: item?.title) { _, saved in
            if !nameFocused { name = saved ?? "" }
        }
        .onChange(of: nameFocused) { _, on in
            if !on { rename() }
        }
    }

    private func rename() {
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let item else { return }
        guard !title.isEmpty, title != item.title else {
            name = item.title
            return
        }
        let id = item.id
        Task { await store.renameLine(id, to: title) }
    }
}

/// The tasks of one opened line, soonest first, and for a part the field that adds one (a
/// priority adds through the plus under it).
private struct TodosPlanTasks: View {
    var line: String
    var item: TodosPlanItem?
    var store: TodosStore
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        // with finished tasks hidden, the unfinished and whichever were ticked a moment ago
        let rows = store.planTasks[line].map { store.seen($0) }
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows ?? []) { row in
                TodosPlanRow(row: row, line: line, store: store)
                    .transition(.opacity)
            }
            if let item {
                if item.parent_id != nil {
                    HStack(alignment: .center, spacing: 4) {
                        Circle()
                            .strokeBorder(Theme.ink3, lineWidth: 1.5)
                            .frame(width: 22, height: 22)
                            .opacity(0.4)
                            .frame(width: 36, height: 36)
                            .accessibilityHidden(true)
                        TextField("Add a task", text: $draft)
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.ink)
                            .tint(Theme.accent)
                            .focused($focused)
                            .submitLabel(.done)
                            .frame(minHeight: 36)
                            .onSubmit {
                                add()
                                focused = true
                            }
                            .accessibilityLabel("Add a task to \(item.title)")
                            .accessibilityIdentifier("todos.plan.add.\(line)")
                    }
                }
            } else if let rows, rows.isEmpty {
                Text("Every task is part of the plan.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.ink3)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 8)
            }
        }
        .padding(.bottom, 8)
    }

    private func add() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        if title.isEmpty { return }
        Task {
            let saved = await store.addPlanTask(title, to: line)
            // could not be saved: give the words back to the box
            if !saved && draft.isEmpty { draft = title }
        }
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
            store.draggingID = nil
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

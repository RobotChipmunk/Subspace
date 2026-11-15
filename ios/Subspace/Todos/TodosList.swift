import SwiftUI
import UniformTypeIdentifiers

/// The selected folder: its title, its tasks under their headings, and the field that adds one.
struct TodosListView: View {
    var store: TodosStore

    var body: some View {
        let loaded = store.rows != nil
        let empty = store.rows?.isEmpty ?? false
        VStack(alignment: .leading, spacing: 0) {
            PageHeader(store.folder?.label ?? "", sub: store.listSub)
            TodosProblem(text: store.problem)
            ForEach(store.groups) { group in
                TodosGroupView(group: group, store: store)
            }
            if empty {
                Text("Nothing here.")
                    .font(.ssBody)
                    .foregroundStyle(Theme.ink3)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 20)
            }
            if loaded && store.canAdd {
                TodosAddField(store: store)
                    .padding(.top, 4)
            }
        }
        .onDrop(of: [UTType.text], delegate: TodosDrop(entered: {}, dropped: { store.endDrag() }))
    }
}

private struct TodosKeyedRow: Identifiable {
    let id: String
    let row: Todo
}

private struct TodosGroupView: View {
    var group: TodosGroup
    var store: TodosStore

    /// Rows under the identity they were first drawn with, so a new task does not redraw when saved.
    private var keyed: [TodosKeyedRow] {
        var out: [TodosKeyedRow] = []
        for row in group.items {
            out.append(TodosKeyedRow(id: store.rowKey(row.id), row: row))
        }
        return out
    }

    var body: some View {
        let tagged = store.folder?.guest == nil
        let today = store.today
        VStack(alignment: .leading, spacing: 0) {
            if !group.key.isEmpty {
                Text(store.groupTitle(group.key).uppercased())
                    .font(.system(size: 12.5, weight: .semibold))
                    .tracking(0.75)
                    .foregroundStyle(Theme.ink3)
                    .padding(.horizontal, 4)
                    .padding(.top, 20)
                    .padding(.bottom, 4)
                    .accessibilityAddTraits(.isHeader)
            }
            ForEach(keyed) { item in
                // on a person's list a task says which day it has been given
                let place = tagged ? "" : TodosDates.placeLabel(scope: item.row.scope, date: item.row.date, today: today)
                TodosRowView(row: item.row, tag: tagged && item.row.guest_id != nil, place: place, store: store)
                    .transition(.opacity)
            }
        }
        .padding(.bottom, 8)
    }
}

/// One task in the list. Tap the circle to finish it, the words to open it; rest a finger on it to
/// lift it and carry it to another place in its group.
private struct TodosRowView: View {
    var row: Todo
    var tag: Bool
    var place: String
    var store: TodosStore

    var body: some View {
        let temp = row.id.hasPrefix("new_")
        let id = row.id
        let nextID = row.done ? row.next_id : nil
        let nextDate = row.done ? row.next_date : nil
        HStack(alignment: .top, spacing: 4) {
            TodosCheck(on: row.done, label: row.done ? "Mark not done" : "Mark done") {
                Task { await store.toggle(id) }
            }
            .accessibilityIdentifier("todos.check.\(id)")

            VStack(alignment: .leading, spacing: 0) {
                Button {
                    if !temp { store.open(id) }
                } label: {
                    TodosRowLabel(row: row, tag: tag, place: place)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("todos.row.\(id)")

                // finished and repeating: the next one has been added, and can be opened from here
                if let nextID, let nextDate {
                    TodosNextNote(date: nextDate, today: store.today) {
                        store.open(nextID)
                    }
                    .padding(.top, -6)
                    .transition(.opacity)
                }
            }

            if !temp {
                ConfirmDelete(label: "Delete \(row.title)", size: 14) {
                    await store.delete(id)
                }
                .accessibilityIdentifier("todos.delete.\(id)")
            }
        }
        .contentShape(Rectangle())
        .onDrag {
            store.beginDrag(id)
            return NSItemProvider(object: id as NSString)
        }
        .onDrop(of: [UTType.text], delegate: TodosDrop(entered: { store.dragEntered(id) }, dropped: { store.endDrag() }))
    }
}

/// On a finished repeating task: one quiet line saying when it comes round again, with a way to
/// open that one and change its date.
struct TodosNextNote: View {
    var date: String
    var today: String?
    var open: () -> Void

    var body: some View {
        let label = TodosDates.placeLabel(scope: "day", date: date, today: today)
        let day = label.isEmpty ? TodosDates.shortDate(date) : label
        HStack(spacing: 6) {
            Image(systemName: "repeat")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Theme.ink3)
                .accessibilityHidden(true)
            Text("Next one added for \(day)")
                .font(.ssMeta)
                .foregroundStyle(Theme.ink3)
                .lineLimit(1)
                .accessibilityIdentifier("todos.next.note")
            Button(action: open) {
                Text("Open")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .accessibilityLabel("Open the next one")
            .accessibilityIdentifier("todos.next.open")
        }
    }
}

private struct TodosRowLabel: View {
    var row: Todo
    var tag: Bool
    var place: String

    var body: some View {
        let unseen = row.ai_unseen ?? false
        let notes = row.has_notes ?? false
        let repeats = row.`repeat` != nil && !row.done
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.title)
                    .font(.system(size: 16))
                    .foregroundStyle(row.done ? Theme.ink3 : Theme.ink)
                    .strikethrough(row.done, color: Theme.line)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                if tag {
                    TodosFromTag(guestID: row.guest_id)
                }
            }
            if unseen {
                // someone else changed this task since it was last opened
                Circle()
                    .fill(Theme.accent)
                    .frame(width: 7, height: 7)
                    .padding(3)
                    .background(Theme.accentSoft, in: Circle())
                    .padding(.top, 4)
                    .accessibilityLabel("Changed since you last looked")
            }
            Spacer(minLength: 0)
            if !place.isEmpty {
                Text(place)
                    .font(.ssMeta)
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.top, 3)
            }
            if repeats {
                Image(systemName: "repeat")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.ink3)
                    .padding(.top, 4)
                    .accessibilityLabel("Repeats")
            }
            if notes {
                Image(systemName: "text.alignleft")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.ink3)
                    .padding(.top, 3)
                    .accessibilityLabel("Has notes")
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
        .contentShape(Rectangle())
    }
}

/// Carries a lifted row over the others. The closures are made by the list, on the main actor.
private struct TodosDrop: DropDelegate {
    let entered: () -> Void
    let dropped: () -> Void

    func dropEntered(info: DropInfo) {
        entered()
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        dropped()
        return true
    }
}

/// Types a new task into the selected folder. It shows at once; return adds it and stays for the next.
private struct TodosAddField: View {
    var store: TodosStore
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
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
                .focused($focused)
                .submitLabel(.done)
                .frame(minHeight: 36)
                .onSubmit {
                    add()
                    focused = true
                }
                .accessibilityLabel("Add task")
                .accessibilityIdentifier("todos.add")
        }
        .onChange(of: focused) { _, on in
            if !on { add() }
        }
    }

    private func add() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        if title.isEmpty { return }
        Task {
            let saved = await store.add(title)
            // could not be saved: give the words back to the box
            if !saved && draft.isEmpty { draft = title }
        }
    }
}

/// Deleted tasks, kept for a while so a slip can be undone. Each can be put back or removed for good.
struct TodosBinView: View {
    var store: TodosStore

    var body: some View {
        let empty = store.bin?.isEmpty ?? false
        VStack(alignment: .leading, spacing: 0) {
            PageHeader("Recently deleted", sub: "Kept for \(store.keepDays) days, then removed for good.")
            TodosProblem(text: store.problem)
            ForEach(store.bin ?? [], id: \.id) { item in
                TodosBinRow(item: item, store: store)
                    .transition(.opacity)
            }
            if empty {
                Text("Nothing here.")
                    .font(.system(size: 14.5))
                    .foregroundStyle(Theme.ink3)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 40)
            }
        }
        .task { await store.refreshBin() }
    }
}

private struct TodosBinRow: View {
    var item: TodosBinItem
    var store: TodosStore

    var body: some View {
        let id = item.id
        let left = item.days_left == 1 ? "Last day" : "\(item.days_left) days left"
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.ink2)
                    .strikethrough(item.done, color: Theme.line)
                    .fixedSize(horizontal: false, vertical: true)
                Text(left)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.ink3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("todos.binned.\(id)")

            Button {
                Task { await store.restore(id) }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.uturn.backward").font(.system(size: 12, weight: .medium))
                    Text("Restore")
                }
                .foregroundStyle(Theme.ink2)
            }
            .buttonStyle(PillStyle())
            .accessibilityLabel("Restore \(item.title)")
            .accessibilityIdentifier("todos.restore.\(id)")

            ConfirmDelete(label: "Delete \(item.title) for good", confirm: "Delete for good", size: 15) {
                await store.deleteForever(id)
            }
            .accessibilityIdentifier("todos.forever.\(id)")
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 7)
    }
}

import SwiftUI
import UniformTypeIdentifiers

/// The selected folder: its title, its tasks under their headings, and the field that adds one.
struct TodosListView: View {
    var store: TodosStore

    var body: some View {
        let loaded = store.rows != nil
        let empty = store.shownRows?.isEmpty ?? false
        let chosen = store.filter
        VStack(alignment: .leading, spacing: 0) {
            PageHeader(store.folder?.label ?? "", sub: store.listSub) {
                // only on a list that has tagged tasks, or while a choice is still in force
                if !store.viewTags.isEmpty {
                    TodosTagFilter(store: store)
                }
            }
            TodosProblem(text: store.problem)
            ForEach(store.groups) { group in
                TodosGroupView(group: group, store: store)
            }
            if empty {
                Text(chosen.isEmpty ? "Nothing here." : "Nothing tagged \(chosen.joined(separator: " or ")) here.")
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

/// Narrows the list to the tasks carrying one or more tags. It sits quietly at the right of the
/// list's heading, only on a list that has tagged tasks: a tag and the word "Tags", which turn
/// accent and name the choice while one is made. Tapping it opens the tags to choose from; the
/// menu stays open while they are ticked, so more than one can be chosen.
private struct TodosTagFilter: View {
    var store: TodosStore

    var body: some View {
        let chosen = store.filter
        let on = !chosen.isEmpty
        let title = on ? chosen.joined(separator: ", ") : "Tags"
        Menu {
            ForEach(store.viewTags) { item in
                Button {
                    store.toggleFilter(item.tag)
                } label: {
                    if chosen.contains(item.tag) { Label(item.tag, systemImage: "checkmark") } else { Text(item.tag) }
                }
                .menuActionDismissBehavior(.disabled)
            }
            if on {
                Divider()
                Button("Show all") { store.clearFilter() }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "tag")
                Text(title).lineLimit(1)
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(on ? Theme.accent : Theme.ink3)
            .padding(.horizontal, 10)
            .frame(minHeight: 36)
            .background(on ? Theme.accentSoft : Color.clear, in: Capsule())
            .contentShape(Capsule())
        }
        .accessibilityLabel(on ? "Tags: \(title)" : "Filter by tag")
        .accessibilityIdentifier("todos.tags.filter")
    }
}

/// A task's tags at the end of its row, as quiet chips: the first one or two, and how many more.
private struct TodosRowTags: View {
    var tags: [String]
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        let shown = Array(tags.prefix(sizeClass == .regular ? 2 : 1))
        let more = tags.count - shown.count
        HStack(spacing: 4) {
            ForEach(shown, id: \.self) { tag in
                // a long tag is cut short here; the task itself shows it whole
                Text(tag.count > 16 ? String(tag.prefix(15)) + "…" : tag)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 8)
                    .padding(.vertical, 1)
                    .background(Theme.fill, in: Capsule())
            }
            if more > 0 {
                Text("+\(more)")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.ink3)
                    .fixedSize()
            }
        }
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
        let key = group.key
        // a carried task held over this section: it lights as the day the task will land on
        let lit = !key.isEmpty && store.targetGroup == key
        VStack(alignment: .leading, spacing: 0) {
            if !key.isEmpty {
                Text(store.groupTitle(key).uppercased())
                    .font(.system(size: 12.5, weight: .semibold))
                    .tracking(0.75)
                    .foregroundStyle(lit ? Theme.accent : Theme.ink3)
                    .padding(.horizontal, 4)
                    .padding(.top, 8)
                    .padding(.bottom, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("todos.group.\(key)")
                    .onDrop(of: [UTType.text], delegate: TodosDrop(entered: { store.dragOverGroup(key) }, dropped: { store.endDrag() }))
            }
            ForEach(keyed) { item in
                // on a person's list a task says which day it has been given
                let place = tagged ? "" : TodosDates.placeLabel(scope: item.row.scope, date: item.row.date, today: today)
                TodosRowView(row: item.row, tag: tagged && item.row.guest_id != nil, place: place, store: store)
                    .transition(.opacity)
            }
            // in a list with sections each one that can take a task has its own plus, which adds to that day
            if store.rows != nil && store.takes(key) {
                TodosSectionAdd(section: key, store: store)
            }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 4)
        // lit the way a folder is when a task is held over it
        .background(lit ? Theme.solid : Color.clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(lit ? Theme.accent : Color.clear, lineWidth: 1.5))
        .padding(.horizontal, -8)
        .padding(.top, key.isEmpty ? 0 : 12)
        .padding(.bottom, 4)
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
        let tags = row.tags ?? []
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
            if !tags.isEmpty {
                TodosRowTags(tags: tags)
                    .padding(.top, 2)
            }
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

/// The plus at the end of one section of a list with sections. Tapped, it becomes that section's
/// add field; the field goes back to a plus when it is left empty.
private struct TodosSectionAdd: View {
    var section: String
    var store: TodosStore

    var body: some View {
        if store.addingSection == section {
            TodosAddField(store: store, section: section)
                .transition(.opacity)
        } else {
            Button {
                withAnimation(.ssSoft) { store.addingSection = section }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.ink2)
                    .frame(width: 22, height: 22)
                    .background(Theme.fill2, in: Circle())
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle(scale: 0.9))
            .accessibilityLabel("Add task to \(store.groupTitle(section))")
            .accessibilityIdentifier("todos.addIn.\(section)")
        }
    }
}

/// Types a new task into the selected folder, or into one section of it. It shows at once; return
/// adds it and stays for the next.
private struct TodosAddField: View {
    var store: TodosStore
    /// The section it adds to; empty in a list without sections.
    var section: String = ""
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
                .accessibilityLabel(section.isEmpty ? "Add task" : "Add task to \(store.groupTitle(section))")
                .accessibilityIdentifier(section.isEmpty ? "todos.add" : "todos.add.\(section)")
        }
        .onChange(of: focused) { _, on in
            if !on { add() }
        }
        // a section's field is opened by its plus, and takes the keys at once
        .task {
            if !section.isEmpty { focused = true }
        }
    }

    private func add() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        if title.isEmpty {
            // left empty: a section's field goes back to its plus
            if !section.isEmpty && !focused && store.addingSection == section {
                withAnimation(.ssSoft) { store.addingSection = nil }
            }
            return
        }
        Task {
            let saved = await store.add(title, to: section)
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

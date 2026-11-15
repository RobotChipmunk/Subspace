import SwiftUI

/// One task: its name, where it is, who it came from and its notes. Everything saves by itself.
struct TodosDetail: View {
    let id: String
    var store: TodosStore

    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var todo: Todo? = nil
    @State private var title: String = ""
    @State private var titleLoaded: Bool = false
    @State private var notes: String? = nil
    @State private var editing: Bool = false
    @State private var sentSeen: Bool = false
    @State private var problem: String? = nil
    @State private var saver = TodosSaver()
    @FocusState private var titleFocused: Bool
    @FocusState private var notesFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            topBar
            TodosProblem(text: problem)
            if let todo, let notes {
                heading(todo)
                origin(todo)
                notesArea(notes)
            } else if problem == nil {
                Capsule()
                    .fill(Theme.fill)
                    .frame(height: 32)
                    .frame(maxWidth: 320)
                    .padding(.top, 40)
                    .accessibilityHidden(true)
            }
        }
        .task {
            configure()
            await poll()
        }
        .onDisappear {
            // leaving by any road: what was typed still goes to the server
            let waiting = saver
            Task { await waiting.flush() }
        }
    }

    // MARK: Parts

    private var topBar: some View {
        HStack(spacing: 4) {
            Button {
                Task { await close() }
            } label: {
                HStack(spacing: 2) {
                    Image(systemName: "chevron.left").font(.system(size: 15, weight: .semibold))
                    Text(store.folder?.label ?? "Back").font(.system(size: 15)).lineLimit(1)
                }
                .foregroundStyle(Theme.accent)
                .padding(.trailing, 12)
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .accessibilityIdentifier("todos.detail.close")

            Spacer(minLength: 8)

            if let todo {
                TodosMoveMenu(place: place(todo), options: moveOptions(todo)) { key in
                    Task { await move(key) }
                }
                ConfirmDelete(label: "Delete task") {
                    await remove()
                }
                .accessibilityIdentifier("todos.detail.delete")
            }
        }
        .padding(.bottom, 12)
    }

    private func heading(_ todo: Todo) -> some View {
        HStack(alignment: .top, spacing: 6) {
            TodosCheck(on: todo.done, size: 26, label: "Done") {
                Task { await toggleDone() }
            }
            .accessibilityIdentifier("todos.detail.check")

            TextField("Task name", text: $title, axis: .vertical)
                .font(.ssDetailTitle)
                .foregroundStyle(todo.done ? Theme.ink3 : Theme.ink)
                .tint(Theme.accent)
                .submitLabel(.done)
                .focused($titleFocused)
                .padding(.top, 2)
                .accessibilityLabel("Task name")
                .accessibilityIdentifier("todos.detail.title")
                .onChange(of: title) { _, value in
                    // a task's name is one line: return finishes it
                    if value.contains("\n") {
                        title = value.replacingOccurrences(of: "\n", with: "")
                        titleFocused = false
                    }
                }
                .onChange(of: titleFocused) { _, on in
                    if !on { Task { await commitTitle() } }
                }
        }
    }

    @ViewBuilder private func origin(_ todo: Todo) -> some View {
        let creator = app.agent(todo.created_by)
        let guestName = app.agent(todo.guest_id)?.name ?? "They"
        let waiting = todo.scope == "guest"
        let shared = waiting ? "Not on a day yet. \(guestName) can see where you put it." : "\(guestName) can see this task, its notes and its day."
        VStack(alignment: .leading, spacing: 6) {
            if let creator, !creator.isHuman {
                HStack(spacing: 6) {
                    AvatarView(agent: creator, size: 16)
                    Text("Added by \(creator.name)")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.ink2)
                }
            }
            if todo.guest_id != nil {
                HStack(alignment: .top, spacing: 8) {
                    TodosFromTag(guestID: todo.guest_id)
                    Text(shared)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.leading, 42)
        .padding(.top, 6)
    }

    private func notesArea(_ notes: String) -> some View {
        let wide = sizeClass == .regular
        let names = TodosMarks.agentNames(in: notes, agents: app.agents)
        let showEditor = editing || notes.isEmpty
        return VStack(alignment: .leading, spacing: 12) {
            if !names.isEmpty {
                TodosReviewBanner(names: names) { markReviewed() }
            }
            if !notes.isEmpty {
                HStack {
                    Spacer(minLength: 0)
                    Button(editing ? "Done" : "Edit") {
                        toggleEditing()
                    }
                    .buttonStyle(PillStyle())
                    .accessibilityLabel(editing ? "Finish editing notes" : "Edit notes")
                    .accessibilityIdentifier("todos.detail.editNotes")
                }
            }
            if showEditor {
                TodosNotesEditor(text: notesBinding, focused: $notesFocused)
            } else {
                MarkdownView(markdown: notes)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.leading, wide ? 42 : 0)
        .padding(.top, 32)
        .onChange(of: notesFocused) { _, on in
            if on {
                editing = true
            } else {
                let waiting = saver
                Task { await waiting.flush() }
            }
        }
    }

    private var notesBinding: Binding<String> {
        Binding(
            get: { notes ?? "" },
            set: { value in
                if value != (notes ?? "") {
                    notes = value
                    saver.push(value)
                }
            }
        )
    }

    // MARK: Where it is

    private func place(_ todo: Todo) -> String {
        let today = store.today
        switch todo.scope {
        case "backlog":
            return "Backlog"
        case "guest":
            return "Not on a day"
        case "week":
            guard let today, let date = todo.date, let monday = TodosDates.monday(today) else { return "This week" }
            if date == monday { return "This week" }
            if date == TodosDates.adding(7, to: monday) { return "Next week" }
            return "Week of " + TodosDates.longDate(date)
        default:
            guard let date = todo.date else { return "Move to" }
            if date == today { return "Today" }
            if let folder = store.folders.first(where: { $0.key == date }) { return folder.label }
            return TodosDates.longDate(date)
        }
    }

    /// The same choices as the web's "Move to" picker.
    private func moveOptions(_ todo: Todo) -> [TodosFolder] {
        store.folders.filter { folder in
            folder.key != "week" && (folder.guest == nil || folder.guest == todo.guest_id)
        }
    }

    // MARK: Loading and saving

    private func configure() {
        let api = app.api
        let path = "todos/\(id)"
        saver.save = { text in
            try await api.send("PATCH", path, body: ["notes": text])
        }
    }

    /// The web page asks again every 8 seconds, and holds back while typed notes are waiting.
    private func poll() async {
        while !Task.isCancelled {
            if app.tab == .todos || todo == nil {
                await load()
            }
            try? await Task.sleep(for: .seconds(8))
        }
    }

    private func load() async {
        if saver.dirty { return }
        do {
            let fresh: Todo = try await app.api.get("todos/\(id)")
            take(fresh)
            problem = nil
        } catch is CancellationError {
            return
        } catch {
            if todo == nil { problem = error.localizedDescription }
        }
    }

    private func take(_ fresh: Todo) {
        todo = fresh
        if !titleLoaded {
            title = fresh.title
            titleLoaded = true
        }
        // take the server's notes only when nothing typed here is waiting or under the cursor
        if !saver.dirty && !notesFocused {
            notes = fresh.notes ?? ""
        } else if notes == nil {
            notes = fresh.notes ?? ""
        }
        let marked = (fresh.notes ?? "").contains("<ins ")
        if fresh.ai_unseen == true && !marked && !sentSeen {
            sentSeen = true
            let api = app.api
            let path = "todos/\(id)"
            Task {
                do {
                    try await api.send("PATCH", path, body: ["seen": true])
                } catch {
                    // the dot stays; opening the task again tries once more
                }
            }
        }
    }

    private func patch(_ body: [String: Any]) async -> Todo? {
        do {
            let fresh: Todo = try await app.api.send("PATCH", "todos/\(id)", body: body)
            problem = nil
            take(fresh)
            return fresh
        } catch {
            problem = error.localizedDescription
            return nil
        }
    }

    private func commitTitle() async {
        guard let current = todo else { return }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || title == current.title { return }
        _ = await patch(["title": title])
    }

    private func toggleDone() async {
        guard let current = todo else { return }
        let was = current.done
        withAnimation(.ssSpring) { setDone(!was) }
        let saved = await patch(["done": !was])
        if saved == nil {
            withAnimation(.ssSpring) { setDone(was) }
        }
    }

    private func setDone(_ value: Bool) {
        guard var current = todo else { return }
        current.done = value
        todo = current
    }

    private func toggleEditing() {
        if editing {
            notesFocused = false
            withAnimation(.ssSoft) { editing = false }
            let waiting = saver
            Task { await waiting.flush() }
        } else {
            withAnimation(.ssSoft) { editing = true }
        }
    }

    /// The owner has read what an agent wrote: the marks come off and the task counts as seen.
    private func markReviewed() {
        let clean = TodosMarks.strip(notes ?? "")
        withAnimation(.ssSoft) { notes = clean }
        saver.push(clean)
        let waiting = saver
        Task {
            await waiting.flush()
            _ = await patch(["seen": true])
        }
    }

    private func move(_ key: String) async {
        let wasWaiting = todo?.scope == "guest"
        await saver.flush()
        await commitTitle()
        guard await patch(["view": key]) != nil else { return }
        // a guest's waiting task now has a day: its module leaves the rail
        if wasWaiting { await app.refreshRail() }
        store.closeDetail()
    }

    private func remove() async {
        await saver.flush()
        do {
            try await app.api.send("DELETE", "todos/\(id)")
            if todo?.scope == "guest" { await app.refreshRail() }
            store.closeDetail()
        } catch {
            problem = error.localizedDescription
        }
    }

    private func close() async {
        titleFocused = false
        notesFocused = false
        await saver.flush()
        await commitTitle()
        store.closeDetail()
    }
}

/// Shows which day the task is on; tapping it offers the other places it can go.
private struct TodosMoveMenu: View {
    var place: String
    var options: [TodosFolder]
    var pick: (String) -> Void

    var body: some View {
        Menu {
            ForEach(options) { folder in
                Button(folder.label) { pick(folder.key) }
            }
        } label: {
            HStack(spacing: 5) {
                Text(place).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Theme.ink2)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(Theme.fill, in: Capsule())
            .contentShape(Capsule())
        }
        .accessibilityLabel("Move to. Now: \(place)")
        .accessibilityIdentifier("todos.detail.move")
    }
}

/// Says which agents wrote in the notes, with the button that accepts what they wrote.
private struct TodosReviewBanner: View {
    var names: [String]
    var review: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 13))
                .foregroundStyle(Theme.accent)
            Text("\(names.joined(separator: ", ")) added the highlighted text")
                .font(.system(size: 13.5))
                .foregroundStyle(Theme.ink)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: review) {
                Text("Mark reviewed")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 32)
                    .background(Theme.solid, in: Capsule())
                    .contentShape(Capsule())
            }
            .buttonStyle(PressStyle())
            .accessibilityIdentifier("todos.detail.reviewed")
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// The notes as plain markdown, for typing.
private struct TodosNotesEditor: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding

    var body: some View {
        TextEditor(text: $text)
            .font(.system(size: 16))
            .foregroundStyle(Theme.ink)
            .tint(Theme.accent)
            .scrollContentBackground(.hidden)
            .focused(focused)
            .frame(minHeight: 220)
            .overlay(alignment: .topLeading) {
                if text.isEmpty {
                    Text("Notes")
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.ink3)
                        .padding(.leading, 5)
                        .padding(.top, 8)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .accessibilityLabel("Notes")
            .accessibilityIdentifier("todos.detail.notes")
    }
}

/// The marks an agent's text carries in stored notes: `<ins data-agent="handle" data-ts="…">…</ins>`.
enum TodosMarks {
    /// The names of the agents whose marked text is in `markdown`, in the order they appear.
    static func agentNames(in markdown: String, agents: [Agent]) -> [String] {
        guard markdown.contains("<ins "), let re = try? NSRegularExpression(pattern: "<ins[^>]*data-agent=\"([^\"]+)\"") else { return [] }
        let ns = markdown as NSString
        var handles: [String] = []
        for match in re.matches(in: markdown, range: NSRange(location: 0, length: ns.length)) {
            if match.numberOfRanges < 2 { continue }
            let handle = ns.substring(with: match.range(at: 1))
            if !handles.contains(handle) { handles.append(handle) }
        }
        var names: [String] = []
        for handle in handles {
            let known = agents.first { $0.handle == handle }
            names.append(known?.name ?? "@" + handle)
        }
        return names
    }

    /// The same text with the marks taken off.
    static func strip(_ markdown: String) -> String {
        markdown
            .replacingOccurrences(of: "<ins[^>]*>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "</ins>", with: "")
    }
}

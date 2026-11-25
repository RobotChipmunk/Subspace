import SwiftUI

/// One task: its name, where it is, who it came from and its notes. Everything saves by itself.
struct TodosDetail: View {
    let id: String
    var store: TodosStore

    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var todo: Todo? = nil
    /// The label of a rail action being sent to its agent from this task.
    @State private var railSending: String? = nil
    @State private var title: String = ""
    @State private var titleLoaded: Bool = false
    @State private var notes: String? = nil
    @State private var editing: Bool = false
    @State private var showCalendar: Bool = false
    @State private var sentSeen: Bool = false
    @State private var problem: String? = nil
    @State private var saver = TodosSaver()
    /// The field that adds a tag is open in place of the "Add tag" pill.
    @State private var addingTag: Bool = false
    /// Whether the open tag field has had the keyboard. Losing it closes the field, but only after it had it.
    @State private var tagFieldFocused: Bool = false
    @State private var tagText: String = ""
    /// Tag changes on their way to the server; what comes back meanwhile does not undo them.
    @State private var tagBusy: Int = 0
    /// The rail has been told this task was opened.
    @State private var railTold: Bool = false
    @FocusState private var titleFocused: Bool
    @FocusState private var notesFocused: Bool
    @FocusState private var tagFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            topBar
            TodosProblem(text: problem)
            if let todo, let notes {
                heading(todo)
                schedule(todo)
                origin(todo)
                notesArea(notes)
                if !helpers.isEmpty {
                    TodosThread(todoID: id, to: helpers.first { $0.id == todo.assignee }?.name)
                        .padding(.leading, sizeClass == .regular ? 42 : 0)
                        .padding(.top, 28)
                }
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
        .showing(.todos, "todo", id: id, title: todo?.title)
        .onChange(of: tagText) { _, now in
            if now.count > 30 { tagText = String(now.prefix(30)) }
        }
        .onChange(of: tagFocused) { _, on in tagFocusChanged(on) }
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
                    Text(store.folder?.label ?? (store.isPlan ? "Plans" : "Back")).font(.system(size: 15)).lineLimit(1)
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

    /// When it is for, and whether it comes round again. The date pill opens a month calendar in
    /// place; choosing a day there saves at once.
    private func schedule(_ todo: Todo) -> some View {
        let label = TodosDates.placeLabel(scope: todo.scope, date: todo.date, today: store.today)
        let dateText = label.isEmpty ? "No date" : label
        let rule = todo.`repeat`
        let nextID = todo.done ? todo.next_id : nil
        let nextDate = todo.done ? todo.next_date : nil
        return VStack(alignment: .leading, spacing: 8) {
            // One row of pills: the date, how often it repeats, then its tags and the way to add
            // one. They wrap together on a narrow screen.
            FlowRow(spacing: 6) {
                Button {
                    withAnimation(.ssSoft) { showCalendar.toggle() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar")
                        Text(dateText).lineLimit(1)
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(showCalendar ? Theme.accent : Theme.ink2)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                    .background(showCalendar ? Theme.accentSoft : Theme.fill, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(PressStyle())
                .accessibilityLabel("Date: \(dateText)")
                .accessibilityIdentifier("todos.detail.date")

                TodosRepeatMenu(rule: rule) { value in
                    Task { await setRepeat(value) }
                }

                // the agent it is given to: that agent is told, and hears what is said on the task
                if !helpers.isEmpty {
                    TodosGiveToMenu(agents: helpers, chosen: todo.assignee) { value in
                        Task { await setAssignee(value) }
                    }
                }

                // the line of the plan it is part of; only once there is a plan
                if !store.plan.isEmpty {
                    TodosPartOfMenu(lines: store.plan, chosen: todo.plan_id) { value in
                        Task { await setPlan(value) }
                    }
                }

                tagPills(todo.tags ?? [])
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            if showCalendar, let today = store.today {
                monthCalendar(todo, today: today)
                    .transition(.opacity)
            }
            if let rule, !todo.done {
                Text(TodosRepeat.hint(rule))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let nextID, let nextDate {
                TodosNextNote(date: nextDate, today: store.today) {
                    Task { await openNext(nextID) }
                }
                .transition(.opacity)
            }
        }
        .padding(.leading, 42)
        .padding(.top, 10)
    }

    /// The system's own month calendar, Monday first, with days already past not offered.
    private func monthCalendar(_ todo: Todo, today: String) -> some View {
        let first = TodosDates.date(today) ?? Date()
        let onDay = todo.scope == "day" ? todo.date : nil
        let shown = max(TodosDates.date(onDay ?? today) ?? first, first)
        let selection = Binding<Date>(
            get: { shown },
            set: { picked in
                let day = TodosDates.string(picked)
                if day == onDay { return }
                Task { await pickDate(day) }
            }
        )
        return DatePicker("Date", selection: selection, in: first..., displayedComponents: .date)
            .datePickerStyle(.graphical)
            .labelsHidden()
            .tint(Theme.accent)
            .environment(\.calendar, TodosDates.pickerCalendar)
            .environment(\.timeZone, TodosDates.zone)
            .padding(8)
            .frame(maxWidth: 340)
            .background(Theme.solid, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
            .shadow(color: Theme.shadowLift, radius: 18, y: 8)
            .accessibilityIdentifier("todos.detail.calendar")
    }

    // MARK: Tags

    /// Quiet chips, each with a way to take it off, and a pill that opens into a field to add one.
    /// They follow the date and repeat pills (each is its own item in that row, so they wrap one
    /// by one). While the field is open, tags other tasks already carry are offered beside it.
    @ViewBuilder private func tagPills(_ tags: [String]) -> some View {
        ForEach(tags, id: \.self) { tag in
            tagChip(tag)
        }
        if tags.count < 6 {
            tagAdder
            if addingTag {
                ForEach(tagSuggestions(tags), id: \.self) { tag in
                    suggestionChip(tag)
                }
            }
        }
    }

    /// Tags the tasks already use, offered while one is being typed: those that contain what is
    /// typed, without the ones this task already has.
    private func tagSuggestions(_ tags: [String]) -> [String] {
        let typed = journalCleanTag(tagText).lowercased()
        var out: [String] = []
        for item in store.knownTags {
            if out.count >= 6 { break }
            let lower = item.tag.lowercased()
            if tags.contains(where: { $0.lowercased() == lower }) { continue }
            if typed.isEmpty || lower.contains(typed) { out.append(item.tag) }
        }
        return out
    }

    private func suggestionChip(_ tag: String) -> some View {
        Button {
            tagText = ""
            closeTagField()
            chooseTags((todo?.tags ?? []) + [tag])
        } label: {
            Text(tag)
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink3)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(height: 36)
                .overlay(Capsule().strokeBorder(Theme.fill2, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(PressStyle(scale: 0.95))
        .accessibilityLabel("Add tag \(tag)")
        .accessibilityIdentifier("todos.detail.tags.suggest.\(tag)")
    }

    private func tagChip(_ tag: String) -> some View {
        HStack(spacing: 0) {
            Text(tag)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .accessibilityIdentifier("todos.detail.tags.item.\(tag)")
            Button {
                chooseTags((todo?.tags ?? []).filter { $0 != tag })
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.ink3)
                    .frame(width: 28, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle(scale: 0.9))
            .accessibilityLabel("Remove tag \(tag)")
            .accessibilityIdentifier("todos.detail.tags.remove.\(tag)")
        }
        .padding(.leading, 12)
        .frame(height: 36)
        .background(Theme.fill, in: Capsule())
    }

    @ViewBuilder private var tagAdder: some View {
        if addingTag {
            TextField("Tag", text: $tagText)
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink)
                .tint(Theme.accent)
                .submitLabel(.done)
                .focused($tagFocused)
                .onSubmit {
                    addTag()
                    closeTagField()
                }
                .onAppear { tagFocused = true }
                .frame(width: 120)
                .padding(.horizontal, 12)
                .frame(height: 36)
                .background(Theme.fill, in: Capsule())
                .accessibilityLabel("New tag")
                .accessibilityIdentifier("todos.detail.tags.field")
        } else {
            Button {
                tagFieldFocused = false
                withAnimation(.ssSoft) { addingTag = true }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
                    Text("Add tag").font(.system(size: 13, weight: .medium))
                }
                .foregroundStyle(Theme.ink3)
                .padding(.horizontal, 10)
                .frame(height: 36)
                .contentShape(Capsule())
            }
            .buttonStyle(PressStyle(scale: 0.95))
            .accessibilityLabel("Add tag")
            .accessibilityIdentifier("todos.detail.tags.add")
        }
    }

    /// Adds what is typed as a tag, unless the task already has it. One the tasks already use
    /// keeps the spelling it has there.
    private func addTag() {
        let typed = journalCleanTag(tagText)
        tagText = ""
        let tags = todo?.tags ?? []
        let lower = typed.lowercased()
        if typed.isEmpty || tags.contains(where: { $0.lowercased() == lower }) { return }
        let known = store.knownTags.first(where: { $0.tag.lowercased() == lower })?.tag
        chooseTags(tags + [known ?? typed])
    }

    /// Shows the task's new tags at once and saves them behind.
    private func chooseTags(_ next: [String]) {
        guard var current = todo else { return }
        current.tags = next
        withAnimation(.ssSoft) { todo = current }
        tagBusy += 1
        let api = app.api
        let path = "todos/\(id)"
        Task {
            do {
                let fresh: Todo = try await api.send("PATCH", path, body: ["tags": next])
                tagBusy -= 1
                problem = nil
                if tagBusy == 0 { take(fresh) }
            } catch {
                tagBusy -= 1
                problem = error.localizedDescription
            }
            // the lists offer the tags the tasks carry
            await store.refreshFolders()
        }
    }

    /// Closes the tag field and lets go of the keyboard, so no focus on a field that is gone lingers.
    private func closeTagField() {
        tagFieldFocused = false
        withAnimation(.ssSoft) { addingTag = false }
        if tagFocused { tagFocused = false }
    }

    private func tagFocusChanged(_ on: Bool) {
        if on {
            tagFieldFocused = true
        } else if addingTag && tagFieldFocused {
            addTag()
            closeTagField()
        }
    }

    @ViewBuilder private func origin(_ todo: Todo) -> some View {
        let creator = app.agent(todo.created_by)
        let guestName = app.agent(todo.guest_id)?.name ?? "They"
        let waiting = todo.scope == "guest"
        let shared = waiting ? "Not on a day yet. \(guestName) can see where you put it." : "\(guestName) can see this task, its notes, its day and what is said below."
        VStack(alignment: .leading, spacing: 6) {
            if let creator, !creator.isHuman {
                HStack(spacing: 6) {
                    AvatarView(agent: creator, size: 16)
                    Text("Added by \(creator.name)")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.ink2)
                }
            }
            if let rail = todo.rail { fromRail(rail) }
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

    /// On a task tied to a rail module (one an agent pointed a module at, or one kept from the rail
    /// with "Later"): the module has gone, so its buttons live on here and the owner can still act.
    /// A kept task also says whose module it was.
    @ViewBuilder private func fromRail(_ rail: TodoRail) -> some View {
        let page: [RailAction] = rail.page_id.map { [RailAction(label: "Open page", url: "/page/\($0)")] } ?? []
        // once an action has been sent to the agent, the buttons that send give way to a line saying so
        let sent = rail.sent
        let buttons = (rail.actions ?? []).filter { !($0.sends && (sent != nil || railSending != nil)) } + page
        let by = rail.kept == true ? app.agent(rail.author) : nil
        if by != nil || !buttons.isEmpty || sent != nil || railSending != nil {
            FlowRow(spacing: 6) {
                if let by {
                    HStack(spacing: 6) {
                        AvatarView(agent: by, size: 16)
                        Text("From \(by.name), kept for later")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.ink2)
                    }
                    .frame(minHeight: 32)
                    .padding(.trailing, 4)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("todos.detail.rail.from")
                }
                ForEach(Array(buttons.enumerated()), id: \.offset) { item in
                    let a = item.element
                    Button {
                        if a.sends { sendToAgent(rail, a.label) } else { app.open(a.link) }
                    } label: {
                        HStack(spacing: 4) {
                            Text(a.label)
                            if a.link.hasPrefix("http") { Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.ink3) }
                        }
                    }
                    .buttonStyle(PillStyle())
                    .accessibilityIdentifier("todos.detail.rail.action.\(item.offset)")
                }
                if let sent {
                    let name = app.agent(rail.author)?.name ?? "the agent"
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
                        Text("“\(sent.label ?? "")” sent to \(name)")
                        Text(sent.picked_up == true ? "· picked up" : "· waiting for it").fontWeight(.regular).foregroundStyle(Theme.ink3)
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.accent)
                    .frame(minHeight: 32)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("todos.detail.rail.sent")
                } else if let label = railSending {
                    Text("Sending “\(label)”")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.ink3)
                        .frame(minHeight: 32)
                }
            }
            .padding(.top, 2)
        }
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
        store.moveOptions(guest: todo.guest_id)
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

    /// A module's button that sends an action to its agent, used from the task the module became.
    private func sendToAgent(_ rail: TodoRail, _ label: String) {
        guard let moduleID = rail.id, railSending == nil else { return }
        railSending = label
        Task {
            do {
                try await app.api.send("POST", "rail/\(moduleID)/action", body: ["label": label])
                problem = nil
            } catch {
                problem = "“\(label)” was not sent. Try again."
            }
            await load()
            railSending = nil
        }
    }

    private func load() async {
        if saver.dirty { return }
        do {
            let fresh: Todo = try await app.api.get("todos/\(id)")
            take(fresh)
            problem = nil
            // Reading the task is opening it, and a rail module that pointed here has gone for
            // that: let the rail catch up.
            if !railTold {
                railTold = true
                if app.rail.contains(where: { $0.task?.id == id }) { await app.refreshRail() }
            }
        } catch is CancellationError {
            return
        } catch {
            if todo == nil { problem = error.localizedDescription }
        }
    }

    private func take(_ fresh: Todo) {
        var next = fresh
        // tags changed here and not yet saved are kept over what the server last knew
        if tagBusy > 0, let mine = todo?.tags { next.tags = mine }
        todo = next
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
        // a rail module about this task goes when it is finished, and returns if it is unticked
        await app.refreshRail()
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

    /// A day chosen in the calendar: the task goes there and stays open.
    private func pickDate(_ day: String) async {
        let wasWaiting = todo?.scope == "guest"
        withAnimation(.ssSoft) { showCalendar = false }
        guard await patch(["view": day]) != nil else { return }
        // a guest's waiting task now has a day: its module leaves the rail
        if wasWaiting { await app.refreshRail() }
        await store.refreshFolders()
    }

    private func setRepeat(_ value: String?) async {
        _ = await patch(["repeat": value ?? "none"])
    }

    private func setPlan(_ value: String?) async {
        _ = await patch(["plan": value ?? "none"])
    }

    /// The owner's agents: the ones a task can be given to.
    private var helpers: [Agent] { app.agents.filter { $0.kind == "agent" } }

    private func setAssignee(_ value: String?) async {
        _ = await patch(["assignee": value ?? "none"])
    }

    /// Goes to the task that was added to follow this one, where its date can be changed.
    private func openNext(_ next: String) async {
        titleFocused = false
        notesFocused = false
        await saver.flush()
        await commitTitle()
        store.open(next)
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
        tagFocused = false
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

/// The line of the plan the task is part of. Accent while it is part of one.
private struct TodosPartOfMenu: View {
    var lines: [TodosPlanItem]
    var chosen: String?
    var pick: (String?) -> Void

    var body: some View {
        let current = lines.first { $0.id == chosen }
        let on = current != nil
        let title = current?.title ?? "Part of"
        Menu {
            Button {
                pick(nil)
            } label: {
                if on { Text("Not in the plan") } else { Label("Not in the plan", systemImage: "checkmark") }
            }
            ForEach(lines) { line in
                // a part is set in a little under its priority
                let name = line.parent_id == nil ? line.title : "   " + line.title
                Button {
                    pick(line.id)
                } label: {
                    if line.id == chosen { Label(name, systemImage: "checkmark") } else { Text(name) }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "flag")
                Text(title.count > 28 ? String(title.prefix(27)) + "…" : title).lineLimit(1)
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(on ? Theme.accent : Theme.ink2)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(on ? Theme.accentSoft : Theme.fill, in: Capsule())
            .contentShape(Capsule())
        }
        .accessibilityLabel("Part of. Now: \(on ? title : "Not in the plan")")
        .accessibilityIdentifier("todos.detail.partOf")
    }
}

/// Who the task is given to. Accent, with the agent's face, while it is given to one.
private struct TodosGiveToMenu: View {
    var agents: [Agent]
    var chosen: String?
    var pick: (String?) -> Void

    var body: some View {
        let holder = agents.first { $0.id == chosen }
        let on = holder != nil
        Menu {
            Button {
                pick(nil)
            } label: {
                if on { Text("Nobody") } else { Label("Nobody", systemImage: "checkmark") }
            }
            ForEach(agents) { agent in
                Button {
                    pick(agent.id)
                } label: {
                    if agent.id == chosen { Label(agent.name, systemImage: "checkmark") } else { Text(agent.name) }
                }
            }
        } label: {
            HStack(spacing: 6) {
                if let holder { AvatarView(agent: holder, size: 20) } else { Image(systemName: "person.2") }
                Text(holder?.name ?? "Give to").lineLimit(1)
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(on ? Theme.accent : Theme.ink2)
            .padding(.leading, on ? 8 : 12)
            .padding(.trailing, 12)
            .frame(minHeight: 36)
            .background(on ? Theme.accentSoft : Theme.fill, in: Capsule())
            .contentShape(Capsule())
        }
        .accessibilityLabel("Give to. Now: \(holder?.name ?? "Nobody")")
        .accessibilityIdentifier("todos.detail.giveTo")
    }
}

/// Whether the task comes round again, and how often. Accent while it does.
private struct TodosRepeatMenu: View {
    var rule: String?
    var pick: (String?) -> Void

    var body: some View {
        let on = rule != nil
        let title = TodosRepeat.label(rule) ?? "Repeat"
        Menu {
            Button {
                pick(nil)
            } label: {
                if on { Text("Never") } else { Label("Never", systemImage: "checkmark") }
            }
            ForEach(TodosRepeat.options) { option in
                Button {
                    pick(option.key)
                } label: {
                    if option.key == rule { Label(option.label, systemImage: "checkmark") } else { Text(option.label) }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "repeat")
                Text(title).lineLimit(1)
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(on ? Theme.accent : Theme.ink2)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(on ? Theme.accentSoft : Theme.fill, in: Capsule())
            .contentShape(Capsule())
        }
        .accessibilityLabel("Repeat. Now: \(on ? title : "Never")")
        .accessibilityIdentifier("todos.detail.repeat")
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

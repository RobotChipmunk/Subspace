import SwiftUI
import Observation

/// What the todos screen shows: the folders, the selected folder's tasks, the bin and the open task.
/// Changes show at once and are saved behind; a failed save is put back and named in `problem`.
@MainActor
@Observable
final class TodosStore {
    static let binKey = "bin"
    /// Every task, wherever it is: a view across the lists rather than a place of its own.
    static let allKey = "all"
    /// The plan: the owner's priorities with the tasks under each. Like "All", a view across the lists.
    static let planKey = "plan"
    /// The tasks that are part of no line of the plan.
    static let noLine = "none"

    @ObservationIgnored var app: AppModel? = nil

    var folders: [TodosFolder] = []
    var today: String? = nil
    var binCount: Int = 0
    var foldersLoaded: Bool = false
    /// Every tag the tasks carry, most used first: offered when a tag is added to a task.
    var knownTags: [TodosTagCount] = []
    /// The tags the lists are narrowed to; empty shows every task. The choice stays until the
    /// owner takes it off: across lists, and on leaving this screen and coming back.
    var filter: [String] = TodosStore.keptFilter
    /// The choice, held for as long as the app runs, so a new screen starts with it.
    @ObservationIgnored private static var keptFilter: [String] = []

    /// Whether finished tasks are hidden, in every list and in the plan. Unlike the tags it is
    /// kept for good, on this device.
    var hideDone: Bool = UserDefaults.standard.bool(forKey: TodosStore.hideDoneKey)
    nonisolated static let hideDoneKey = "todos_hide_done"
    /// The tasks ticked a moment ago. While finished tasks are hidden, one that has just been
    /// ticked stays where it is, shown as done, for three seconds: long enough to see it land and
    /// to untick a slip. Then it goes with the rest.
    var lingering: Set<String> = []
    @ObservationIgnored private var lingerTasks: [String: Task<Void, Never>] = [:]
    static let lingerSeconds: Double = 3

    /// The plan, in the owner's order: each priority followed by its parts.
    var plan: [TodosPlanItem] = []
    /// The line of the plan the lists are narrowed to, kept the way the tags are.
    var focus: String? = TodosStore.keptFocus
    @ObservationIgnored private static var keptFocus: String? = nil
    /// The lines of the plan that are open, and the tasks of each once they have arrived.
    var openLines: Set<String> = []
    var planTasks: [String: [Todo]] = [:]
    /// The task being carried in the plan, and the line it is part of.
    @ObservationIgnored var planDragging: (id: String, line: String)? = nil

    /// The selected folder's key, or `binKey`.
    var view: String = "today"
    /// The selected folder's tasks; nil until they have arrived.
    var rows: [Todo]? = nil

    var bin: [TodosBinItem]? = nil
    var keepDays: Int = 15

    /// The task whose detail is open.
    var openID: String? = nil
    var problem: String? = nil
    var draggingID: String? = nil
    /// The section of this list (another day of the week) the carried row is held over.
    var targetGroup: String? = nil
    /// The section of a list with sections whose own add field is open, if any.
    var addingSection: String? = nil

    /// Tasks typed here that the server has not answered for yet.
    @ObservationIgnored private var unsaved: [Todo] = []
    /// A task keeps the identity it was first drawn with, so it does not redraw when its real id arrives.
    @ObservationIgnored private var keys: [String: String] = [:]
    /// Goes up with every change made here, so a refresh that started before it is thrown away.
    @ObservationIgnored private var generation: Int = 0
    @ObservationIgnored private var dragAt: Date? = nil
    @ObservationIgnored private var tempCount: Int = 0

    // MARK: Reading

    var isBin: Bool { view == Self.binKey }

    var isPlan: Bool { view == Self.planKey }

    var folder: TodosFolder? {
        let key = view
        return folders.first { $0.key == key }
    }

    var isAll: Bool { view == Self.allKey }

    var isMulti: Bool { view == "week" || view == "next_week" || view == "weekend" || view == "later" || isAll }

    /// This week's Monday: the date a task set for the week (not a day) carries.
    private var thisMonday: String? {
        guard let today else { return nil }
        return TodosDates.monday(today)
    }

    /// A list without sections has one add field at its end. A list with sections adds through
    /// each section instead ("Later" only through its days: a task gets there by being given a date).
    var canAdd: Bool { !isMulti }

    /// Whether a section can be given a task, by carrying or typing: not a day already past (it
    /// would only roll forward again), and not a whole week unless it is this week or the next in
    /// "All" (a week further off has no list of its own to add to). In "All" the backlog can; what
    /// waits for a day cannot (those tasks come from someone else).
    func takes(_ key: String) -> Bool {
        guard isMulti, !key.isEmpty else { return false }
        if key == "any" || key == "backlog" { return true }
        if key == "waiting" { return false }
        if key.hasSuffix("w") {
            guard isAll, let monday = thisMonday, let next = TodosDates.adding(7, to: monday) else { return false }
            return String(key.dropLast()) <= next
        }
        guard let today else { return true }
        return key >= today
    }

    func rowKey(_ id: String) -> String {
        keys[id] ?? id
    }

    /// The section a task is filed under in a list with sections; empty in a list without. A day
    /// is its date; a week is its Monday followed by "w" ("Later" and "All", which span many
    /// weeks) or "any" (a week's own list). "All" also has the backlog and what waits for a day.
    func groupKey(_ todo: Todo) -> String {
        if !isMulti { return "" }
        if isAll && todo.scope == "backlog" { return "backlog" }
        if isAll && todo.scope == "guest" { return "waiting" }
        if todo.scope == "week" { return (view == "later" || isAll) ? (todo.date ?? "") + "w" : "any" }
        return todo.date ?? "any"
    }

    /// Where a section sorts in "All": today, the week it is in, the days and weeks after, then
    /// the backlog and what still waits for a day.
    private func rank(_ key: String) -> String {
        if key == "backlog" { return "z1" }
        if key == "waiting" { return "z2" }
        if !key.hasSuffix("w") { return key + "b" }
        let week = String(key.dropLast())
        // this week's own section follows today; a later week comes before its days
        if let monday = thisMonday, week <= monday { return (today ?? week) + "c" }
        return week + "a"
    }

    /// The selected list's tasks, narrowed to those carrying every one of the chosen tags when
    /// there are any.
    var shownRows: [Todo]? {
        guard let rows else { return nil }
        if filter.isEmpty && focus == nil { return rows }
        let chosen = filter
        let scope: Set<String>? = focus.map { planScope($0) }
        return rows.filter { row in
            let tags = row.tags ?? []
            guard chosen.allSatisfy({ tags.contains($0) }) else { return false }
            guard let scope else { return true }
            guard let line = row.plan_id else { return false }
            return scope.contains(line)
        }
    }

    /// A line of the plan and, for a priority, its parts: the lines whose tasks count as under it.
    func planScope(_ id: String) -> Set<String> {
        var out: Set<String> = [id]
        for item in plan where item.parent_id == id { out.insert(item.id) }
        return out
    }

    /// The lines of the plan this list has tasks for (a priority counts its parts' tasks), and
    /// the chosen one whatever it has, so a choice can always be taken off.
    var viewLines: [TodosPlanItem] {
        var used: Set<String> = []
        for row in rows ?? [] {
            if let line = row.plan_id { used.insert(line) }
        }
        let chosen = focus
        return plan.filter { item in
            item.id == chosen || !planScope(item.id).isDisjoint(with: used)
        }
    }

    var focusedLine: TodosPlanItem? {
        guard let focus else { return nil }
        return plan.first { $0.id == focus }
    }

    /// Narrows the lists to one line of the plan, or takes that choice off.
    func setFocus(_ id: String?) {
        withAnimation(.ssSoft) { focus = id }
        Self.keptFocus = id
    }

    /// The tags on this list's tasks, most used first, and whichever are chosen even when no
    /// task here carries them (so a choice can always be taken off).
    var viewTags: [TodosTagCount] {
        var order: [String] = []
        var counts: [String: Int] = [:]
        for row in rows ?? [] {
            for tag in row.tags ?? [] {
                if counts[tag] == nil {
                    counts[tag] = 0
                    order.append(tag)
                }
                if !row.done { counts[tag] = (counts[tag] ?? 0) + 1 }
            }
        }
        for tag in filter where counts[tag] == nil {
            counts[tag] = 0
            order.append(tag)
        }
        var out: [TodosTagCount] = []
        for tag in order {
            out.append(TodosTagCount(tag: tag, count: counts[tag] ?? 0))
        }
        return out.sorted { a, b in
            if a.count != b.count { return a.count > b.count }
            return a.tag.lowercased() < b.tag.lowercased()
        }
    }

    /// Chooses a tag to narrow the list to, or takes that choice off.
    func toggleFilter(_ tag: String) {
        withAnimation(.ssSoft) {
            if let index = filter.firstIndex(of: tag) {
                filter.remove(at: index)
            } else {
                filter.append(tag)
            }
        }
        Self.keptFilter = filter
    }

    func clearFilter() {
        withAnimation(.ssSoft) { filter = [] }
        Self.keptFilter = []
    }

    /// Those of some tasks that are in view: all of them, or with finished tasks hidden the
    /// unfinished and whichever were ticked a moment ago.
    func seen(_ rows: [Todo]) -> [Todo] {
        guard hideDone else { return rows }
        let held = lingering
        return rows.filter { !$0.done || held.contains($0.id) }
    }

    /// The selected list's tasks that are in view.
    var seenRows: [Todo]? { shownRows.map { seen($0) } }

    func setHideDone(_ on: Bool) {
        withAnimation(.ssSoft) { hideDone = on }
        UserDefaults.standard.set(on, forKey: Self.hideDoneKey)
    }

    /// Keeps a task that was just ticked in view for a moment; see `lingering`.
    private func linger(_ id: String) {
        lingerTasks[id]?.cancel()
        lingering.insert(id)
        lingerTasks[id] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.lingerSeconds))
            guard !Task.isCancelled, let self else { return }
            self.lingerTasks[id] = nil
            withAnimation(.ssSoft) { _ = self.lingering.remove(id) }
        }
    }

    /// The task was unticked, or the tick could not be saved: it is no longer on its way out.
    private func unlinger(_ id: String) {
        lingerTasks[id]?.cancel()
        lingerTasks[id] = nil
        lingering.remove(id)
    }

    var groups: [TodosGroup] {
        guard let rows = seenRows else { return [] }
        var order: [String] = []
        var map: [String: [Todo]] = [:]
        for row in rows {
            let key = groupKey(row)
            if map[key] == nil {
                order.append(key)
                map[key] = []
            }
            map[key]?.append(row)
        }
        if isMulti && !isAll && view != "weekend" && view != "later" && map["any"] == nil {
            map["any"] = []
            order.append("any")
        }
        // every day still to come has its section, empty or not, so a task can be carried onto it
        for day in daySections where map[day] == nil {
            map[day] = []
            order.append(day)
        }
        // "All" always has today, so there is somewhere to add a task
        if isAll, let today, map[today] == nil {
            map[today] = []
            order.append(today)
        }
        let sorted: [String]
        if isAll {
            sorted = order.sorted { a, b in rank(a) < rank(b) }
        } else {
            sorted = order.sorted { a, b in
                if a == "any" { return b != "any" }
                if b == "any" { return false }
                return a < b
            }
        }
        var out: [TodosGroup] = []
        for key in sorted {
            out.append(TodosGroup(key: key, items: map[key] ?? []))
        }
        return out
    }

    /// The days a week list always shows as sections, with or without tasks: today to Sunday in
    /// "This week", Monday to Sunday in "Next week", what is left of Saturday and Sunday in "Weekend".
    private var daySections: [String] {
        guard view == "week" || view == "next_week" || view == "weekend" else { return [] }
        guard let today, let monday = TodosDates.monday(today), let done = TodosDates.days(from: monday, to: today) else { return [] }
        let from = view == "next_week" ? 7 : (view == "weekend" ? max(5, done) : done)
        let to = view == "next_week" ? 13 : 6
        guard from <= to else { return [] }
        var out: [String] = []
        for offset in from...to {
            if let day = TodosDates.adding(offset, to: monday) { out.append(day) }
        }
        return out
    }

    func groupTitle(_ key: String) -> String {
        if key == "any" { return "Any day" }
        if key == "backlog" { return "Backlog" }
        if key == "waiting" { return "Waiting for a day" }
        if key == today { return "Today" }
        if isAll {
            // named the way a task's date pill names it: Tomorrow, Thursday, Thu, Dec 17, Next week
            let week = key.hasSuffix("w")
            let date = week ? String(key.dropLast()) : key
            let label = TodosDates.placeLabel(scope: week ? "week" : "day", date: date, today: today)
            return label.isEmpty ? TodosDates.longDate(date) : label
        }
        if view == "later" {
            return key.hasSuffix("w") ? "Week of " + TodosDates.monthDay(String(key.dropLast())) : TodosDates.longDate(key)
        }
        return TodosDates.dayName(key)
    }

    /// The line under the list's title.
    var listSub: String? {
        // narrowed to some tags or to a line of the plan, it counts what is left
        if filter.isEmpty && focus == nil {
            if view == "today", let today { return TodosDates.longDate(today) }
            if TodosDates.isDate(view) { return TodosDates.longDate(view) }
            if view == "backlog" { return "No date. Pull from here when you have room." }
            if view == "later" { return "Dated beyond next week." }
            if folder?.guest != nil { return "Tasks stay here after you give them a day." }
        }
        guard let rows = shownRows else { return nil }
        let open = rows.filter { !$0.done }.count
        if open > 0 { return "\(open) to do" }
        return rows.isEmpty ? nil : "All done"
    }

    /// The folder a task lives in, as well as it can be told from here.
    func folderKey(for todo: Todo) -> String? {
        switch todo.scope {
        case "guest":
            guard let guest = todo.guest_id else { return nil }
            return "guest:" + guest
        case "backlog":
            return "backlog"
        case "week":
            guard let today, let date = todo.date, let monday = TodosDates.monday(today) else { return "week" }
            if date == monday { return "week" }
            return date == TodosDates.adding(7, to: monday) ? "next_week" : "later"
        default:
            guard let date = todo.date else { return nil }
            if date == today { return "today" }
            if folders.contains(where: { $0.key == date }) { return date }
            guard let today, let monday = TodosDates.monday(today) else { return nil }
            let saturday = TodosDates.adding(5, to: monday)
            let sunday = TodosDates.adding(6, to: monday)
            if date == saturday || date == sunday { return "weekend" }
            if TodosDates.monday(date) == monday { return "week" }
            // past the end of next week
            if let last = TodosDates.adding(13, to: monday), date > last { return "later" }
            return "next_week"
        }
    }

    // MARK: Moving around

    func select(_ key: String) {
        if key == view && openID == nil { return }
        let changed = key != view
        generation += 1
        withAnimation(.ssSpring) {
            openID = nil
            if changed {
                view = key
                addingSection = nil
                rows = nil
                unsaved = []
            }
        }
        Task { await refreshCurrent() }
    }

    func open(_ id: String) {
        withAnimation(.ssSoft) { openID = id }
    }

    /// Leaves the open task and brings the lists up to date, as the web page does on the way out.
    func closeDetail() {
        withAnimation(.ssSoft) { openID = nil }
        generation += 1
        Task {
            await refreshCurrent()
            await refreshFolders()
        }
    }

    /// Opens a task asked for from elsewhere (the rail) and selects the folder it is in.
    func openPending(_ id: String) async {
        open(id)
        guard let api = app?.api else { return }
        guard let todo: Todo = try? await api.get("todos/\(id)") else { return }
        if !foldersLoaded { await refreshFolders() }
        guard openID == id, let key = folderKey(for: todo), key != view else { return }
        guard folders.contains(where: { $0.key == key }) else { return }
        generation += 1
        view = key
        rows = nil
        unsaved = []
        await refreshList()
    }

    // MARK: Refreshing

    func refreshAll() async {
        await refreshFolders()
        await refreshCurrent()
    }

    func refreshCurrent() async {
        if isBin {
            await refreshBin()
        } else if isPlan {
            await refreshPlan()
        } else {
            await refreshList()
        }
    }

    func refreshFolders() async {
        guard let api = app?.api else { return }
        guard let reply: TodosFoldersResponse = try? await api.get("todos/folders") else { return }
        withAnimation(.ssSoft) {
            folders = reply.folders
            today = reply.today
            binCount = reply.bin
            knownTags = reply.tags ?? []
            plan = reply.plan ?? []
            foldersLoaded = true
        }
        // a line that has left the plan cannot go on narrowing the lists
        if let chosen = focus, !plan.contains(where: { $0.id == chosen }) { setFocus(nil) }
        // If the day rolls over a dated folder may be gone; the bin's entry goes once it is empty.
        let stranded = isBin ? reply.bin == 0 : (isPlan ? false : folder == nil)
        if stranded {
            generation += 1
            withAnimation(.ssSpring) {
                view = "today"
                rows = nil
                unsaved = []
            }
            await refreshList()
        }
    }

    func refreshList() async {
        guard let api = app?.api, !isBin, !isPlan else { return }
        // a row is in the air: leave the order alone
        if let at = dragAt, Date().timeIntervalSince(at) < 8 { return }
        let asked = view
        let started = generation
        do {
            let reply: TodosListResponse = try await api.get("todos?view=" + q(asked))
            guard asked == view, started == generation else { return }
            let waiting = unsaved.filter { temp in !reply.todos.contains(where: { $0.id == temp.id }) }
            let next = reply.todos + waiting
            if rows == nil {
                rows = next
            } else if rows != next {
                withAnimation(.ssSoft) { rows = next }
            }
            if let day = reply.today { today = day }
        } catch is CancellationError {
            return
        } catch {
            if rows == nil { problem = error.localizedDescription }
        }
    }

    func refreshBin() async {
        guard let api = app?.api else { return }
        guard let reply: TodosBinResponse = try? await api.get("todos/bin") else { return }
        let days = reply.keep_days ?? 15
        withAnimation(.ssSoft) {
            bin = reply.todos
            keepDays = days
        }
    }

    // MARK: Changing tasks

    private func setDone(_ id: String, _ value: Bool) {
        guard var list = rows, let index = list.firstIndex(where: { $0.id == id }) else { return }
        list[index].done = value
        rows = list
    }

    private func removeRow(_ id: String) {
        guard var list = rows else { return }
        list.removeAll { $0.id == id }
        rows = list
    }

    private func removeBinned(_ id: String) {
        guard var list = bin else { return }
        list.removeAll { $0.id == id }
        bin = list
    }

    func toggle(_ id: String) async {
        guard let api = app?.api, !id.hasPrefix("new_") else { return }
        guard let was = rows?.first(where: { $0.id == id })?.done else { return }
        generation += 1
        if was { unlinger(id) } else { linger(id) }
        withAnimation(.ssSpring) { setDone(id, !was) }
        do {
            try await api.send("PATCH", "todos/\(id)", body: ["done": !was])
            problem = nil
        } catch {
            unlinger(id)
            withAnimation(.ssSpring) { setDone(id, was) }
            problem = error.localizedDescription
        }
        await refreshList()
        await refreshFolders()
        // a rail module about this task goes when it is finished, and returns if it is unticked
        await app?.refreshRail()
    }

    /// The list a section adds to and takes carried tasks into: the day itself, or the list the
    /// section stands for ("Any day" is the week's own list).
    func listTarget(for section: String) -> String {
        if TodosDates.isDate(section) { return section }
        if section == "backlog" { return "backlog" }
        if section.hasSuffix("w") {
            if let monday = thisMonday, String(section.dropLast()) <= monday { return "week" }
            return "next_week"
        }
        return view
    }

    /// Where a task sent to that list will be filed, so it shows in its place before the server answers.
    private func spot(for target: String) -> (scope: String, date: String?) {
        if target == "backlog" { return ("backlog", nil) }
        if target.hasPrefix("guest:") { return ("guest", nil) }
        if target == "week" || target == "next_week" {
            guard let monday = thisMonday else { return ("week", nil) }
            let date: String? = target == "week" ? monday : TodosDates.adding(7, to: monday)
            return ("week", date)
        }
        if TodosDates.isDate(target) { return ("day", target) }
        if target == "weekend", let today { return ("day", TodosDates.weekendDay(today)) }
        return ("day", today)
    }

    /// Adds a task to the selected folder, or to one of its sections: a section that is a day adds
    /// to that day, "Any day" to the list itself. False means it could not be saved and the words
    /// should go back in the box.
    func add(_ title: String, to section: String = "") async -> Bool {
        guard let api = app?.api, !isBin else { return false }
        let list = view
        let target = listTarget(for: section)
        // the same place the server will file it, so it does not jump between groups when saved
        let landing = spot(for: target)
        // while the list is narrowed to some tags a new task takes them, or it would vanish as it was added
        let tags = filter
        tempCount += 1
        let tempID = "new_\(Int(Date().timeIntervalSince1970 * 1000))_\(tempCount)"
        var temp = Todo(
            id: tempID, title: title, notes: nil, scope: landing.scope, date: landing.date, position: nil, done: false, done_at: nil,
            ai_unseen: false, created_by: nil, guest_id: nil, created_at: nil, updated_at: nil, has_notes: false
        )
        temp.tags = tags
        var body: [String: Any] = ["title": title, "view": target]
        if !tags.isEmpty { body["tags"] = tags }
        // and the line of the plan it is narrowed to
        if let line = focusedLine {
            temp.plan_id = line.id
            temp.plan = line.title
            body["plan"] = line.id
        }
        generation += 1
        unsaved.append(temp)
        withAnimation(.ssSoft) {
            if rows == nil {
                rows = [temp]
            } else {
                rows?.append(temp)
            }
        }
        do {
            var saved: Todo = try await api.send("POST", "todos", body: body)
            saved.has_notes = false
            unsaved.removeAll { $0.id == tempID }
            problem = nil
            if view == list, let index = rows?.firstIndex(where: { $0.id == tempID }) {
                keys[saved.id] = tempID
                rows?[index] = saved
            }
            generation += 1
            await refreshList()
            await refreshFolders()
            return true
        } catch {
            unsaved.removeAll { $0.id == tempID }
            withAnimation(.ssSoft) { removeRow(tempID) }
            problem = error.localizedDescription
            return false
        }
    }

    /// Deleting sends a task to the bin; it leaves the list at once.
    func delete(_ id: String) async {
        guard let api = app?.api, !id.hasPrefix("new_") else { return }
        generation += 1
        withAnimation(.ssSoft) { removeRow(id) }
        do {
            try await api.send("DELETE", "todos/\(id)")
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
        await refreshList()
        await refreshFolders()
    }

    // MARK: Reordering

    func beginDrag(_ id: String) {
        draggingID = id
        dragAt = Date()
        targetGroup = nil
    }

    /// Whether the row being carried can be put on this section of the list it is in. The same
    /// rule as the web: not its own section, not a whole week in "Later" (no single day to land
    /// on) and not a day already past (it would only roll forward again).
    func acceptsGroup(_ key: String) -> Bool {
        guard takes(key), let id = draggingID, !id.hasPrefix("new_") else { return false }
        guard let row = (rows ?? []).first(where: { $0.id == id }), groupKey(row) != key else { return false }
        return true
    }

    /// The lifted row has come over a section: if it can go there, that section lights up.
    func dragOverGroup(_ key: String) {
        let next: String? = acceptsGroup(key) ? key : nil
        if next != nil { dragAt = Date() }
        if next != targetGroup {
            withAnimation(.ssSpring) { targetGroup = next }
        }
    }

    /// The lifted row has come over another row of the same group: it takes that place.
    func dragEntered(_ target: String) {
        guard let moving = draggingID, moving != target, var list = rows else { return }
        guard let from = list.firstIndex(where: { $0.id == moving }), let to = list.firstIndex(where: { $0.id == target }) else { return }
        // a row of another section: the carried row is over that section, not trading places
        guard groupKey(list[from]) == groupKey(list[to]) else {
            dragOverGroup(groupKey(list[to]))
            return
        }
        if targetGroup != nil {
            withAnimation(.ssSpring) { targetGroup = nil }
        }
        dragAt = Date()
        let item = list.remove(at: from)
        list.insert(item, at: to)
        withAnimation(.ssSoft) { rows = list }
    }

    /// Whether the row being carried can be put on this list. The same rule as the web: not the
    /// list it is on, not "This week" or "Later", and a guest's list only for that guest's own task.
    func accepts(_ key: String) -> Bool {
        guard let id = draggingID, !id.hasPrefix("new_"), key != view, key != "week", key != "later", key != Self.allKey else { return false }
        guard let row = (rows ?? []).first(where: { $0.id == id }), let folder = folders.first(where: { $0.key == key }) else { return false }
        return folder.guest == nil || folder.guest == row.guest_id
    }

    /// The carried row was let go over a list in the folders: it moves there. It leaves this list
    /// at once and is saved behind; if that fails it comes back. A person's list keeps its tasks
    /// whatever day they are given, so there the row stays and only its day changes.
    func dropOnFolder(_ key: String) {
        guard accepts(key), let id = draggingID, let api = app?.api else {
            endDrag()
            return
        }
        let before = rows
        let wasWaiting = (rows ?? []).first(where: { $0.id == id })?.scope == "guest"
        // "All" shows every list, so there too the row stays and only its place changes
        let stays = folder?.guest != nil || isAll
        draggingID = nil
        dragAt = nil
        targetGroup = nil
        generation += 1
        if !stays {
            withAnimation(.ssSoft) { rows = (rows ?? []).filter { $0.id != id } }
        }
        Task {
            do {
                try await api.send("PATCH", "todos/\(id)", body: ["view": key])
                problem = nil
                // a guest's waiting task now has a day: its module leaves the rail
                if wasWaiting { await app?.refreshRail() }
            } catch {
                withAnimation(.ssSoft) { rows = before }
                problem = error.localizedDescription
            }
            if stays { await refreshList() }
            await refreshFolders()
        }
    }

    /// The carried row was let go over another section: it joins that day (or "Any day") at the
    /// end, at once, and is saved behind; if that fails it goes back.
    private func moveToGroup(_ key: String) {
        guard let id = draggingID, let api = app?.api, var list = rows, let index = list.firstIndex(where: { $0.id == id }) else {
            draggingID = nil
            dragAt = nil
            return
        }
        let before = rows
        let target = listTarget(for: key)
        var row = list.remove(at: index)
        let wasWaiting = row.scope == "guest"
        if key == "any" {
            // "Any day" in a week's own list keeps the date the week's other tasks carry
            row.scope = "week"
            row.date = list.first(where: { $0.scope == "week" })?.date ?? row.date
        } else {
            let landing = spot(for: target)
            row.scope = landing.scope
            row.date = landing.date
        }
        list.append(row)
        draggingID = nil
        dragAt = nil
        generation += 1
        withAnimation(.ssSoft) { rows = list }
        Task {
            do {
                try await api.send("PATCH", "todos/\(id)", body: ["view": target])
                problem = nil
                // a guest's waiting task now has a day: its module leaves the rail
                if wasWaiting { await app?.refreshRail() }
            } catch {
                withAnimation(.ssSoft) { rows = before }
                problem = error.localizedDescription
            }
            await refreshList()
            await refreshFolders()
        }
    }

    func endDrag() {
        guard draggingID != nil else { return }
        if let key = targetGroup {
            withAnimation(.ssSpring) { targetGroup = nil }
            if acceptsGroup(key) {
                moveToGroup(key)
                return
            }
        }
        draggingID = nil
        dragAt = nil
        generation += 1
        let ids: [String] = (rows ?? []).map { $0.id }.filter { !$0.hasPrefix("new_") }
        guard let api = app?.api, !ids.isEmpty else { return }
        Task {
            do {
                try await api.send("POST", "todos/reorder", body: ["ids": ids])
                problem = nil
            } catch {
                problem = error.localizedDescription
            }
            await refreshList()
        }
    }

    // MARK: The plan

    /// The tasks that are part of one line itself, soonest first ("none": those part of nothing).
    /// A priority's own list holds only its own tasks; those of its parts are under the parts.
    func refreshLine(_ key: String) async {
        guard let api = app?.api else { return }
        guard let reply: TodosListResponse = try? await api.get("todos?view=all&plan=" + q(key)) else { return }
        let mine = reply.todos.filter { todo in
            key == Self.noLine ? todo.plan_id == nil : todo.plan_id == key
        }
        if planTasks[key] != mine {
            withAnimation(.ssSoft) { planTasks[key] = mine }
        }
        if let day = reply.today { today = day }
    }

    func refreshPlan() async {
        for key in openLines.sorted() {
            await refreshLine(key)
        }
    }

    private func planChanged() async {
        await refreshFolders()
        await refreshPlan()
    }

    func toggleLine(_ key: String) {
        if openLines.contains(key) {
            withAnimation(.ssSoft) { _ = openLines.remove(key) }
        } else {
            withAnimation(.ssSoft) { _ = openLines.insert(key) }
            Task { await refreshLine(key) }
        }
    }

    /// Adds a priority, or with `parent` a part of one. False means it could not be saved.
    func addLine(_ title: String, parent: String? = nil) async -> Bool {
        guard let api = app?.api else { return false }
        var body: [String: Any] = ["title": title]
        if let parent { body["parent"] = parent }
        do {
            try await api.send("POST", "plan", body: body)
            problem = nil
            await refreshFolders()
            return true
        } catch {
            problem = error.localizedDescription
            return false
        }
    }

    func renameLine(_ id: String, to title: String) async {
        guard let api = app?.api else { return }
        do {
            try await api.send("PATCH", "plan/\(id)", body: ["title": title])
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
        await refreshFolders()
    }

    /// Takes a line out of the plan, and a priority's parts with it. Its tasks stay in their lists.
    func removeLine(_ id: String) async {
        guard let api = app?.api else { return }
        do {
            try await api.send("DELETE", "plan/\(id)")
            problem = nil
            for key in planScope(id) {
                openLines.remove(key)
                planTasks[key] = nil
            }
        } catch {
            problem = error.localizedDescription
        }
        await planChanged()
    }

    /// A task typed under a line: planning is not scheduling, so it waits in the backlog.
    func addPlanTask(_ title: String, to line: String) async -> Bool {
        guard let api = app?.api else { return false }
        do {
            try await api.send("POST", "todos", body: ["title": title, "view": "backlog", "plan": line])
            problem = nil
            // the line opens, so the new task is seen under it
            if !openLines.contains(line) {
                withAnimation(.ssSoft) { _ = openLines.insert(line) }
            }
            await planChanged()
            return true
        } catch {
            problem = error.localizedDescription
            return false
        }
    }

    func togglePlanTask(_ id: String, in line: String) async {
        guard let api = app?.api, var list = planTasks[line], let index = list.firstIndex(where: { $0.id == id }) else { return }
        let was = list[index].done
        list[index].done = !was
        if was { unlinger(id) } else { linger(id) }
        withAnimation(.ssSpring) { planTasks[line] = list }
        do {
            try await api.send("PATCH", "todos/\(id)", body: ["done": !was])
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
        await planChanged()
        await app?.refreshRail()
    }

    /// Sends a task under a line to another list (today, the backlog and so on).
    func movePlanTask(_ id: String, to key: String) async {
        guard let api = app?.api else { return }
        do {
            try await api.send("PATCH", "todos/\(id)", body: ["view": key])
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
        await planChanged()
    }

    /// Makes a task part of another line, or of none. It leaves the line it was under at once.
    func setLine(_ id: String, from line: String, to target: String?) async {
        guard let api = app?.api, (target ?? Self.noLine) != line else { return }
        if var list = planTasks[line] {
            list.removeAll { $0.id == id }
            withAnimation(.ssSoft) { planTasks[line] = list }
        }
        do {
            try await api.send("PATCH", "todos/\(id)", body: ["plan": target ?? "none"])
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
        await planChanged()
    }

    /// The carried task was let go over a line of the plan.
    func dropOnLine(_ key: String) {
        guard let carried = planDragging else { return }
        planDragging = nil
        guard carried.line != key else { return }
        Task { await setLine(carried.id, from: carried.line, to: key == Self.noLine ? nil : key) }
    }

    /// The lists a task can be sent to from a menu: the same choices as the web's "Move to".
    func moveOptions(guest: String?) -> [TodosFolder] {
        folders.filter { folder in
            folder.key != "week" && folder.key != "later" && folder.key != Self.allKey && (folder.guest == nil || folder.guest == guest)
        }
    }

    // MARK: Recently deleted

    func restore(_ id: String) async {
        guard let api = app?.api else { return }
        withAnimation(.ssSoft) { removeBinned(id) }
        do {
            try await api.send("POST", "todos/\(id)/restore")
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
        await refreshBin()
        await refreshFolders()
    }

    func deleteForever(_ id: String) async {
        guard let api = app?.api else { return }
        withAnimation(.ssSoft) { removeBinned(id) }
        do {
            try await api.send("DELETE", "todos/\(id)?forever=1")
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
        await refreshBin()
        await refreshFolders()
    }
}

/// Saves text a moment after typing stops, one save at a time, the way `useSaver` does on the web.
/// A failed save leaves the text waiting; the next keystroke, or leaving, tries again.
@MainActor
final class TodosSaver {
    var save: ((String) async throws -> Void)? = nil

    private var latest: String? = nil
    private var timer: Task<Void, Never>? = nil
    private var running: Task<Void, Never>? = nil

    /// True while something typed here has not reached the server.
    var dirty: Bool { latest != nil }

    func push(_ text: String) {
        latest = text
        timer?.cancel()
        timer = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            if Task.isCancelled { return }
            self?.timer = nil
            await self?.flush()
        }
    }

    func flush() async {
        timer?.cancel()
        timer = nil
        if running == nil {
            running = Task { [weak self] in
                await self?.drain()
            }
        }
        if let current = running {
            await current.value
        }
    }

    private func drain() async {
        while let text = latest {
            guard let save else { break }
            do {
                try await save(text)
            } catch {
                break
            }
            if latest == text { latest = nil }
        }
        running = nil
    }
}

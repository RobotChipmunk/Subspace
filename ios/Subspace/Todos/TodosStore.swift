import SwiftUI
import Observation

/// What the todos screen shows: the folders, the selected folder's tasks, the bin and the open task.
/// Changes show at once and are saved behind; a failed save is put back and named in `problem`.
@MainActor
@Observable
final class TodosStore {
    static let binKey = "bin"

    @ObservationIgnored var app: AppModel? = nil

    var folders: [TodosFolder] = []
    var today: String? = nil
    var binCount: Int = 0
    var foldersLoaded: Bool = false

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

    var folder: TodosFolder? {
        let key = view
        return folders.first { $0.key == key }
    }

    private var isMulti: Bool { view == "week" || view == "next_week" || view == "weekend" }

    func rowKey(_ id: String) -> String {
        keys[id] ?? id
    }

    func groupKey(_ todo: Todo) -> String {
        if !isMulti { return "" }
        if todo.scope == "week" { return "any" }
        return todo.date ?? "any"
    }

    var groups: [TodosGroup] {
        guard let rows else { return [] }
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
        if isMulti && view != "weekend" && map["any"] == nil {
            map["any"] = []
            order.append("any")
        }
        let sorted = order.sorted { a, b in
            if a == "any" { return b != "any" }
            if b == "any" { return false }
            return a < b
        }
        var out: [TodosGroup] = []
        for key in sorted {
            out.append(TodosGroup(key: key, items: map[key] ?? []))
        }
        return out
    }

    func groupTitle(_ key: String) -> String {
        if key == "any" { return "Any day" }
        if key == today { return "Today" }
        return TodosDates.dayName(key)
    }

    /// The line under the list's title.
    var listSub: String? {
        if view == "today", let today { return TodosDates.longDate(today) }
        if TodosDates.isDate(view) { return TodosDates.longDate(view) }
        if view == "backlog" { return "No date. Pull from here when you have room." }
        if folder?.guest != nil { return "Waiting for a day. Open one and move it when you are ready." }
        guard let rows else { return nil }
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
            guard let today, let date = todo.date else { return "week" }
            return TodosDates.monday(today) == date ? "week" : "next_week"
        default:
            guard let date = todo.date else { return nil }
            if date == today { return "today" }
            if folders.contains(where: { $0.key == date }) { return date }
            guard let today, let monday = TodosDates.monday(today) else { return nil }
            let saturday = TodosDates.adding(5, to: monday)
            let sunday = TodosDates.adding(6, to: monday)
            if date == saturday || date == sunday { return "weekend" }
            return TodosDates.monday(date) == monday ? "week" : "next_week"
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
            foldersLoaded = true
        }
        // If the day rolls over a dated folder may be gone; the bin's entry goes once it is empty.
        let stranded = isBin ? reply.bin == 0 : folder == nil
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
        guard let api = app?.api, !isBin else { return }
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
        withAnimation(.ssSpring) { setDone(id, !was) }
        do {
            try await api.send("PATCH", "todos/\(id)", body: ["done": !was])
            problem = nil
        } catch {
            withAnimation(.ssSpring) { setDone(id, was) }
            problem = error.localizedDescription
        }
        await refreshList()
        await refreshFolders()
    }

    /// Adds a task to the selected folder. False means it could not be saved and the words should go back in the box.
    func add(_ title: String) async -> Bool {
        guard let api = app?.api, !isBin else { return false }
        let target = view
        // the same place the server will file it, so it does not jump between groups when saved
        var day: String? = nil
        if TodosDates.isDate(target) {
            day = target
        } else if target == "today" {
            day = today
        } else if target == "weekend", let today {
            day = TodosDates.weekendDay(today)
        }
        var scope = "week"
        if target == "backlog" {
            scope = "backlog"
        } else if target.hasPrefix("guest:") {
            scope = "guest"
        } else if day != nil {
            scope = "day"
        }
        tempCount += 1
        let tempID = "new_\(Int(Date().timeIntervalSince1970 * 1000))_\(tempCount)"
        let temp = Todo(
            id: tempID, title: title, notes: nil, scope: scope, date: day, position: nil, done: false, done_at: nil,
            ai_unseen: false, created_by: nil, guest_id: nil, created_at: nil, updated_at: nil, has_notes: false
        )
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
            var saved: Todo = try await api.send("POST", "todos", body: ["title": title, "view": target])
            saved.has_notes = false
            unsaved.removeAll { $0.id == tempID }
            problem = nil
            if view == target, let index = rows?.firstIndex(where: { $0.id == tempID }) {
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
    }

    /// The lifted row has come over another row of the same group: it takes that place.
    func dragEntered(_ target: String) {
        guard let moving = draggingID, moving != target, var list = rows else { return }
        guard let from = list.firstIndex(where: { $0.id == moving }), let to = list.firstIndex(where: { $0.id == target }) else { return }
        guard groupKey(list[from]) == groupKey(list[to]) else { return }
        dragAt = Date()
        let item = list.remove(at: from)
        list.insert(item, at: to)
        withAnimation(.ssSoft) { rows = list }
    }

    /// Whether the row being carried can be put on this list. The same rule as the web: not the
    /// list it is on, not "This week", and a guest's list only for that guest's own task.
    func accepts(_ key: String) -> Bool {
        guard let id = draggingID, !id.hasPrefix("new_"), key != view, key != "week" else { return false }
        guard let row = (rows ?? []).first(where: { $0.id == id }), let folder = folders.first(where: { $0.key == key }) else { return false }
        return folder.guest == nil || folder.guest == row.guest_id
    }

    /// The carried row was let go over a list in the folders: it moves there. It leaves this list
    /// at once and is saved behind; if that fails it comes back.
    func dropOnFolder(_ key: String) {
        guard accepts(key), let id = draggingID, let api = app?.api else {
            endDrag()
            return
        }
        let before = rows
        let wasWaiting = (rows ?? []).first(where: { $0.id == id })?.scope == "guest"
        draggingID = nil
        dragAt = nil
        generation += 1
        withAnimation(.ssSoft) { rows = (rows ?? []).filter { $0.id != id } }
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
            await refreshFolders()
        }
    }

    func endDrag() {
        guard draggingID != nil else { return }
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

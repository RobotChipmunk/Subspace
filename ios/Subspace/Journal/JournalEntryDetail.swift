import SwiftUI
import PhotosUI

private enum JournalField: Hashable {
    case title, body, tag, link
}

/// One entry, opened in place of the list. Fetches it, keeps it fresh, and hands it to the editor.
struct JournalEntryDetail: View {
    let id: String
    /// The owner's day as the list last heard it, until the entry's own reply says.
    var today: String
    /// Tags the journal already uses, so one typed again keeps its spelling.
    var known: [String]
    var onChanged: () -> Void
    var onDeleted: () -> Void

    @Environment(AppModel.self) private var app
    @State private var reply: JournalEntryReply?
    @State private var missing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let reply {
                JournalEntryEditor(
                    entry: reply.entry,
                    today: reply.today ?? today,
                    known: known,
                    onChanged: onChanged,
                    onDeleted: onDeleted
                )
                .id(reply.entry.id)
            } else if missing {
                Text("This entry is no longer here.")
                    .font(.system(size: 14.5))
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 56)
                    .accessibilityIdentifier("journal.missing")
            } else {
                Capsule()
                    .fill(Theme.fill)
                    .frame(height: 32)
                    .frame(maxWidth: 320)
                    .padding(.top, 40)
                    .accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { await poll() }
    }

    /// The web page asks again every 20 seconds.
    private func poll() async {
        while !Task.isCancelled {
            if app.tab == .journal || reply == nil {
                await load()
            }
            try? await Task.sleep(for: .seconds(20))
        }
    }

    private func load() async {
        do {
            let fresh: JournalEntryReply = try await app.api.get("journal/\(id)")
            if Task.isCancelled { return }
            missing = false
            reply = fresh
        } catch is CancellationError {
            return
        } catch let e as APIError {
            if e.status == 404 {
                reply = nil
                missing = true
            }
        } catch {
            return
        }
    }
}

/// How long after the last saved keystroke the entry is read for its themes.
private let journalSettle: Duration = .milliseconds(2500)

/// The entry itself as one glass panel: date pill, bin, title, tags, then the writing. The title
/// and the day save as they change; the body is drawn with its blocks and edited as markdown, the
/// way a note in Context is.
private struct JournalEntryEditor: View {
    var entry: ContextNode
    var today: String
    var known: [String]
    var onChanged: () -> Void
    var onDeleted: () -> Void

    @Environment(AppModel.self) private var app
    @State private var shown: ContextNode
    @State private var editing: Bool
    @State private var title: String
    @State private var text: String
    @State private var tags: [String]
    @State private var tagsBy: String?
    @State private var day: String
    @State private var showCalendar = false
    @State private var saver = ContextSaver()
    /// The owner chose the tags: the app leaves them alone from then on.
    @State private var mine: Bool
    @State private var mood: String?
    @State private var moodBy: String?
    @State private var moodBusy = 0
    /// The entry in a sentence, worked out by the server. Read-only here.
    @State private var gist: String
    /// The summary the entry was opened with. Drafts carry it unchanged, so saving what is typed
    /// never sends the gist back over a newer one.
    @State private var baseSummary: String
    @State private var settle: Task<Void, Never>?
    /// Something was saved that has not been read for its themes yet.
    @State private var unread = false
    /// Counts saves that reached the server.
    @State private var savedCount = 0
    @State private var tagBusy = 0
    @State private var dateBusy = 0
    @State private var removed = false
    @State private var error = ""
    @State private var addingTag = false
    @State private var tagText = ""
    @State private var linking = false
    @State private var linkURL = ""
    @State private var linkBusy = false
    @State private var linkError = ""
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var canPaste = false
    @State private var imageBusy = false
    @State private var imageError = ""
    @FocusState private var focus: JournalField?

    init(entry: ContextNode, today: String, known: [String], onChanged: @escaping () -> Void, onDeleted: @escaping () -> Void) {
        self.entry = entry
        self.today = today
        self.known = known
        self.onChanged = onChanged
        self.onDeleted = onDeleted
        let untitled = entry.title == "Untitled"
        // An entry that was just started opens ready to be named and written, as on the web.
        let fresh = untitled && (entry.body ?? "").isEmpty
        _shown = State(initialValue: entry)
        _editing = State(initialValue: fresh)
        _title = State(initialValue: untitled ? "" : entry.title)
        _text = State(initialValue: entry.body ?? "")
        _tags = State(initialValue: entry.tags ?? [])
        _tagsBy = State(initialValue: entry.tags_by)
        _day = State(initialValue: JournalDates.day(entry))
        _mine = State(initialValue: entry.tags_by == "owner")
        _mood = State(initialValue: entry.mood)
        _moodBy = State(initialValue: entry.mood_by)
        _gist = State(initialValue: entry.summary ?? "")
        _baseSummary = State(initialValue: entry.summary ?? "")
    }

    private var draft: ContextDraft {
        ContextDraft(title: title, summary: baseSummary, body: editing ? text : (shown.body ?? ""))
    }
    private var dateText: String { JournalDates.label(day, today: today) }

    var body: some View {
        panel
            .onChange(of: savedCount) { _, _ in
                written()
                onChanged()
            }
            .onChange(of: tagText) { _, now in
                if now.count > 30 { tagText = String(now.prefix(30)) }
            }
            .onChange(of: linkURL) { _, _ in linkError = "" }
            .onChange(of: pickedPhoto) { _, item in photoPicked(item) }
            .onReceive(NotificationCenter.default.publisher(for: UIPasteboard.changedNotification)) { _ in checkClipboard() }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in checkClipboard() }
            .onChange(of: focus) { _, now in focusChanged(now) }
    }

    private var panel: some View {
        inner
            .padding(20)
            .glass(radius: 26)
            .onAppear { begin() }
            .onDisappear { leave() }
            .onChange(of: entry) { _, fresh in adopt(fresh) }
            .onChange(of: title) { _, now in titleChanged(now) }
            .onChange(of: text) { _, _ in typed() }
    }

    private var inner: some View {
        VStack(alignment: .leading, spacing: 0) {
            topRow
            if showCalendar {
                monthCalendar
                    .padding(.top, 8)
                    .transition(.opacity)
            }
            titleField
                .padding(.top, 12)
            if !gist.isEmpty {
                Text(gist)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
                    .accessibilityIdentifier("journal.gist")
            }
            tagsRow
                .padding(.top, 10)
                .padding(.bottom, 24)
            if !error.isEmpty {
                Text(error).font(.ssMeta).foregroundStyle(Theme.danger).padding(.bottom, 12)
            }
            bodyArea
            linkArea
                .padding(.top, 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Parts

    private var topRow: some View {
        HStack(alignment: .top, spacing: 6) {
            // on a narrow phone the mood pill drops under the date pill
            FlowRow(spacing: 6) {
                datePill
                moodMenu
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(editing ? "Done" : "Edit") {
                if editing { finish() } else { startEditing() }
            }
            .buttonStyle(PillStyle())
            .frame(minHeight: 36)
            .accessibilityIdentifier("journal.edit")

            ConfirmDelete(label: "Delete entry", confirm: "Delete") { await remove() }
                .accessibilityIdentifier("journal.delete")
        }
    }

    private var datePill: some View {
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
        .accessibilityIdentifier("journal.date")
    }

    /// How the writer felt: the app's reading until the owner says otherwise. A tone dot is all
    /// the colour it gets.
    private var moodMenu: some View {
        let current = mood ?? ""
        return Menu {
            ForEach(JournalMoods.names, id: \.self) { name in
                Button {
                    chooseMood(name)
                } label: {
                    if name == current { Label(name, systemImage: "checkmark") } else { Text(name) }
                }
            }
            if moodBy == "owner" {
                Divider()
                Button("Let Subspace choose") {
                    chooseMood(nil)
                }
            }
        } label: {
            HStack(spacing: 6) {
                if !current.isEmpty { JournalMoodDot(mood: current) }
                Text(current.isEmpty ? "Mood" : current).lineLimit(1)
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Theme.ink2)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(Theme.fill, in: Capsule())
            .contentShape(Capsule())
        }
        .accessibilityLabel("Mood: \(current.isEmpty ? "none yet" : current)")
        .accessibilityIdentifier("journal.mood")
    }

    /// The system's own month calendar, Monday first. An entry belongs to a day gone by as readily
    /// as to today, so any day may be chosen.
    private var monthCalendar: some View {
        let chosen = TodosDates.date(day) ?? TodosDates.date(today) ?? Date()
        let selection = Binding<Date>(
            get: { chosen },
            set: { picked in pickDate(TodosDates.string(picked)) }
        )
        return DatePicker("Date", selection: selection, displayedComponents: .date)
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
            .accessibilityIdentifier("journal.calendar")
    }

    private var titleField: some View {
        TextField("Untitled", text: $title, axis: .vertical)
            .font(.ssDetailTitle)
            .tracking(-0.6)
            .foregroundStyle(Theme.ink)
            .tint(Theme.accent)
            .focused($focus, equals: .title)
            .submitLabel(.done)
            .accessibilityLabel("Title")
            .accessibilityIdentifier("journal.title")
    }

    /// Quiet chips, each with a way to take it off, and a pill that opens into a field to add one.
    /// Tags chosen by the app say so, in one meta line, until the owner changes them.
    private var tagsRow: some View {
        FlowRow(spacing: 6) {
            ForEach(tags, id: \.self) { tag in
                tagChip(tag)
            }
            if tags.count < 6 {
                tagAdder
            }
            if tagsBy == "auto" && !tags.isEmpty {
                Text("Tagged for you")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.ink3)
                    .padding(.leading, 4)
                    .frame(minHeight: 32)
                    .accessibilityIdentifier("journal.tags.auto")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func tagChip(_ tag: String) -> some View {
        HStack(spacing: 0) {
            Text(tag)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .accessibilityIdentifier("journal.tags.item.\(tag)")
            Button {
                chooseTags(tags.filter { $0 != tag })
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.ink3)
                    .frame(width: 28, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle(scale: 0.9))
            .accessibilityLabel("Remove tag \(tag)")
            .accessibilityIdentifier("journal.tags.remove.\(tag)")
        }
        .padding(.leading, 12)
        .frame(height: 32)
        .background(Theme.fill, in: Capsule())
    }

    @ViewBuilder private var tagAdder: some View {
        if addingTag {
            TextField("Tag", text: $tagText)
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink)
                .tint(Theme.accent)
                .submitLabel(.done)
                .focused($focus, equals: .tag)
                .onSubmit {
                    addTag()
                    withAnimation(.ssSoft) { addingTag = false }
                }
                .onAppear { focus = .tag }
                .frame(width: 120)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(Theme.fill, in: Capsule())
                .accessibilityLabel("New tag")
                .accessibilityIdentifier("journal.tags.field")
        } else {
            Button {
                withAnimation(.ssSoft) { addingTag = true }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
                    Text("Tag").font(.system(size: 13, weight: .medium))
                }
                .foregroundStyle(Theme.ink3)
                .padding(.horizontal, 10)
                .frame(height: 32)
                .contentShape(Capsule())
            }
            .buttonStyle(PressStyle(scale: 0.95))
            .accessibilityLabel("Add a tag")
            .accessibilityIdentifier("journal.tags.add")
        }
    }

    @ViewBuilder private var bodyArea: some View {
        if editing {
            editor
        } else if (shown.body ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            emptyBody
        } else {
            MarkdownView(markdown: shown.body ?? "")
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("journal.body")
        }
    }

    private var placeholder: String { "Write. Add a link below to show its preview." }

    private var emptyBody: some View {
        Button {
            startEditing()
        } label: {
            Text(placeholder)
                .font(.ssBody)
                .foregroundStyle(Theme.ink3)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .topLeading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("journal.body")
    }

    /// Raw markdown in a plain editor that grows with what is typed (the same as a note in Context).
    private var editor: some View {
        ZStack(alignment: .topLeading) {
            // sizes the editor to its text
            Text(text + "\n")
                .font(.ssBody)
                .padding(.horizontal, 5)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .opacity(0)
                .accessibilityHidden(true)
            if text.isEmpty {
                Text(placeholder)
                    .font(.ssBody)
                    .foregroundStyle(Theme.ink3)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 8)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $text)
                .font(.ssBody)
                .foregroundStyle(Theme.ink)
                .tint(Theme.accent)
                .scrollContentBackground(.hidden)
                .scrollDisabled(true)
                .focused($focus, equals: .body)
                .accessibilityLabel("Entry, markdown")
                .accessibilityIdentifier("journal.body.editor")
        }
        .frame(minHeight: 220)
        .padding(.horizontal, -5)
    }

    /// Under the writing: add a link (its preview goes at the end of the entry) or a picture.
    private var linkArea: some View {
        VStack(alignment: .leading, spacing: 6) {
            if linking {
                linkForm
                    .transition(.opacity)
            } else {
                FlowRow(spacing: 18) {
                    quietButton("link", "Add a link") {
                        withAnimation(.ssSoft) { linking = true }
                    }
                    .accessibilityIdentifier("journal.addlink")
                    PhotosPicker(selection: $pickedPhoto, matching: .images) {
                        quietLabel("photo", imageBusy ? "Adding" : "Add a picture")
                    }
                    .buttonStyle(PressStyle())
                    .disabled(imageBusy)
                    .accessibilityIdentifier("journal.addimage")
                    if canPaste {
                        quietButton("doc.on.clipboard", "Paste") {
                            pasteImage()
                        }
                        .disabled(imageBusy)
                        .accessibilityLabel("Paste a picture")
                        .accessibilityIdentifier("journal.pasteimage")
                    }
                }
            }
            if !imageError.isEmpty {
                Text(imageError)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("journal.addimage.error")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func quietLabel(_ icon: String, _ label: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 13, weight: .medium))
            Text(label).font(.system(size: 13.5, weight: .medium)).lineLimit(1)
        }
        .foregroundStyle(Theme.ink3)
        .frame(minHeight: 36)
        .contentShape(Rectangle())
    }

    private func quietButton(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            quietLabel(icon, label)
        }
        .buttonStyle(PressStyle())
    }

    private var linkForm: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: "link").font(.system(size: 15)).foregroundStyle(Theme.ink3).frame(width: 17).accessibilityHidden(true)
                TextField("Paste a link", text: $linkURL)
                    .font(.ssBody)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .submitLabel(.done)
                    .focused($focus, equals: .link)
                    .onSubmit { embed() }
                    .onAppear { focus = .link }
                    .accessibilityLabel("Link address")
                    .accessibilityIdentifier("journal.addlink.url")
                if !linkURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button(linkBusy ? "Adding" : "Add") { embed() }
                        .buttonStyle(PillStyle(prominent: true))
                        .disabled(linkBusy)
                        .opacity(linkBusy ? 0.6 : 1)
                        .accessibilityIdentifier("journal.addlink.save")
                }
                Button {
                    closeLink()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.ink3)
                        .frame(width: 32, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.9))
                .accessibilityLabel("Cancel")
                .accessibilityIdentifier("journal.addlink.cancel")
            }
            .padding(.leading, 14)
            .padding(.trailing, 4)
            .frame(minHeight: 48)
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            if !linkError.isEmpty {
                Text(linkError)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
                    .accessibilityIdentifier("journal.addlink.error")
            }
        }
    }

    // MARK: Writing

    private func begin() {
        saver.start(api: app.api, nodeID: entry.id, baseline: ContextDraft(title: entry.title, summary: entry.summary ?? "", body: entry.body ?? ""))
        saver.onSaved = { saved in
            error = ""
            shown.version = saved.version
            shown.updated_at = saved.updated_at
            shown.updated_by = saved.updated_by
            shown.title = saved.title
            if !editing && !saver.dirty { shown.body = saved.body }
            // read by `body`, which then schedules the reading of the entry and tells the list
            savedCount += 1
        }
        saver.onError = { message in error = message }
        if editing && focus == nil {
            focus = title.isEmpty ? .title : .body
        }
        checkClipboard()
    }

    /// Fresh content flows in (an agent's edit, tags worked out elsewhere) unless something typed
    /// here is still unsaved.
    private func adopt(_ fresh: ContextNode) {
        if tagBusy == 0 {
            let freshTags = fresh.tags ?? []
            if freshTags != tags || fresh.tags_by != tagsBy {
                withAnimation(.ssSoft) {
                    tags = freshTags
                    tagsBy = fresh.tags_by
                }
                mine = fresh.tags_by == "owner"
            }
        }
        if moodBusy == 0 {
            if fresh.mood != mood { mood = fresh.mood }
            if fresh.mood_by != moodBy { moodBy = fresh.mood_by }
        }
        let freshGist = fresh.summary ?? ""
        if freshGist != gist { gist = freshGist }
        if dateBusy == 0 {
            let freshDay = JournalDates.day(fresh)
            if freshDay != day { day = freshDay }
        }
        guard !editing, !saver.dirty else { return }
        shown = fresh
        if focus != .title {
            let name = fresh.title == "Untitled" ? "" : fresh.title
            if name != title { title = name }
        }
    }

    private func startEditing() {
        text = shown.body ?? ""
        withAnimation(.ssSoft) { editing = true }
        focus = .body
    }

    private func finish() {
        shown.body = text
        focus = nil
        saver.push(draft)
        saver.flush()
        withAnimation(.ssSoft) { editing = false }
    }

    private func titleChanged(_ now: String) {
        // a title is one line: return moves on to the writing itself
        if now.contains("\n") {
            title = now.replacingOccurrences(of: "\n", with: "")
            if editing { focus = .body } else { startEditing() }
            return
        }
        saver.push(draft)
    }

    private func typed() {
        guard editing else { return }
        saver.push(draft)
    }

    private func focusChanged(_ now: JournalField?) {
        if now != .tag && addingTag {
            addTag()
            withAnimation(.ssSoft) { addingTag = false }
        }
        if now == nil { saver.flush() }
    }

    private func leave() {
        settle?.cancel()
        saver.flush()
        guard !removed, unread || saver.dirty else { return }
        // Once more on the way out, so the list shows the entry with its themes, mood and gist.
        let api = app.api
        let path = "journal/\(entry.id)/categorize"
        let waiting = saver.dirty
        let done = onChanged
        Task {
            // what was typed last is on its way: let it land before the entry is read
            if waiting { try? await Task.sleep(for: .milliseconds(1200)) }
            try? await api.send("POST", path, body: [:])
            done()
        }
    }

    private func remove() async {
        saver.drop()
        settle?.cancel()
        removed = true
        do {
            try await app.api.send("DELETE", "context/\(entry.id)")
            onDeleted()
        } catch {
            removed = false
            self.error = error.localizedDescription
        }
    }

    // MARK: The day

    private func pickDate(_ picked: String) {
        if picked == day { return }
        day = picked
        withAnimation(.ssSoft) { showCalendar = false }
        dateBusy += 1
        Task {
            do {
                let node: ContextNode = try await app.api.send("PATCH", "context/\(entry.id)", body: ["entry_date": picked])
                shown.version = node.version
                self.error = ""
            } catch {
                self.error = error.localizedDescription
            }
            dateBusy -= 1
            onChanged()
        }
    }

    // MARK: Tags

    /// The entry is read a moment after writing stops: its tags, its mood and its gist. Tags or a
    /// mood the owner chose themselves are left alone (the server keeps them too).
    private func written() {
        unread = true
        settle?.cancel()
        settle = Task {
            try? await Task.sleep(for: journalSettle)
            if Task.isCancelled { return }
            await categorize()
        }
    }

    private func categorize() async {
        unread = false
        if removed { return }
        guard let node: ContextNode = try? await app.api.send("POST", "journal/\(entry.id)/categorize", body: [:]) else { return }
        if removed { return }
        withAnimation(.ssSoft) {
            if !mine && tagBusy == 0 {
                tags = node.tags ?? []
                tagsBy = node.tags_by
            }
            if moodBy != "owner" && moodBusy == 0 {
                mood = node.mood
                moodBy = node.mood_by
            }
            if let read = node.summary, !read.isEmpty { gist = read }
        }
        onChanged()
    }

    // MARK: Mood

    /// A mood the owner names is theirs from then on; nil hands the choice back to the app, which
    /// reads the entry again.
    private func chooseMood(_ name: String?) {
        withAnimation(.ssSoft) {
            mood = name
            moodBy = name == nil ? nil : "owner"
        }
        let value: Any
        if let name { value = name } else { value = NSNull() }
        let fields: [String: Any] = ["mood": value]
        let again = name == nil
        moodBusy += 1
        Task {
            do {
                let node: ContextNode = try await app.api.send("PATCH", "context/\(entry.id)", body: fields)
                shown.version = node.version
                self.error = ""
            } catch {
                self.error = error.localizedDescription
            }
            moodBusy -= 1
            if again {
                settle?.cancel()
                await categorize()
            } else {
                onChanged()
            }
        }
    }

    private func chooseTags(_ next: [String]) {
        mine = true
        withAnimation(.ssSoft) {
            tags = next
            tagsBy = "owner"
        }
        tagBusy += 1
        Task {
            do {
                let node: ContextNode = try await app.api.send("PATCH", "context/\(entry.id)", body: ["tags": next])
                shown.version = node.version
                self.error = ""
            } catch {
                self.error = error.localizedDescription
            }
            tagBusy -= 1
            onChanged()
        }
    }

    private func addTag() {
        let typed = journalCleanTag(tagText)
        tagText = ""
        if typed.isEmpty || tags.count >= 6 { return }
        if tags.contains(where: { $0.lowercased() == typed.lowercased() }) { return }
        // a tag the journal already has keeps its spelling
        let spelled = known.first(where: { $0.lowercased() == typed.lowercased() }) ?? typed
        chooseTags(tags + [spelled])
    }

    // MARK: Link previews

    private func closeLink() {
        linkURL = ""
        linkError = ""
        withAnimation(.ssSoft) { linking = false }
    }

    private func embed() {
        let raw = linkURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, !linkBusy else { return }
        linkBusy = true
        linkError = ""
        Task {
            let ok = await embedPreview(raw)
            linkBusy = false
            if ok {
                closeLink()
            } else {
                linkError = "That link could not be shown. Check the address; it must start with https."
            }
        }
    }

    /// Asks the server what the address shows as and appends it to the entry as a card.
    private func embedPreview(_ raw: String) async -> Bool {
        guard let preview: JournalLinkPreview = try? await app.api.send("POST", "links/preview", body: ["url": raw]) else { return false }
        guard preview.url.hasPrefix("https://"), let block = journalCardBlock(preview) else { return false }
        append(block)
        return true
    }

    /// Puts a block or a picture in a paragraph of its own at the end of the entry, and saves.
    private func append(_ piece: String) {
        var base = editing ? text : (shown.body ?? "")
        while let last = base.last, last.isWhitespace { base.removeLast() }
        let next = base.isEmpty ? piece : base + "\n\n" + piece
        shown.body = next
        text = next
        saver.push(ContextDraft(title: title, summary: baseSummary, body: next))
        saver.flush()
    }

    // MARK: Pictures

    private func checkClipboard() {
        let has = UIPasteboard.general.hasImages
        if has != canPaste { canPaste = has }
    }

    private func photoPicked(_ item: PhotosPickerItem?) {
        guard let item else { return }
        pickedPhoto = nil
        guard !imageBusy else { return }
        imageBusy = true
        imageError = ""
        Task {
            var picked: UIImage? = nil
            if let data = try? await item.loadTransferable(type: Data.self) {
                picked = UIImage(data: data)
            }
            await addImage(picked)
        }
    }

    private func pasteImage() {
        guard !imageBusy else { return }
        imageBusy = true
        imageError = ""
        let pasted = UIPasteboard.general.image
        Task { await addImage(pasted) }
    }

    /// Uploads the picture as a JPEG and puts it at the end of the entry.
    private func addImage(_ image: UIImage?) async {
        var ok = false
        if let image, let data = journalJPEG(image), let url = try? await app.api.upload(data, mime: "image/jpeg", filename: "journal.jpg") {
            append("![](" + url + ")")
            ok = true
        }
        imageBusy = false
        if !ok { imageError = "That picture could not be added. Try again." }
    }
}

/// A picture as a JPEG for uploading, scaled down so its long side is at most 2400 points.
private func journalJPEG(_ image: UIImage) -> Data? {
    let limit: CGFloat = 2400
    let long = max(image.size.width, image.size.height)
    guard long > 0 else { return nil }
    if long <= limit && image.scale == 1 { return image.jpegData(compressionQuality: 0.85) }
    let ratio = min(1, limit / long)
    let size = CGSize(width: max(1, (image.size.width * ratio).rounded()), height: max(1, (image.size.height * ratio).rounded()))
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let drawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in
        image.draw(in: CGRect(origin: .zero, size: size))
    }
    return drawn.jpegData(compressionQuality: 0.85)
}

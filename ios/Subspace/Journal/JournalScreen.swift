import SwiftUI

/// Journal: the owner's own dated writing. Entries newest day first under their month, tags that
/// narrow the list, and the open entry taking the list's place, as on the web.
struct JournalScreen: View {
    @Environment(AppModel.self) private var app

    @State private var store = JournalStore()
    @State private var entryID: String?
    @State private var starting = false
    @State private var error = ""

    init() {}

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Color.clear.frame(height: 0).id("journal.top")
                    header
                    if !error.isEmpty {
                        Text(error).font(.ssSecondary).foregroundStyle(Theme.danger).padding(.horizontal, 4).padding(.bottom, 12)
                    }
                    content
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 32)
                .column(880)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await store.refresh(api: app.api, merge: false) }
            .onChange(of: entryID) { _, _ in
                proxy.scrollTo("journal.top", anchor: .top)
            }
        }
        .task { await poll() }
        .onChange(of: app.pendingJournalID, initial: true) { _, id in
            guard let id else { return }
            app.pendingJournalID = nil
            go(id)
        }
        .onChange(of: app.tab) { _, now in
            if now == .journal && entryID == nil { Task { await store.refresh(api: app.api, merge: true) } }
        }
    }

    // MARK: Parts

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            trail.frame(maxWidth: .infinity, alignment: .leading)
            newButton
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 24)
    }

    private var trail: some View {
        FlowRow(spacing: 4) {
            Button {
                go(nil)
            } label: {
                Text("Journal")
                    .font(.ssTitle)
                    .tracking(-0.9)
                    .foregroundStyle(entryID == nil ? Theme.ink : Theme.ink3)
                    .frame(minHeight: 36)
            }
            .buttonStyle(PressStyle(scale: 0.98))
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("journal.crumb.root")
            if entryID != nil, let tag = store.tag {
                Button {
                    go(nil)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.ink3)
                            .accessibilityHidden(true)
                        Text(tag).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink3).lineLimit(1)
                    }
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.98))
                .accessibilityLabel(tag)
                .accessibilityIdentifier("journal.crumb.tag")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Breadcrumb")
    }

    private var newButton: some View {
        Button {
            newEntry()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus").font(.system(size: 14, weight: .medium))
                Text("New entry").font(.system(size: 14.5, weight: .medium)).lineLimit(1).fixedSize()
            }
            .foregroundStyle(Theme.ink2)
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            .glass(radius: 20)
            .contentShape(Capsule())
        }
        .buttonStyle(PressStyle())
        .disabled(starting)
        .accessibilityLabel("New entry")
        .accessibilityIdentifier("journal.new")
    }

    @ViewBuilder private var content: some View {
        if let entryID {
            JournalEntryDetail(
                id: entryID,
                today: store.today,
                known: store.tags.map { $0.tag },
                onChanged: { refreshSoon() },
                onDeleted: { deleted(entryID) }
            )
            .id(entryID)
            .transition(.opacity)
        } else {
            JournalList(
                store: store,
                onTag: { tag in choose(tag) },
                onOpen: { id in go(id) }
            )
            .transition(.opacity)
        }
    }

    // MARK: Moving around

    private func go(_ id: String?) {
        _ = UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        error = ""
        withAnimation(.ssSoft) { entryID = id }
        if id == nil { refreshSoon() }
    }

    private func choose(_ tag: String?) {
        Task { await store.choose(tag, api: app.api) }
    }

    private func deleted(_ id: String) {
        store.forget(id)
        go(nil)
    }

    // MARK: Data

    private func refreshSoon() {
        Task { await store.refresh(api: app.api, merge: true) }
    }

    /// The web page asks for the list every 30 seconds.
    private func poll() async {
        while !Task.isCancelled {
            if app.tab == .journal && app.signedIn && (entryID == nil || !store.loaded) {
                await store.refresh(api: app.api, merge: true)
            }
            try? await Task.sleep(for: .seconds(30))
        }
    }

    private func newEntry() {
        guard !starting else { return }
        starting = true
        Task {
            do {
                let made: ContextNode = try await app.api.send("POST", "journal", body: [:])
                go(made.id)
            } catch {
                self.error = error.localizedDescription
            }
            starting = false
        }
    }
}

/// How many tags sit above the list: the most used, and the chosen one even when it is not among them.
private let journalTagsShown = 14

/// The tags that narrow the list, the entries under their months, and the next page as the end is reached.
private struct JournalList: View {
    var store: JournalStore
    var onTag: (String?) -> Void
    var onOpen: (String) -> Void

    @Environment(AppModel.self) private var app

    private var chips: [JournalTagCount] {
        var out = Array(store.tags.prefix(journalTagsShown))
        if let tag = store.tag, !out.contains(where: { $0.tag == tag }) {
            out.insert(JournalTagCount(tag: tag, count: store.total), at: 0)
        }
        return out
    }

    private var emptyText: String {
        if let tag = store.tag { return "Nothing tagged “\(tag)” yet." }
        return "Nothing written yet. New entry starts one for today."
    }

    var body: some View {
        let months = JournalDates.months(store.entries)
        VStack(alignment: .leading, spacing: 0) {
            if !chips.isEmpty {
                FlowRow(spacing: 6) {
                    ForEach(chips, id: \.tag) { item in
                        chip(item)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
                .padding(.bottom, 20)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Tags")
            }
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(months.enumerated()), id: \.element.id) { item in
                    monthHeading(item.element.id, first: item.offset == 0)
                    if let stat = store.months[item.element.id] {
                        JournalMonthGlance(stat: stat)
                    }
                    ForEach(item.element.rows) { row in
                        JournalRow(entry: row.entry, showDay: row.showDay, today: store.today) {
                            onOpen(row.entry.id)
                        }
                        .padding(.bottom, 10)
                    }
                }
                if store.next != nil {
                    more
                }
            }
            if store.loaded && store.entries.isEmpty {
                Text(emptyText)
                    .font(.system(size: 14.5))
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 56)
                    .accessibilityIdentifier("journal.empty")
            }
        }
    }

    private func chip(_ item: JournalTagCount) -> some View {
        let on = item.tag == store.tag
        let count = item.count ?? 0
        return Button {
            onTag(on ? nil : item.tag)
        } label: {
            HStack(spacing: 6) {
                Text(item.tag).font(.system(size: 13, weight: .medium)).lineLimit(1)
                if item.count != nil {
                    Text("\(count)").font(.system(size: 12)).monospacedDigit().foregroundStyle(on ? Theme.accent : Theme.ink3)
                }
            }
            .foregroundStyle(on ? Theme.accent : Theme.ink2)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(on ? Theme.accentSoft : Theme.fill, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(PressStyle(scale: 0.95))
        .accessibilityLabel(item.tag)
        .accessibilityValue(count == 1 ? "1 entry" : "\(count) entries")
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("journal.tag.\(item.tag)")
    }

    private func monthHeading(_ ym: String, first: Bool) -> some View {
        let name = JournalDates.monthName(ym)
        return Text(name.uppercased())
            .font(.system(size: 12.5, weight: .semibold))
            .tracking(0.7)
            .foregroundStyle(Theme.ink3)
            .padding(.horizontal, 12)
            .padding(.top, first ? 0 : 20)
            .padding(.bottom, 4)
            .accessibilityLabel(name)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("journal.month.\(ym)")
    }

    private var more: some View {
        let label = store.busy ? "Loading" : "Show more · \(store.entries.count) of \(store.total.formatted())"
        return Button(label) {
            Task { await store.loadMore(api: app.api) }
        }
        .font(.ssSecondary)
        .foregroundStyle(Theme.ink3)
        .frame(maxWidth: .infinity, minHeight: 44)
        .buttonStyle(PressStyle())
        .accessibilityIdentifier("journal.more")
        .id(store.entries.count)
        .onAppear {
            Task { await store.loadMore(api: app.api) }
        }
    }
}

/// The small dot that is all the colour a mood gets: good for up, warn for down, ink3 for even.
struct JournalMoodDot: View {
    var mood: String?
    var size: CGFloat = 8

    var body: some View {
        Circle()
            .fill(JournalMoods.color(mood))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// How many mood dots a month shows at most: one per day of the longest month.
private let journalDotsShown = 31

/// A month at a glance, under its name: a dot per entry coloured by its mood's tone, the mood most
/// entries share with the month's themes, and the written digest when there is one.
private struct JournalMonthGlance: View {
    var stat: JournalMonthStat

    private var moods: [String] { Array((stat.moods ?? []).prefix(journalDotsShown)) }
    private var digest: String { (stat.summary ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    private var lead: String? { JournalMoods.lead(stat.moods ?? []) }

    private var metaLine: String {
        guard let lead else { return "" }
        var line = "Mostly " + lead.lowercased()
        let tags = stat.tags ?? []
        if !tags.isEmpty { line += " · " + tags.joined(separator: ", ") }
        return line
    }

    private var spoken: String {
        var out = JournalDates.monthName(stat.ym)
        if let lead { out += ": mostly " + lead.lowercased() }
        out += "."
        if !digest.isEmpty { out += " " + digest }
        return out
    }

    var body: some View {
        if !moods.isEmpty || !digest.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                if !moods.isEmpty {
                    FlowRow(spacing: 4) {
                        ForEach(Array(moods.enumerated()), id: \.offset) { item in
                            JournalMoodDot(mood: item.element)
                        }
                    }
                }
                if !metaLine.isEmpty {
                    Text(metaLine)
                        .font(.ssMeta)
                        .foregroundStyle(Theme.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !digest.isEmpty {
                    Text(digest)
                        .font(.ssSecondary)
                        .foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.top, 2)
            .padding(.bottom, 8)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
            .accessibilityIdentifier("journal.month.\(stat.ym).summary")
        }
    }
}

/// One entry in the list, as its own glass card: its day at the left (once per day), then title,
/// its gist (or its first words), its mood and tags; beneath them every picture in it, never cropped.
private struct JournalRow: View {
    var entry: ContextNode
    var showDay: Bool
    var today: String
    var onOpen: () -> Void

    @Environment(\.horizontalSizeClass) private var sizeClass

    private var day: String { JournalDates.day(entry) }
    /// The gist when the entry has been read; until then, how it begins.
    private var excerpt: String {
        if let gist = entry.summary, !gist.isEmpty { return gist }
        return entry.excerpt ?? ""
    }
    private var mood: String? {
        guard let mood = entry.mood, !mood.isEmpty else { return nil }
        return mood
    }
    private var tags: [String] { entry.tags ?? [] }
    /// Every picture in the entry; an older server names only the first.
    private var images: [String] {
        let all = entry.images ?? (entry.image.map { [$0] } ?? [])
        return all.filter { !$0.isEmpty }
    }

    private var spoken: String {
        var parts: [String] = [JournalDates.label(day, today: today)]
        if !excerpt.isEmpty { parts.append(excerpt) }
        if let mood { parts.append(mood) }
        if !tags.isEmpty { parts.append(tags.joined(separator: ", ")) }
        if !images.isEmpty { parts.append(images.count == 1 ? "1 picture" : "\(images.count) pictures") }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        VStack(alignment: .leading, spacing: 12) {
            // The words are the button; the pictures beneath scroll sideways and open the entry on a tap.
            Button(action: onOpen) {
                HStack(alignment: .top, spacing: 12) {
                    dayMark
                    texts
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle(scale: 0.985))
            .accessibilityLabel(entry.title)
            .accessibilityValue(spoken)
            .accessibilityIdentifier("journal.entry.\(entry.id)")

            if !images.isEmpty {
                JournalCardPictures(entryID: entry.id, images: images, wide: sizeClass == .regular, onOpen: onOpen)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glass(radius: 22)
        .contentShape(shape)
        // the card's edges open it too, as on the web where the whole card is the button
        .onTapGesture { onOpen() }
    }

    private var dayMark: some View {
        VStack(spacing: 4) {
            if showDay {
                Text(JournalDates.dayNumber(day))
                    .font(.system(size: 20, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(day == today ? Theme.accent : Theme.ink)
                Text(JournalDates.weekday(day))
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
            }
        }
        .frame(width: 40)
        .padding(.top, 1)
    }

    private var texts: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(entry.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
            if !excerpt.isEmpty {
                Text(excerpt)
                    .font(.ssSecondary)
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            if mood != nil || !tags.isEmpty {
                FlowRow(spacing: 4) {
                    if let mood {
                        HStack(spacing: 5) {
                            JournalMoodDot(mood: mood, size: 6)
                            Text(mood).font(.system(size: 11.5)).foregroundStyle(Theme.ink2).lineLimit(1)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Theme.fill, in: Capsule())
                    }
                    ForEach(tags, id: \.self) { tag in
                        Text(tag)
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.ink2)
                            .lineLimit(1)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Theme.fill, in: Capsule())
                    }
                }
                .padding(.top, 5)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Where a card's pictures start on a wide screen: under the title, past the day column and its gap.
private let journalCardIndent: CGFloat = 52

/// The pictures of one entry in its card, never cropped. One is shown whole at its own shape, as
/// wide as the card allows and no taller than 360 points (300 on a phone). Several sit in one row
/// at a common height, each as wide as its shape needs, and the row scrolls sideways, fading at its
/// right edge while more wait.
private struct JournalCardPictures: View {
    var entryID: String
    var images: [String]
    var wide: Bool
    var onOpen: () -> Void

    /// Each picture's width over its height, once known.
    @State private var ratios: [Int: CGFloat] = [:]
    /// Pictures that could not be shown take no space.
    @State private var failed: Set<Int> = []
    @State private var stripWidth: CGFloat = 0

    /// Until a picture's shape is known it holds a 4:3 place, so the card does not jump much.
    private static let guess: CGFloat = 4.0 / 3.0
    private static let fade: CGFloat = 28

    private func ratio(_ index: Int) -> CGFloat {
        let r = ratios[index] ?? Self.guess
        return r > 0 ? r : Self.guess
    }

    private var shown: [Int] { images.indices.filter { !failed.contains($0) } }

    var body: some View {
        Group {
            if images.count == 1 {
                single
            } else {
                strip
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(images.count == 1 ? "Picture" : "\(images.count) pictures")
        .accessibilityIdentifier("journal.entry.\(entryID).pictures")
    }

    @ViewBuilder private var single: some View {
        if !failed.contains(0) {
            let tallest: CGFloat = wide ? 360 : 300
            let r = ratio(0)
            picture(0)
                .aspectRatio(r, contentMode: .fit)
                // a tall picture gets narrower rather than taller than the limit
                .frame(maxWidth: tallest * r, maxHeight: tallest)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, wide ? journalCardIndent : 0)
                .contentShape(Rectangle())
                .onTapGesture { onOpen() }
        }
    }

    private var strip: some View {
        let height: CGFloat = wide ? 200 : 160
        let indexes = shown
        var content: CGFloat = 0
        for index in indexes { content += height * ratio(index) }
        content += CGFloat(max(indexes.count - 1, 0)) * 8
        let more = stripWidth > 0 && content > stripWidth + 1
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(indexes, id: \.self) { index in
                    picture(index)
                        .frame(width: height * ratio(index), height: height)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            // room at the end, so the last picture can be scrolled clear of the fade
            .padding(.trailing, more ? Self.fade : 0)
            .contentShape(Rectangle())
            .onTapGesture { onOpen() }
        }
        .frame(height: indexes.isEmpty ? 0 : height)
        .mask {
            HStack(spacing: 0) {
                Rectangle().fill(Color.black)
                LinearGradient(colors: [Color.black, Color.black.opacity(0)], startPoint: .leading, endPoint: .trailing)
                    .frame(width: more ? Self.fade : 0)
            }
        }
        .background {
            GeometryReader { geo in
                Color.clear
                    .onAppear { stripWidth = geo.size.width }
                    .onChange(of: geo.size.width) { _, width in stripWidth = width }
            }
        }
        .padding(.leading, wide ? journalCardIndent : 0)
    }

    /// One picture, fitted whole into the frame its shape asks for.
    private func picture(_ index: Int) -> some View {
        RemoteImage(images[index], contentMode: .fit, onRatio: { r in
            if r > 0 && ratios[index] != r { ratios[index] = r }
        }, onFailed: {
            failed.insert(index)
        })
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Picture \(index + 1)")
        .accessibilityAddTraits(.isImage)
        .accessibilityIdentifier("journal.entry.\(entryID).picture.\(index)")
    }
}

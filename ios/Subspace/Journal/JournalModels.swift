import SwiftUI
import Observation

// Shapes only the Journal reads (see src/lib/core/journal.ts). An entry is a context node of kind
// "journal", so it is a `ContextNode` with `entry_date`, `tags`, `tags_by`, `mood` and `mood_by`
// filled in, and its gist in `summary`.

/// One tag and how many entries carry it.
struct JournalTagCount: Codable, Identifiable, Hashable {
    var tag: String
    var count: Int?
    var id: String { tag }
}

/// One month at a glance: a mood per entry in day order, its top themes, and a written digest
/// (often empty; it can arrive on a later refresh).
struct JournalMonthStat: Codable, Hashable {
    var ym: String
    var count: Int?
    var moods: [String]?
    var tags: [String]?
    var summary: String?
}

/// The moods an entry can carry (src/lib/moods.ts). Each has a tone, which is all the colour it gets.
enum JournalMoods {
    static let up: [String] = ["Joyful", "Grateful", "Hopeful", "Energised"]
    static let even: [String] = ["Calm", "Curious", "Reflective"]
    static let down: [String] = ["Tired", "Anxious", "Frustrated", "Sad"]
    static let names: [String] = up + even + down

    /// The tone's colour: good for up, warn for down, ink3 for even and for anything unknown.
    static func color(_ mood: String?) -> Color {
        guard let mood else { return Theme.ink3 }
        if up.contains(mood) { return Theme.good }
        if down.contains(mood) { return Theme.warn }
        return Theme.ink3
    }

    /// The mood most entries share (the earliest of equals).
    static func lead(_ moods: [String]) -> String? {
        var counts: [String: Int] = [:]
        for mood in moods { counts[mood, default: 0] += 1 }
        var best: String? = nil
        var most = 0
        for mood in moods {
            let n = counts[mood] ?? 0
            if n > most {
                most = n
                best = mood
            }
        }
        return best
    }
}

/// GET `journal`: one page of entries, newest day first, the months they fall in, and every tag in use.
struct JournalPage: Codable {
    var entries: [ContextNode]
    var months: [JournalMonthStat]?
    var next: String?
    var total: Int?
    var tags: [JournalTagCount]?
    var today: String?
}

/// GET `journal/<id>`.
struct JournalEntryReply: Codable {
    var entry: ContextNode
    var today: String?
}

/// POST `links/preview`: what an address shows as. Nothing is saved.
struct JournalLinkPreview: Codable {
    var url: String
    var title: String?
    var site: String?
    var description: String?
    var image: String?
}

/// The entries of one month, in the order they are listed.
struct JournalMonth: Identifiable {
    /// "2026-11".
    let id: String
    var rows: [JournalRowItem]
}

struct JournalRowItem: Identifiable {
    let entry: ContextNode
    /// The day is written once; further entries of the same day leave it blank.
    let showDay: Bool
    var id: String { entry.id }
}

/// Plain days ("2026-11-16") as the journal words them. Built on `TodosDates`, which reads them in UTC.
enum JournalDates {
    private static let utc: TimeZone = TimeZone(secondsFromGMT: 0) ?? TimeZone.current

    private static let monthFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = utc
        f.setLocalizedDateFormatFromTemplate("MMMMyyyy")
        return f
    }()

    private static let weekdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = utc
        f.setLocalizedDateFormatFromTemplate("EEE")
        return f
    }()

    private static let yearFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = utc
        f.setLocalizedDateFormatFromTemplate("EEEMMMdyyyy")
        return f
    }()

    /// The day an entry belongs to; the day it was made when the server sent none.
    static func day(_ entry: ContextNode) -> String {
        String((entry.entry_date ?? entry.created_at ?? "").prefix(10))
    }

    /// "November 2026" for "2026-11".
    static func monthName(_ ym: String) -> String {
        guard let d = TodosDates.date(ym + "-01") else { return ym }
        return monthFormatter.string(from: d)
    }

    /// "Mon".
    static func weekday(_ day: String) -> String {
        guard let d = TodosDates.date(day) else { return "" }
        return weekdayFormatter.string(from: d)
    }

    /// "16" for "2026-11-16".
    static func dayNumber(_ day: String) -> String {
        guard let n = Int(day.suffix(2)) else { return "" }
        return String(n)
    }

    /// "Today", "Mon, Nov 16", and the year too once it is not this one.
    static func label(_ day: String, today: String) -> String {
        if day.isEmpty { return "No date" }
        if day == today { return "Today" }
        if today.isEmpty || day.prefix(4) == today.prefix(4) { return TodosDates.shortDate(day) }
        guard let d = TodosDates.date(day) else { return day }
        return yearFormatter.string(from: d)
    }

    /// Entries as the list shows them: under their month, the day written once.
    static func months(_ entries: [ContextNode]) -> [JournalMonth] {
        var out: [JournalMonth] = []
        var previousDay: String? = nil
        for entry in entries {
            let d = day(entry)
            let ym = String(d.prefix(7))
            let item = JournalRowItem(entry: entry, showDay: d != previousDay)
            if let last = out.indices.last, out[last].id == ym {
                out[last].rows.append(item)
            } else {
                out.append(JournalMonth(id: ym, rows: [item]))
            }
            previousDay = d
        }
        return out
    }
}

/// A tag as people write it: one line, at most 30 characters. The same rule as the server's `cleanTags`.
func journalCleanTag(_ raw: String) -> String {
    let spaced = raw.replacingOccurrences(of: "[\\s,#]+", with: " ", options: .regularExpression)
    let trimmed = spaced.trimmingCharacters(in: .whitespacesAndNewlines)
    return String(trimmed.prefix(30)).trimmingCharacters(in: .whitespacesAndNewlines)
}

/// The fenced block a link preview is stored as in an entry's body: one card, list layout, exactly
/// what the web editor writes (`embedLink` in src/components/Editor.tsx). Nil when it cannot be built.
func journalCardBlock(_ preview: JournalLinkPreview) -> String? {
    var card: [String: Any] = ["url": preview.url]
    let title = (preview.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    card["title"] = title.isEmpty ? contextBareURL(preview.url) : title
    if let site = preview.site, !site.isEmpty { card["subtitle"] = site }
    if let description = preview.description, !description.isEmpty { card["description"] = description }
    if let image = preview.image, !image.isEmpty { card["image"] = image }
    let block: [String: Any] = ["layout": "list", "items": [card]]
    guard let data = try? JSONSerialization.data(withJSONObject: block, options: [.sortedKeys, .withoutEscapingSlashes]),
          let json = String(data: data, encoding: .utf8) else { return nil }
    return "```cards\n" + json + "\n```"
}

/// Whether a line of a body is nothing but a web address ("https://…").
func journalIsAddressLine(_ line: String) -> Bool {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    return trimmed.range(of: "^https://\\S+$", options: [.regularExpression, .caseInsensitive]) != nil
}

/// The lines of a body that are only an address and sit outside fenced blocks, by index.
func journalAddressLines(_ lines: [String]) -> [Int] {
    var out: [Int] = []
    var fenced = false
    for (index, line) in lines.enumerated() {
        let start = line.trimmingCharacters(in: .whitespaces)
        if start.hasPrefix("```") || start.hasPrefix("~~~") {
            fenced.toggle()
            continue
        }
        if !fenced && journalIsAddressLine(line) { out.append(index) }
    }
    return out
}

/// An address on a line of its own becomes its preview, as pasting one does on the web: each such
/// line is looked up and replaced by a card block. A line whose lookup fails stays as it is.
/// Nil when nothing changed.
func journalExpandLinks(_ body: String, api: API) async -> String? {
    var lines = body.components(separatedBy: "\n")
    let found = journalAddressLines(lines)
    if found.isEmpty { return nil }
    var changed = false
    // from the end, so earlier indexes stay true while lines are put in
    for index in found.reversed() {
        let raw = lines[index].trimmingCharacters(in: .whitespaces)
        guard let preview: JournalLinkPreview = try? await api.send("POST", "links/preview", body: ["url": raw]) else { continue }
        guard preview.url.hasPrefix("https://"), let block = journalCardBlock(preview) else { continue }
        var piece: [String] = block.components(separatedBy: "\n")
        // a block stands in a paragraph of its own
        if index + 1 < lines.count, !lines[index + 1].trimmingCharacters(in: .whitespaces).isEmpty { piece.append("") }
        if index > 0, !lines[index - 1].trimmingCharacters(in: .whitespaces).isEmpty { piece.insert("", at: 0) }
        lines.replaceSubrange(index...index, with: piece)
        changed = true
    }
    return changed ? lines.joined(separator: "\n") : nil
}

/// Entries a page at a time, newest day first: all of them, or those carrying one tag.
@MainActor
@Observable
final class JournalStore {
    var entries: [ContextNode] = []
    var tags: [JournalTagCount] = []
    /// What is known of each month on screen, by "YYYY-MM".
    var months: [String: JournalMonthStat] = [:]
    var total = 0
    var today = ""
    var next: String?
    var loaded = false
    var busy = false
    /// The tag the list is narrowed to, if any.
    var tag: String?

    private func path(tag: String?, before: String?) -> String {
        var parts: [String] = []
        if let tag { parts.append("tag=" + q(tag)) }
        if let before { parts.append("before=" + q(before)) }
        return "journal?" + parts.joined(separator: "&")
    }

    /// Where an entry sorts: later days first, then by id, as the server orders them.
    private func key(_ entry: ContextNode) -> String {
        JournalDates.day(entry) + "~" + entry.id
    }

    /// Narrows the list to one tag, or shows everything again.
    func choose(_ tag: String?, api: API) async {
        self.tag = tag
        await refresh(api: api, merge: false)
    }

    /// The first page. With `merge`, pages already scrolled to are kept and only refreshed in place.
    func refresh(api: API, merge: Bool) async {
        let asked = tag
        guard let page: JournalPage = try? await api.get(path(tag: asked, before: nil)) else { return }
        if Task.isCancelled || asked != tag { return }
        total = page.total ?? page.entries.count
        tags = page.tags ?? []
        today = page.today ?? today
        take(page.months, fresh: !(merge && loaded))
        // With nothing beyond the first page, that page is the whole list.
        if merge && loaded && page.next != nil && entries.count > page.entries.count, let last = page.entries.last {
            let fresh = Set(page.entries.map { $0.id })
            let edge = key(last)
            let older = entries.filter { !fresh.contains($0.id) && key($0) < edge }
            entries = page.entries + older
        } else {
            entries = page.entries
            next = page.next
        }
        loaded = true
    }

    /// Months a reply described; with `fresh`, what was known of other months is forgotten.
    private func take(_ stats: [JournalMonthStat]?, fresh: Bool) {
        var out: [String: JournalMonthStat] = fresh ? [:] : months
        for stat in stats ?? [] { out[stat.ym] = stat }
        if out != months { months = out }
    }

    /// Takes an entry out of the list at once (it was deleted); the next refresh agrees.
    func forget(_ id: String) {
        entries.removeAll { $0.id == id }
    }

    func loadMore(api: API) async {
        guard !busy, let before = next else { return }
        let asked = tag
        busy = true
        if let page: JournalPage = try? await api.get(path(tag: asked, before: before)), asked == tag {
            let have = Set(entries.map { $0.id })
            entries.append(contentsOf: page.entries.filter { !have.contains($0.id) })
            next = page.next
            total = page.total ?? total
            take(page.months, fresh: false)
        }
        busy = false
    }
}

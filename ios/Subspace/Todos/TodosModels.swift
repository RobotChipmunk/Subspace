import Foundation

// Shapes only the todos screen reads. They mirror src/lib/core/todos.ts.

/// One entry of `todos/folders`: a day, a span of days, the backlog or a guest's list (every task
/// from that person, with or without a day).
struct TodosFolder: Codable, Identifiable, Hashable {
    var key: String
    var label: String
    var hint: String?
    var count: Int
    /// The guest's id when this is their list ("From Meredith").
    var guest: String?

    var id: String { key }
}

struct TodosFoldersResponse: Codable {
    var today: String
    var folders: [TodosFolder]
    var bin: Int
}

struct TodosListResponse: Codable {
    var today: String?
    var todos: [Todo]
}

/// A deleted task waiting in the bin.
struct TodosBinItem: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var done: Bool
    var has_notes: Bool?
    var deleted_at: String?
    var days_left: Int
}

struct TodosBinResponse: Codable {
    var todos: [TodosBinItem]
    var keep_days: Int?
}

/// The tasks under one heading of a list ("Any day", "Today", "Thursday").
struct TodosGroup: Identifiable {
    let key: String
    var items: [Todo]
    var id: String { key }
}

/// One choice of how often a task comes round again.
struct TodosRepeatOption: Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

/// How often a task repeats, in the words the web uses.
enum TodosRepeat {
    static let options: [TodosRepeatOption] = [
        TodosRepeatOption(key: "daily", label: "Every day"),
        TodosRepeatOption(key: "every_3_days", label: "Every 3 days"),
        TodosRepeatOption(key: "weekly", label: "Every week"),
        TodosRepeatOption(key: "biweekly", label: "Every 2 weeks"),
        TodosRepeatOption(key: "monthly", label: "Every month"),
        TodosRepeatOption(key: "yearly", label: "Every year"),
    ]

    static func label(_ key: String?) -> String? {
        guard let key else { return nil }
        return options.first { $0.key == key }?.label
    }

    /// What finishing a repeating task will do.
    static func hint(_ key: String) -> String {
        switch key {
        case "daily": return "When you finish it, the next one is added for the day after."
        case "every_3_days": return "When you finish it, the next one is added three days from that day."
        case "weekly": return "When you finish it, the next one is added a week from that day."
        case "biweekly": return "When you finish it, the next one is added two weeks from that day."
        case "monthly": return "When you finish it, the next one is added a month from that day."
        default: return "When you finish it, the next one is added a year from that day."
        }
    }
}

/// Calendar days as the server writes them ("2026-11-14"), handled without the device's time zone.
enum TodosDates {
    private static let utc: TimeZone = TimeZone(secondsFromGMT: 0) ?? TimeZone.current

    private static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = utc
        return c
    }()

    private static let parser: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = utc
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static let weekdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = utc
        f.setLocalizedDateFormatFromTemplate("EEEE")
        return f
    }()

    private static let longFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = utc
        f.setLocalizedDateFormatFromTemplate("EEEEMMMMd")
        return f
    }()

    private static let shortFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = utc
        f.setLocalizedDateFormatFromTemplate("EEEMMMd")
        return f
    }()

    private static let monthDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = utc
        f.setLocalizedDateFormatFromTemplate("MMMMd")
        return f
    }()

    /// The zone plain days are read in, for a date picker that must agree with `string(_:)`.
    static var zone: TimeZone { utc }

    /// A Monday-first calendar in that zone, like the task lists.
    static let pickerCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = utc
        c.firstWeekday = 2
        return c
    }()

    /// "Thu, Dec 17".
    static func shortDate(_ text: String) -> String {
        guard let d = date(text) else { return text }
        return shortFormatter.string(from: d)
    }

    /// "December 7".
    static func monthDay(_ text: String) -> String {
        guard let d = date(text) else { return text }
        return monthDayFormatter.string(from: d)
    }

    /// Whole days from one day to another; negative when `to` is earlier.
    static func days(from: String, to: String) -> Int? {
        guard let a = date(from), let b = date(to) else { return nil }
        return calendar.dateComponents([.day], from: a, to: b).day
    }

    /// Where a task has been put, in a word or two: "Today", "Thursday", "Thu, Dec 17", "This week",
    /// "Backlog". Empty while it still waits for a day. The same words as `placeLabel` on the web.
    static func placeLabel(scope: String, date: String?, today: String?) -> String {
        if scope == "backlog" { return "Backlog" }
        guard scope != "guest", let date, let today, let gap = days(from: today, to: date) else { return "" }
        if scope == "week" {
            if gap <= 0 { return "This week" }
            if gap <= 7 { return "Next week" }
            return "Week of " + monthDay(date)
        }
        if gap == 0 { return "Today" }
        if gap == 1 { return "Tomorrow" }
        if gap > 1 && gap < 7 { return dayName(date) }
        return shortDate(date)
    }

    static func isDate(_ text: String) -> Bool {
        text.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil
    }

    static func date(_ text: String) -> Date? {
        parser.date(from: text)
    }

    static func string(_ date: Date) -> String {
        parser.string(from: date)
    }

    /// "Saturday".
    static func dayName(_ text: String) -> String {
        guard let d = date(text) else { return text }
        return weekdayFormatter.string(from: d)
    }

    /// "Saturday, November 14".
    static func longDate(_ text: String) -> String {
        guard let d = date(text) else { return text }
        return longFormatter.string(from: d)
    }

    static func adding(_ days: Int, to text: String) -> String? {
        guard let d = date(text), let moved = calendar.date(byAdding: .day, value: days, to: d) else { return nil }
        return string(moved)
    }

    /// The Monday of the week `text` falls in.
    static func monday(_ text: String) -> String? {
        guard let d = date(text) else { return nil }
        // 1 is Sunday, 2 is Monday
        let weekday = calendar.component(.weekday, from: d)
        let back = weekday == 1 ? 6 : weekday - 2
        return adding(-back, to: text)
    }

    /// Where a task added to "Weekend" goes: Saturday, or today when it is already Sunday.
    static func weekendDay(_ today: String) -> String {
        guard let d = date(today) else { return today }
        let weekday = calendar.component(.weekday, from: d)
        if weekday == 1 { return today }
        return adding(7 - weekday, to: today) ?? today
    }
}

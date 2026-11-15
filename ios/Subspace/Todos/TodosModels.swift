import Foundation

// Shapes only the todos screen reads. They mirror src/lib/core/todos.ts.

/// One entry of `todos/folders`: a day, a span of days, the backlog or a guest's waiting list.
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

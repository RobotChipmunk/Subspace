import SwiftUI

/// A note under Current: something that is true for now, with the day it holds until.
struct ContextCurrentNote: Codable, Identifiable, Hashable {
    let id: String
    var path: String?
    var title: String
    var summary: String?
    /// The last day it holds ("YYYY-MM-DD"), or nil for no end day.
    var until: String?
    var updated_by: String?
    var lapsed: Bool?
}

/// A day as people say it: "30 Nov", with the year only when it is not this one.
func contextDayLabel(_ day: String) -> String {
    let parse = DateFormatter()
    parse.calendar = Calendar(identifier: .gregorian)
    parse.locale = Locale(identifier: "en_US_POSIX")
    parse.dateFormat = "yyyy-MM-dd"
    guard let date = parse.date(from: day) else { return day }
    let sameYear = Calendar.current.component(.year, from: date) == Calendar.current.component(.year, from: Date())
    let show = DateFormatter()
    show.setLocalizedDateFormatFromTemplate(sameYear ? "d MMM" : "d MMM yyyy")
    return show.string(from: date)
}

/// Today where the owner is, as "YYYY-MM-DD".
func contextToday() -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: Date())
}

/// What is true for now: the notes under Current, soonest to end first, each with the day it
/// holds until and who set it. Agents write these from what they see; opening one lets the owner
/// change or remove it. Nothing shows when there are none.
struct ContextCurrentShelf: View {
    var notes: [ContextCurrentNote]
    var wide: Bool
    var onOpen: (String) -> Void

    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("CURRENT")
                .font(.system(size: 13, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Theme.ink3)
                .padding(.horizontal, 4)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: wide ? 2 : 1), spacing: 10) {
                ForEach(notes) { note in
                    card(note)
                }
            }
        }
        .padding(.bottom, 24)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("context.current")
    }

    private func card(_ note: ContextCurrentNote) -> some View {
        let by = app.agent(note.updated_by)
        let lapsed = note.lapsed == true
        let when = note.until.map { (lapsed ? "ended " : "until ") + contextDayLabel($0) } ?? "no end day"
        let line = [by?.name, when].compactMap { $0 }.joined(separator: " · ")
        return Button {
            onOpen(note.id)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(note.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                if let summary = note.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.system(size: 13.5))
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                HStack(spacing: 6) {
                    if let by { AvatarView(agent: by, size: 14) }
                    Text(line).font(.system(size: 12)).foregroundStyle(Theme.ink3).lineLimit(1)
                }
                .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .glass(radius: 20)
            .opacity(lapsed ? 0.6 : 1)
        }
        .buttonStyle(PressStyle(scale: 0.985))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("context.current.\(note.id)")
    }
}

/// The day a note holds until, for what is only true for now: a pill that opens the calendar, and
/// a way to take the day off. Shown on a note that has an end day, and on any note under Current.
struct ContextUntilRow: View {
    var until: String?
    /// Called with the new day, or nil to take it off.
    var onPick: (String?) -> Void

    private var date: Binding<Date> {
        Binding(
            get: { Self.parse(until) ?? Calendar.current.date(byAdding: .day, value: 30, to: Date()) ?? Date() },
            set: { onPick(Self.format($0)) }
        )
    }

    var body: some View {
        HStack(spacing: 8) {
            if let until {
                Text("Until").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.ink2)
                DatePicker("Until", selection: date, displayedComponents: .date)
                    .labelsHidden()
                    .datePickerStyle(.compact)
                    .tint(Theme.accent)
                    .accessibilityIdentifier("context.until.date")
                Button {
                    onPick(nil)
                } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3).frame(width: 36, height: 36).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Take the end day off")
                .accessibilityIdentifier("context.until.clear")
                if until < contextToday() {
                    Text("It has passed its day.").font(.system(size: 12.5)).foregroundStyle(Theme.ink3)
                }
            } else {
                Button("Add an end day") { onPick(Self.format(Calendar.current.date(byAdding: .day, value: 30, to: Date()) ?? Date())) }
                    .buttonStyle(PillStyle())
                    .accessibilityIdentifier("context.until.add")
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("context.until")
    }

    private static func parse(_ day: String?) -> Date? {
        guard let day else { return nil }
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: day)
    }

    private static func format(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

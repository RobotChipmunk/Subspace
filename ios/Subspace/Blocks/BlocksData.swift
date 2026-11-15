import SwiftUI

// MARK: Stats

struct BlocksStats: View {
    var d: JSONValue
    var compact: Bool

    var body: some View {
        let items = d.list("items")
        LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 104 : 132), spacing: 10, alignment: .top)], alignment: .leading, spacing: 10) {
            ForEach(Array(items.enumerated()), id: \.offset) { item in
                BlocksStat(s: item.element, compact: compact)
            }
        }
    }
}

private struct BlocksStat: View {
    var s: JSONValue
    var compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(s.str("label") ?? "").font(.system(size: 12.5)).foregroundStyle(Theme.ink2).lineLimit(1)
            Text(s.str("value") ?? "")
                .font(.system(size: compact ? 21 : 26, weight: .bold).monospacedDigit())
                .tracking(-0.5)
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            BlocksStatFoot(s: s)
        }
        .padding(compact ? 10 : 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .blocksCard(radius: 18, compact: compact)
        .accessibilityElement(children: .combine)
    }
}

private struct BlocksStatFoot: View {
    var s: JSONValue

    var body: some View {
        let trend = s.str("trend")
        let delta = s.str("delta")
        let note = s.str("note")
        if delta != nil || note != nil {
            VStack(alignment: .leading, spacing: 1) {
                if let delta {
                    HStack(spacing: 2) {
                        if let trend {
                            Image(systemName: arrow(trend)).font(.system(size: 10, weight: .semibold))
                        }
                        Text(delta).font(.system(size: 12.5, weight: .medium))
                    }
                    .foregroundStyle(color(trend))
                }
                if let note {
                    Text(note).font(.system(size: 12.5)).foregroundStyle(Theme.ink3).multilineTextAlignment(.leading)
                }
            }
            .padding(.top, 2)
        }
    }

    private func arrow(_ trend: String) -> String {
        if trend == "up" { return "arrow.up.right" }
        if trend == "down" { return "arrow.down.right" }
        return "arrow.right"
    }

    private func color(_ trend: String?) -> Color {
        if trend == "up" { return Theme.good }
        if trend == "down" { return Theme.danger }
        return Theme.ink2
    }
}

// MARK: Table

/// A table that fills the width when it fits and scrolls sideways inside its card when it does not.
struct BlocksTable: View {
    var d: JSONValue
    var compact: Bool

    var body: some View {
        let model = BlocksTableModel(d)
        if !model.columns.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ViewThatFits(in: .horizontal) {
                    BlocksTableGrid(model: model, flexible: true)
                    ScrollView(.horizontal, showsIndicators: false) {
                        BlocksTableGrid(model: model, flexible: false)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .blocksCard(radius: 18, compact: compact)
                if let caption = d.str("caption") {
                    Text(caption).font(.system(size: 12.5)).foregroundStyle(Theme.ink3).padding(.horizontal, 4)
                }
            }
        }
    }
}

struct BlocksTableModel {
    var columns: [String] = []
    var rows: [[String]] = []
    /// Which cells were numbers (drawn with even-width digits).
    var numeric: [[Bool]] = []
    var highlight: Int = -1
    var widths: [CGFloat] = []

    init(_ d: JSONValue) {
        columns = d.list("columns").map { $0.text ?? "" }
        let count = columns.count
        if count == 0 { return }
        for r in d.list("rows") {
            guard let cells = r.array else { continue }
            var texts: [String] = []
            var nums: [Bool] = []
            for i in 0..<count {
                let cell: JSONValue? = i < cells.count ? cells[i] : nil
                texts.append(cell?.text ?? "")
                nums.append(cell?.double != nil)
            }
            rows.append(texts)
            numeric.append(nums)
        }
        if let h = d["highlight_column"]?.double, h >= 0, h < Double(count) { highlight = Int(h) }
        // A column is as wide as its heading (which never wraps) or about 26 characters of its cells.
        for i in 0..<count {
            var longest = 0
            for r in rows { longest = max(longest, min(r[i].count, 26)) }
            let head = CGFloat(columns[i].count) * 8.2
            let body = CGFloat(longest) * 7.4
            widths.append(min(max(max(head, body) + 28, 60), 240))
        }
    }
}

private struct BlocksTableGrid: View {
    var model: BlocksTableModel
    var flexible: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BlocksTableRow(cells: model.columns, numeric: [], model: model, header: true, flexible: flexible)
            ForEach(Array(model.rows.enumerated()), id: \.offset) { item in
                BlocksTableRow(cells: item.element, numeric: model.numeric[item.offset], model: model, header: false, flexible: flexible)
                    .overlay(alignment: .top) {
                        Rectangle().fill(Theme.line).frame(height: 1)
                    }
            }
        }
    }
}

private struct BlocksTableRow: View {
    var cells: [String]
    var numeric: [Bool]
    var model: BlocksTableModel
    var header: Bool
    var flexible: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { item in
                BlocksTableCell(
                    text: item.element,
                    width: item.offset < model.widths.count ? model.widths[item.offset] : 100,
                    header: header,
                    first: item.offset == 0,
                    numeric: item.offset < numeric.count ? numeric[item.offset] : false,
                    highlighted: item.offset == model.highlight,
                    flexible: flexible
                )
            }
        }
        // Every cell in a row is as tall as the tallest, so a highlighted column is unbroken.
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct BlocksTableCell: View {
    var text: String
    var width: CGFloat
    var header: Bool
    var first: Bool
    var numeric: Bool
    var highlighted: Bool
    var flexible: Bool

    var body: some View {
        label
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14)
            .padding(.top, header ? 12 : 10)
            .padding(.bottom, header ? 8 : 10)
            .frame(minWidth: width, idealWidth: width, maxWidth: flexible ? .infinity : width, maxHeight: .infinity, alignment: .topLeading)
            .background(highlighted ? Theme.accentSoft : Color.clear)
    }

    private var label: Text {
        if header {
            return Text(text.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.5)
                .foregroundColor(highlighted ? Theme.accent : Theme.ink3)
        }
        let font = Font.system(size: 14, weight: first ? .medium : .regular)
        return Text(text)
            .font(numeric ? font.monospacedDigit() : font)
            .foregroundColor(first || highlighted ? Theme.ink : Theme.ink2)
    }
}

// MARK: Timeline

struct BlocksTimeline: View {
    var d: JSONValue
    var compact: Bool

    var body: some View {
        let items = d.list("items")
        VStack(alignment: .leading, spacing: compact ? 12 : 16) {
            ForEach(Array(items.enumerated()), id: \.offset) { item in
                BlocksTimelineRow(t: item.element, compact: compact)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .leading) {
            if items.count > 1 {
                Rectangle().fill(Theme.fill2).frame(width: 1).padding(.vertical, 12).padding(.leading, 5)
            }
        }
    }
}

private struct BlocksTimelineRow: View {
    var t: JSONValue
    var compact: Bool

    var body: some View {
        let title = t.str("title") ?? ""
        let url = t.str("url")
        HStack(alignment: .top, spacing: compact ? 12 : 16) {
            Circle()
                .fill(Theme.accent)
                .frame(width: 7, height: 7)
                .padding(2)
                .background(Theme.solid, in: Circle())
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 1) {
                if let when = t.str("when") {
                    Text(when).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Theme.ink3)
                }
                BlocksLink(url: url, label: title) {
                    Text(title)
                        .font(.system(size: compact ? 14 : 15, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let text = t.str("text") {
                    Text(text)
                        .font(.system(size: compact ? 13 : 14))
                        .foregroundStyle(Theme.ink2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: Callout

struct BlocksCallout: View {
    var d: JSONValue
    var compact: Bool

    var body: some View {
        let tone = d.str("tone") ?? "info"
        HStack(alignment: .top, spacing: compact ? 9 : 12) {
            Image(systemName: icon(tone))
                .font(.system(size: compact ? 14 : 16))
                .foregroundStyle(ink(tone))
                .padding(.top, 2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                if let title = d.str("title") {
                    Text(title).font(.system(size: compact ? 14 : 15, weight: .semibold)).foregroundStyle(Theme.ink)
                }
                Text(d.str("text") ?? "")
                    .font(.system(size: compact ? 13.5 : 14.5))
                    .lineSpacing(compact ? 2 : 4)
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(compact ? 12 : 16)
        .background(tint(tone), in: RoundedRectangle(cornerRadius: compact ? 14 : 18, style: .continuous))
    }

    private func icon(_ tone: String) -> String {
        switch tone {
        case "good": return "hand.thumbsup"
        case "warn": return "exclamationmark.circle"
        case "decision": return "scalemass"
        default: return "info.circle"
        }
    }

    private func ink(_ tone: String) -> Color {
        switch tone {
        case "good": return Theme.good
        case "warn": return Theme.warn
        case "decision": return Theme.accent
        default: return Theme.ink2
        }
    }

    private func tint(_ tone: String) -> Color {
        switch tone {
        case "good": return Theme.good.opacity(0.13)
        case "warn": return Theme.warn.opacity(0.16)
        case "decision": return Theme.accentSoft
        default: return Theme.fill
        }
    }
}

// MARK: For and against

struct BlocksProsCons: View {
    var d: JSONValue
    var compact: Bool
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        let pros = blocksStrings(d.list("pros"))
        let cons = blocksStrings(d.list("cons"))
        if compact || sizeClass == .compact {
            VStack(alignment: .leading, spacing: 10) {
                if !pros.isEmpty { BlocksProsColumn(items: pros, good: true, compact: compact) }
                if !cons.isEmpty { BlocksProsColumn(items: cons, good: false, compact: compact) }
            }
        } else {
            HStack(alignment: .top, spacing: 10) {
                if !pros.isEmpty { BlocksProsColumn(items: pros, good: true, compact: compact) }
                if !cons.isEmpty { BlocksProsColumn(items: cons, good: false, compact: compact) }
            }
        }
    }
}

private struct BlocksProsColumn: View {
    var items: [String]
    var good: Bool
    var compact: Bool

    var body: some View {
        let color = good ? Theme.good : Theme.danger
        VStack(alignment: .leading, spacing: 6) {
            Text(good ? "FOR" : "AGAINST")
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(color)
                .accessibilityLabel(good ? "For" : "Against")
            ForEach(Array(items.enumerated()), id: \.offset) { item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: good ? "checkmark" : "minus")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(color)
                        .frame(width: 14)
                        .accessibilityHidden(true)
                    Text(item.element)
                        .font(.system(size: compact ? 13.5 : 14))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(compact ? 12 : 14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .blocksCard(radius: 18, compact: compact)
    }
}

// MARK: Sources

struct BlocksSources: View {
    var d: JSONValue
    var compact: Bool

    var body: some View {
        let items = d.list("items")
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { item in
                BlocksSourceRow(s: item.element, number: item.offset + 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BlocksSourceRow: View {
    var s: JSONValue
    var number: Int

    var body: some View {
        let title = s.str("title") ?? ""
        let url = s.str("url") ?? ""
        let parts = [s.str("publisher") ?? BlocksFormat.host(url), s.str("date") ?? ""].filter { !$0.isEmpty }
        let tail = parts.isEmpty ? "" : " \u{00B7} " + parts.joined(separator: " \u{00B7} ")
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.system(size: 13.5).monospacedDigit())
                .foregroundStyle(Theme.ink3)
                .frame(width: 20, alignment: .trailing)
            BlocksLink(url: url, label: title) {
                VStack(alignment: .leading, spacing: 1) {
                    (Text(title).fontWeight(.medium).foregroundColor(Theme.ink).underline(true, color: Theme.fill2)
                        + Text(tail).foregroundColor(Theme.ink3))
                        .font(.system(size: 13.5))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if let note = s.str("note") {
                        Text(note)
                            .font(.system(size: 13.5))
                            .foregroundStyle(Theme.ink2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
        }
    }
}

// MARK: Facts

struct BlocksFacts: View {
    var d: JSONValue
    var compact: Bool

    var body: some View {
        let items = d.list("items")
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { item in
                if item.offset > 0 {
                    Rectangle().fill(Theme.line).frame(height: 1)
                }
                BlocksFactRow(f: item.element, compact: compact)
            }
        }
        .padding(.horizontal, compact ? 12 : 14)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .blocksCard(radius: 18, compact: compact)
    }
}

private struct BlocksFactRow: View {
    var f: JSONValue
    var compact: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: compact ? 10 : 16) {
            Text(f.str("label") ?? "")
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: compact ? 88 : 116, alignment: .leading)
            Text(f.str("value") ?? "")
                .fontWeight(.medium)
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.system(size: compact ? 13 : 14))
        .padding(.vertical, compact ? 6 : 8)
        .accessibilityElement(children: .combine)
    }
}

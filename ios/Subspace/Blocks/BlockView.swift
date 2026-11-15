import SwiftUI

/// Draws one page block from its JSON object (see src/lib/blocks.ts). `compact` is the narrow
/// Now rail. Anything unknown or malformed draws nothing.
struct BlockView: View {
    var block: JSONValue
    var compact: Bool

    init(block: JSONValue, compact: Bool = false) {
        self.block = block
        self.compact = compact
    }

    var body: some View {
        let type = block["type"]?.string ?? ""
        if type == "text" {
            BlocksTextBlock(markdown: block["markdown"]?.string ?? "", compact: compact)
        } else if blocksTypeNames.contains(type) {
            VStack(alignment: .leading, spacing: 10) {
                if type != "callout", let title = block.str("title") {
                    BlocksSectionTitle(text: title)
                }
                BlocksBody(type: type, d: block, compact: compact)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("blocks.block.\(type)")
        }
    }
}

private struct BlocksBody: View {
    var type: String
    var d: JSONValue
    var compact: Bool

    var body: some View {
        switch type {
        case "cards": BlocksCards(d: d, compact: compact)
        case "map": BlocksMap(d: d, compact: compact)
        case "columns": BlocksColumns(d: d, compact: compact)
        case "stats": BlocksStats(d: d, compact: compact)
        case "table": BlocksTable(d: d, compact: compact)
        case "timeline": BlocksTimeline(d: d, compact: compact)
        case "callout": BlocksCallout(d: d, compact: compact)
        case "proscons": BlocksProsCons(d: d, compact: compact)
        case "chart": BlocksChart(d: d, compact: compact)
        case "sources": BlocksSources(d: d, compact: compact)
        case "gallery": BlocksGallery(d: d, compact: compact)
        case "facts": BlocksFacts(d: d, compact: compact)
        default: EmptyView()
        }
    }
}

/// The small upper-case heading over a block.
struct BlocksSectionTitle: View {
    var text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 13, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(Theme.ink3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A run of markdown inside columns.
private struct BlocksTextBlock: View {
    var markdown: String
    var compact: Bool

    var body: some View {
        if !markdown.isEmpty {
            BlocksDocument(nodes: BlocksParser.parse(markdown, depth: 3), size: compact ? 13.5 : 15, compact: compact, quoted: false)
        }
    }
}

/// Columns side by side on a wide screen, stacked on a phone and in the rail.
private struct BlocksColumns: View {
    var d: JSONValue
    var compact: Bool
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        let columns = d.list("columns")
        if compact || sizeClass == .compact {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(Array(columns.enumerated()), id: \.offset) { item in
                    BlocksColumn(blocks: item.element.array ?? [], compact: compact)
                }
            }
        } else {
            HStack(alignment: .top, spacing: 16) {
                ForEach(Array(columns.enumerated()), id: \.offset) { item in
                    BlocksColumn(blocks: item.element.array ?? [], compact: compact)
                }
            }
        }
    }
}

private struct BlocksColumn: View {
    var blocks: [JSONValue]
    var compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { item in
                // Columns never nest.
                if item.element["type"]?.string != "columns" {
                    BlockView(block: item.element, compact: compact)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

// MARK: Shared pieces

private struct BlocksCardSurface: ViewModifier {
    var radius: CGFloat
    var compact: Bool

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: compact ? min(radius, 14) : radius, style: .continuous)
        if compact {
            content.background(Theme.fill, in: shape).clipShape(shape)
        } else {
            content
                .background(Theme.solid.opacity(0.78), in: shape)
                .clipShape(shape)
                .overlay(shape.strokeBorder(Theme.line, lineWidth: 1))
        }
    }
}

extension View {
    /// The quiet card behind a block (`.block-card` on the web; plain fill in the rail).
    func blocksCard(radius: CGFloat = 18, compact: Bool) -> some View {
        modifier(BlocksCardSurface(radius: radius, compact: compact))
    }
}

/// A picture that is a soft gradient tile with an initial when there is no image.
struct BlocksPicture: View {
    var src: String?
    var label: String

    var body: some View {
        if let src, !src.isEmpty {
            RemoteImage(src)
        } else {
            let seed = stableHash(label)
            let p = Palette.forSeed(seed)
            ZStack {
                MeshView(seed: seed, palette: p)
                Text(String(label.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(p.inkColor)
            }
            .accessibilityHidden(true)
        }
    }
}

/// Wraps content in a button that opens `url`, or leaves it as it is when there is none.
struct BlocksLink<Content: View>: View {
    var url: String?
    var label: String
    @ViewBuilder var content: () -> Content

    @Environment(AppModel.self) private var app

    var body: some View {
        if let url, !url.isEmpty {
            Button {
                app.open(url)
            } label: {
                content()
            }
            .buttonStyle(PressStyle(scale: 0.98))
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isLink)
        } else {
            content()
        }
    }
}

enum BlocksFormat {
    /// "nostrana.com" from a web address.
    static func host(_ url: String) -> String {
        guard let h = URLComponents(string: url)?.host else { return "" }
        return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
    }

    /// "$" goes in front, "%" or "km" behind, and "$B" splits into both: $2B.
    static func value(_ v: Double, unit: String) -> String {
        var number: String
        if abs(v) >= 1000 {
            number = v.formatted(.number.precision(.fractionLength(0)))
        } else {
            let r = (v * 100).rounded() / 100
            number = r == r.rounded() ? String(Int(r)) : String(r)
        }
        if number == "-0" { number = "0" }
        var front = ""
        var back = unit
        if let first = unit.first, "$£€¥".contains(first) {
            front = String(first)
            back = String(unit.dropFirst())
        }
        return front + number + back
    }
}

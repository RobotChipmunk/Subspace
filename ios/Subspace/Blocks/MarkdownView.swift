import SwiftUI

/// A stored markdown document, read-only: text, lists, quotes, pictures, code and page blocks.
/// It takes the width it is given and is as tall as its content.
struct MarkdownView: View {
    private let nodes: [BlocksNode]

    init(markdown: String) {
        nodes = BlocksParser.parse(markdown)
    }

    var body: some View {
        BlocksDocument(nodes: nodes, size: 16, compact: false, quoted: false)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("blocks.document")
    }
}

/// A run of parsed nodes, one under the other. Also draws the `text` block inside columns.
struct BlocksDocument: View {
    let nodes: [BlocksNode]
    var size: CGFloat
    var compact: Bool
    var quoted: Bool

    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(nodes.enumerated()), id: \.offset) { item in
                BlocksNodeView(node: item.element, size: size, compact: compact, quoted: quoted)
                    .padding(.top, gap(item.offset))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tint(Theme.accent)
        .environment(\.openURL, OpenURLAction { url in
            app.open(url.absoluteString)
            return .handled
        })
    }

    private func gap(_ index: Int) -> CGFloat {
        if index == 0 { return 0 }
        switch nodes[index] {
        case .heading: return size * 1.05
        case .block: return 14
        case .paragraph, .list, .quote, .rule, .image, .code:
            if case .block = nodes[index - 1] { return 14 }
            return size * 0.55
        }
    }
}

private struct BlocksNodeView: View {
    let node: BlocksNode
    var size: CGFloat
    var compact: Bool
    var quoted: Bool

    var body: some View {
        switch node {
        case .heading(let level, let text):
            BlocksHeadingText(level: level, text: text, size: size)
        case .paragraph(let text):
            BlocksText(raw: text, size: size, color: quoted ? Theme.ink2 : Theme.ink)
        case .list(let items):
            BlocksList(items: items, size: size, quoted: quoted)
        case .quote(let inner):
            BlocksDocument(nodes: inner, size: size, compact: compact, quoted: true)
                .padding(.leading, 17)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1.5).fill(Theme.fill2).frame(width: 3)
                }
        case .rule:
            Rectangle().fill(Theme.line).frame(height: 1).padding(.vertical, size * 0.8)
        case .image(_, let url):
            BlocksDocImage(url: url)
        case .code(let code):
            BlocksCode(code: code, size: size)
        case .block(let value):
            BlockView(block: value, compact: compact)
        }
    }
}

/// One paragraph of inline-styled text.
struct BlocksText: View {
    var raw: String
    var size: CGFloat
    var color: Color = Theme.ink

    var body: some View {
        Text(BlocksInline.attributed(raw))
            .font(.system(size: size))
            .lineSpacing(size * 0.26)
            .foregroundStyle(color)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BlocksHeadingText: View {
    var level: Int
    var text: String
    var size: CGFloat

    var body: some View {
        // The web editor: h1 1.5em, h2 1.22em, h3 and below 1.05em. Small prose keeps headings near body size.
        let small = size < 16
        let scale: CGFloat = small ? 1.08 : (level <= 1 ? 1.5 : (level == 2 ? 1.22 : 1.05))
        Text(BlocksInline.attributed(text))
            .font(.system(size: size * scale, weight: .semibold))
            .tracking(level <= 2 && !small ? -0.3 : 0)
            .foregroundStyle(Theme.ink)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct BlocksList: View {
    var items: [BlocksListItem]
    var size: CGFloat
    var quoted: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: size * 0.3) {
            ForEach(Array(items.enumerated()), id: \.offset) { item in
                BlocksListRow(item: item.element, size: size, quoted: quoted)
                    .padding(.leading, CGFloat(item.element.level) * 20)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BlocksListRow: View {
    var item: BlocksListItem
    var size: CGFloat
    var quoted: Bool

    var body: some View {
        switch item.marker {
        case .bullet:
            marked("\u{2022}")
        case .number(let n):
            marked(n + ".")
        case .task(let done):
            task(done)
        }
    }

    private func marked(_ sign: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(sign)
                .font(.system(size: size).monospacedDigit())
                .foregroundStyle(Theme.ink3)
                .frame(minWidth: 14, alignment: .trailing)
            BlocksText(raw: item.text, size: size, color: quoted ? Theme.ink2 : Theme.ink)
        }
    }

    private func task(_ done: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            BlocksCheck(done: done).padding(.top, max(0, (size * 1.26 - 18) / 2 + 1))
            BlocksText(raw: item.text, size: size, color: done ? Theme.ink3 : (quoted ? Theme.ink2 : Theme.ink))
                .strikethrough(done, color: Theme.ink3)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(done ? "blocks.task.done" : "blocks.task.open")
    }
}

/// A read-only check mark, drawn like the editor's task box.
private struct BlocksCheck: View {
    var done: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        ZStack {
            if done {
                shape.fill(Theme.accent)
                Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Color.white)
            } else {
                shape.strokeBorder(Theme.ink3, lineWidth: 1.5)
            }
        }
        .frame(width: 18, height: 18)
        .accessibilityLabel(done ? "Done" : "Not done")
    }
}

private struct BlocksCode: View {
    var code: String
    var size: CGFloat

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(code)
                .font(.system(size: size * 0.88, design: .monospaced))
                .foregroundStyle(Theme.ink)
                .fixedSize()
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// A picture in the text: rounded, at its own shape once that is known.
private struct BlocksDocImage: View {
    var url: String
    @State private var ratio: CGFloat = 16.0 / 9.0

    var body: some View {
        // Very tall pictures are cropped rather than left to fill the screen.
        let shown = min(max(ratio, 0.7), 4)
        RemoteImage(url, contentMode: .fill, onRatio: { r in
            if r > 0 { ratio = r }
        })
        .aspectRatio(shown, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

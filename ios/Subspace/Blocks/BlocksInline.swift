import SwiftUI

/// Inline markdown (bold, italic, code, links, strikethrough) as attributed text, with the
/// text an agent wrote (`<ins data-agent=…>`) marked the way the web editor marks it.
enum BlocksInline {
    private struct Segment {
        var text: String
        var marked: Bool
    }

    static func attributed(_ raw: String) -> AttributedString {
        var out = AttributedString()
        for seg in segments(raw) {
            var piece = styled(seg.text)
            if seg.marked {
                piece.swiftUI.backgroundColor = Theme.ai
                piece.swiftUI.underlineStyle = Text.LineStyle(pattern: .solid, color: Theme.aiLine)
            }
            out.append(piece)
        }
        return out
    }

    /// The text with every tag and markdown sign removed, for labels.
    static func plain(_ raw: String) -> String {
        String(attributed(raw).characters)
    }

    /// True when any of the text was written by an agent.
    static func hasMarks(_ raw: String) -> Bool {
        raw.contains("<ins")
    }

    private static func segments(_ raw: String) -> [Segment] {
        if !raw.contains("<") { return [Segment(text: raw, marked: false)] }
        guard let re = try? NSRegularExpression(pattern: "<ins\\b[^>]*>|</ins>", options: [.caseInsensitive]) else {
            return [Segment(text: raw, marked: false)]
        }
        let ns = raw as NSString
        var out: [Segment] = []
        var at = 0
        var depth = 0
        for m in re.matches(in: raw, range: NSRange(location: 0, length: ns.length)) {
            if m.range.location > at {
                let text = ns.substring(with: NSRange(location: at, length: m.range.location - at))
                out.append(Segment(text: text, marked: depth > 0))
            }
            let tag = ns.substring(with: m.range)
            if tag.hasPrefix("</") { depth = max(0, depth - 1) } else { depth += 1 }
            at = m.range.location + m.range.length
        }
        if at < ns.length {
            out.append(Segment(text: ns.substring(from: at), marked: depth > 0))
        }
        return out
    }

    private static func styled(_ text: String) -> AttributedString {
        if text.isEmpty { return AttributedString() }
        let options = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: false,
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        guard var a = try? AttributedString(markdown: text, options: options) else {
            return AttributedString(text)
        }
        var codeRanges: [Range<AttributedString.Index>] = []
        for run in a.runs {
            if let intent = run.inlinePresentationIntent, intent.contains(.code) {
                codeRanges.append(run.range)
            }
        }
        for r in codeRanges {
            a[r].swiftUI.backgroundColor = Theme.fill
        }
        return a
    }
}

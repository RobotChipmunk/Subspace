import Foundation

/// The block types of src/lib/blocks.ts, in the same order.
let blocksTypeNames: [String] = ["cards", "map", "columns", "stats", "table", "timeline", "callout", "proscons", "chart", "sources", "gallery", "facts"]

/// How a list row starts.
enum BlocksListMarker {
    case bullet
    case number(String)
    case task(Bool)
}

struct BlocksListItem {
    var level: Int
    var marker: BlocksListMarker
    var text: String
}

/// One piece of a stored markdown document.
indirect enum BlocksNode {
    case heading(level: Int, text: String)
    case paragraph(String)
    case list([BlocksListItem])
    case quote([BlocksNode])
    case rule
    case image(alt: String, url: String)
    case code(String)
    /// A page block: its JSON object, with "type" filled in.
    case block(JSONValue)
}

/// A forgiving, line-based markdown reader. It never fails: anything it does not understand
/// becomes a paragraph.
enum BlocksParser {
    static func parse(_ markdown: String, depth: Int = 0) -> [BlocksNode] {
        let normal = markdown.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = normal.components(separatedBy: "\n")
        var out: [BlocksNode] = []
        var para: [String] = []
        var i = 0

        func flush() {
            if !para.isEmpty {
                out.append(.paragraph(joinParagraph(para)))
                para = []
            }
        }

        while i < lines.count {
            let line = lines[i]
            let bare = stripMarks(line)
            let trimmed = bare.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty {
                flush()
                i += 1
                continue
            }

            // Fenced code, or a page block.
            if let fence = openFence(bare) {
                flush()
                var body: [String] = []
                i += 1
                while i < lines.count && !closesFence(stripMarks(lines[i]), fence) {
                    body.append(lines[i])
                    i += 1
                }
                i += 1
                let text = body.joined(separator: "\n")
                if blocksTypeNames.contains(fence.lang), let value = JSONValue.parse(text), case .object(var obj) = value {
                    obj["type"] = .string(fence.lang)
                    out.append(.block(.object(obj)))
                } else {
                    out.append(.code(text))
                }
                continue
            }

            if let h = heading(line) {
                flush()
                out.append(.heading(level: h.level, text: h.text))
                i += 1
                continue
            }

            if isRule(trimmed) {
                flush()
                out.append(.rule)
                i += 1
                continue
            }

            if let img = image(trimmed) {
                flush()
                out.append(.image(alt: img.alt, url: img.url))
                i += 1
                continue
            }

            if trimmed.hasPrefix(">") {
                flush()
                var inner: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if !t.hasPrefix(">") { break }
                    var rest = String(t.dropFirst())
                    if rest.hasPrefix(" ") { rest = String(rest.dropFirst()) }
                    inner.append(rest)
                    i += 1
                }
                let text = inner.joined(separator: "\n")
                if depth < 4 {
                    out.append(.quote(parse(text, depth: depth + 1)))
                } else {
                    out.append(.quote([.paragraph(text)]))
                }
                continue
            }

            // A pipe table: a header row, then a row of dashes.
            if trimmed.hasPrefix("|"), i + 1 < lines.count, isTableRule(lines[i + 1]) {
                flush()
                let columns = tableCells(trimmed)
                var rows: [JSONValue] = []
                i += 2
                while i < lines.count {
                    let t = stripMarks(lines[i]).trimmingCharacters(in: .whitespaces)
                    if !t.hasPrefix("|") { break }
                    var cells = tableCells(t)
                    while cells.count < columns.count { cells.append("") }
                    if cells.count > columns.count { cells = Array(cells.prefix(columns.count)) }
                    rows.append(.array(cells.map { JSONValue.string($0) }))
                    i += 1
                }
                let table: [String: JSONValue] = [
                    "type": .string("table"),
                    "columns": .array(columns.map { JSONValue.string($0) }),
                    "rows": .array(rows),
                ]
                out.append(.block(.object(table)))
                continue
            }

            if listItem(line) != nil {
                flush()
                var items: [BlocksListItem] = []
                var indents: [Int] = []
                while i < lines.count {
                    let l = lines[i]
                    if let it = listItem(l) {
                        while let last = indents.last, last > it.indent { indents.removeLast() }
                        if indents.isEmpty { indents.append(it.indent) }
                        else if let last = indents.last, last < it.indent { indents.append(it.indent) }
                        items.append(BlocksListItem(level: min(indents.count - 1, 5), marker: it.marker, text: it.text))
                        i += 1
                        continue
                    }
                    let t = l.trimmingCharacters(in: .whitespaces)
                    if t.isEmpty {
                        // A blank line ends the list unless another item follows it.
                        var j = i + 1
                        while j < lines.count && lines[j].trimmingCharacters(in: .whitespaces).isEmpty { j += 1 }
                        if j < lines.count, listItem(lines[j]) != nil {
                            i = j
                            continue
                        }
                        break
                    }
                    // An indented line continues the item above it.
                    let indented = l.hasPrefix(" ") || l.hasPrefix("\t")
                    let startsOther = openFence(stripMarks(l)) != nil || heading(l) != nil || t.hasPrefix(">") || isRule(stripMarks(t))
                    if indented, !startsOther, !items.isEmpty {
                        items[items.count - 1].text += " " + t
                        i += 1
                        continue
                    }
                    break
                }
                out.append(.list(items))
                continue
            }

            para.append(line)
            i += 1
        }
        flush()
        return out
    }

    // MARK: Line shapes

    /// The line without agent marks, for recognising its shape.
    static func stripMarks(_ line: String) -> String {
        if !line.contains("<") { return line }
        var s = line.replacingOccurrences(of: "<ins\\b[^>]*>", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "</ins>", with: "")
        return s
    }

    private static func joinParagraph(_ lines: [String]) -> String {
        var out = ""
        for (n, raw) in lines.enumerated() {
            var line = raw
            var hard = false
            if line.hasSuffix("\\") {
                hard = true
                line = String(line.dropLast())
            } else if line.hasSuffix("  ") {
                hard = true
            }
            let t = line.trimmingCharacters(in: .whitespaces)
            out += t
            if n < lines.count - 1 { out += hard ? "\n" : " " }
        }
        return out
    }

    private static func leading(_ line: String) -> (indent: Int, rest: Substring) {
        var indent = 0
        var idx = line.startIndex
        while idx < line.endIndex {
            let c = line[idx]
            if c == " " { indent += 1 }
            else if c == "\t" { indent += 4 }
            else { break }
            idx = line.index(after: idx)
        }
        return (indent, line[idx...])
    }

    private static func openFence(_ line: String) -> (char: Character, count: Int, lang: String)? {
        let lead = leading(line)
        if lead.indent > 3 { return nil }
        guard let first = lead.rest.first, first == "`" || first == "~" else { return nil }
        var count = 0
        for c in lead.rest {
            if c == first { count += 1 } else { break }
        }
        if count < 3 { return nil }
        let info = lead.rest.dropFirst(count).trimmingCharacters(in: .whitespaces)
        if first == "`" && info.contains("`") { return nil }
        let lang = info.components(separatedBy: .whitespaces).first ?? ""
        return (first, count, lang.lowercased())
    }

    private static func closesFence(_ line: String, _ fence: (char: Character, count: Int, lang: String)) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        if t.count < fence.count { return false }
        for c in t {
            if c != fence.char { return false }
        }
        return true
    }

    private static func heading(_ line: String) -> (level: Int, text: String)? {
        let lead = leading(line)
        if lead.indent > 3 { return nil }
        var level = 0
        for c in lead.rest {
            if c == "#" { level += 1 } else { break }
        }
        if level < 1 || level > 6 { return nil }
        let rest = lead.rest.dropFirst(level)
        guard let next = rest.first else { return nil }
        if next != " " && next != "\t" { return nil }
        var text = rest.trimmingCharacters(in: .whitespaces)
        // Closing hashes ("## Title ##") are decoration.
        while text.hasSuffix("#") { text = String(text.dropLast()) }
        text = text.trimmingCharacters(in: .whitespaces)
        if stripMarks(text).trimmingCharacters(in: .whitespaces).isEmpty { return nil }
        return (level, text)
    }

    private static func isRule(_ trimmed: String) -> Bool {
        guard let first = trimmed.first, first == "-" || first == "*" || first == "_" else { return false }
        var count = 0
        for c in trimmed {
            if c == first { count += 1 }
            else if c != " " && c != "\t" { return false }
        }
        return count >= 3
    }

    private static func image(_ trimmed: String) -> (alt: String, url: String)? {
        guard trimmed.hasPrefix("!["), trimmed.hasSuffix(")") else { return nil }
        guard let mid = trimmed.range(of: "](") else { return nil }
        let alt = String(trimmed[trimmed.index(trimmed.startIndex, offsetBy: 2)..<mid.lowerBound])
        if alt.contains("]") { return nil }
        let inside = String(trimmed[mid.upperBound...].dropLast())
        if inside.contains(")") { return nil }
        // The address may be followed by a quoted title.
        var url = inside.trimmingCharacters(in: .whitespaces).components(separatedBy: .whitespaces).first ?? ""
        if url.hasPrefix("<") && url.hasSuffix(">") && url.count >= 2 { url = String(url.dropFirst().dropLast()) }
        if url.isEmpty { return nil }
        return (alt, url)
    }

    private static func listItem(_ line: String) -> (indent: Int, marker: BlocksListMarker, text: String)? {
        let lead = leading(line)
        let rest = lead.rest
        guard let first = rest.first else { return nil }
        var after: Substring
        var marker: BlocksListMarker
        if first == "-" || first == "*" || first == "+" {
            after = rest.dropFirst()
            marker = .bullet
        } else if first.isNumber {
            var digits = ""
            for c in rest {
                if c.isNumber { digits.append(c) } else { break }
            }
            if digits.count > 9 { return nil }
            after = rest.dropFirst(digits.count)
            guard let dot = after.first, dot == "." || dot == ")" else { return nil }
            after = after.dropFirst()
            marker = .number(digits)
        } else {
            return nil
        }
        // The marker must be followed by a space, or end the line.
        if let c = after.first {
            if c != " " && c != "\t" { return nil }
        }
        var text = after.trimmingCharacters(in: .whitespaces)
        if case .bullet = marker {
            if isRule(String(rest).trimmingCharacters(in: .whitespaces)) { return nil }
            let lower = text.lowercased()
            if lower.hasPrefix("[ ]") || lower.hasPrefix("[x]") {
                let tail = text.dropFirst(3)
                if tail.isEmpty || tail.hasPrefix(" ") || tail.hasPrefix("\t") {
                    marker = .task(lower.hasPrefix("[x]"))
                    text = tail.trimmingCharacters(in: .whitespaces)
                }
            }
        }
        return (lead.indent, marker, text)
    }

    private static func isTableRule(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        if !t.contains("-") || !t.contains("|") { return false }
        for c in t {
            if c != "|" && c != "-" && c != ":" && c != " " && c != "\t" { return false }
        }
        return true
    }

    private static func tableCells(_ trimmed: String) -> [String] {
        var t = trimmed
        if t.hasPrefix("|") { t = String(t.dropFirst()) }
        if t.hasSuffix("|") { t = String(t.dropLast()) }
        return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }
}

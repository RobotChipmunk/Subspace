import SwiftUI

/// An idea: a canvas the owner thinks on, and agents grow a little each day.
struct Idea: Decodable, Identifiable, Hashable {
    let id: String
    var title: String?
    /// "growing" or "resting".
    var state: String?
    var updated_at: String?
}

/// An idea as the first screen shows it: how full, how lately grown, and a few dots of its canvas.
struct IdeaCard: Decodable, Identifiable, Hashable {
    struct Dot: Decodable, Hashable {
        var x: Double
        var y: Double
        /// True for the owner's own pieces.
        var mine: Bool?
    }
    let id: String
    var title: String?
    var state: String?
    var items: Int?
    /// Pieces agents added that the owner has not looked at yet.
    var unseen: Int?
    var last_grown_at: String?
    var preview: [Dot]?
}

struct IdeaSource: Decodable, Hashable {
    var name: String?
    var url: String?
}

/// One piece on a canvas. `kind` is "text" or "image" for the owner's, and "riff", "found",
/// "counter", "question" or "image" for an agent's.
struct IdeaItem: Decodable, Identifiable, Hashable {
    let id: String
    var author: String?
    var kind: String?
    var text: String?
    var image: String?
    var source: IdeaSource?
    /// Where it sits, in points from the middle of the canvas.
    var x: Double
    var y: Double
    /// How large its words are drawn, 1 to 4.
    var size: Int?
    var kept: Bool?
    var seen: Bool?
}

/// A join between two pieces that belong together.
struct IdeaLink: Decodable, Identifiable, Hashable {
    let id: String
    var a: String
    var b: String
    var label: String?
    var author: String?
}

struct IdeasReply: Decodable {
    var ideas: [IdeaCard]?
}

struct IdeaCanvasReply: Decodable {
    var idea: Idea
    var items: [IdeaItem]?
    var links: [IdeaLink]?
}

struct IdeaMoreReply: Decodable {
    var to: [String]?
}

/// How large a piece of the owner's text is drawn, by its size from 1 to 4. Rounded, so it reads as written.
func ideaFont(_ size: Int?) -> Font {
    switch size ?? 2 {
    case 1: return .system(size: 15, weight: .regular, design: .rounded)
    case 3: return .system(size: 30, weight: .semibold, design: .rounded)
    case 4: return .system(size: 46, weight: .bold, design: .rounded)
    default: return .system(size: 20, weight: .medium, design: .rounded)
    }
}

/// The word an agent's piece carries for its kind.
func ideaKindWord(_ kind: String?) -> String? {
    switch kind {
    case "riff": return "riff"
    case "found": return "found"
    case "counter": return "but"
    case "question": return "?"
    default: return nil
    }
}

/// Reports each piece's size as laid out, so joins can stop at its edge.
struct IdeaSizeKey: PreferenceKey {
    static var defaultValue: [String: CGSize] = [:]
    static func reduce(value: inout [String: CGSize], nextValue: () -> [String: CGSize]) {
        value.merge(nextValue()) { _, new in new }
    }
}

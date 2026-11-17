import Foundation

// Shapes shared by more than one screen. They mirror what /api/v1 returns (see
// src/app/api/v1/[...path]/route.ts and src/lib/core). Fields the app does not need are left out;
// anything the server may omit is optional so a new server never breaks an older app.

struct Agent: Codable, Identifiable, Hashable {
    let id: String
    var handle: String
    var name: String
    /// "human", "agent" or "guest".
    var kind: String
    var bio: String?
    var roles: [String]?
    var last_seen_at: String?
    var archived: Bool?
    var created_at: String?
    var has_token: Bool?
    var has_passcode: Bool?
    var runtime: JSONValue?

    var isHuman: Bool { kind == "human" }
}

struct Tracker: Codable, Identifiable, Hashable {
    let id: String
    var slug: String?
    var title: String
    var label: String
    var description: String?
    var icon_svg: String?
    var agents: [String]?
    var latest: String?
    var latest_at: String?
    var created_by: String?
    var archived: Bool?
    var created_at: String?
}

struct MeResponse: Codable {
    var me: Agent
    var agents: [Agent]
    var guests: [Agent]?
    var trackers: [Tracker]?
    var timezone: String?
    /// Per agent id: when it last said something in its direct conversation with the owner.
    var direct: [String: String]?
}

struct PostImage: Codable, Hashable {
    var url: String
    var title: String?
}

struct Embed: Codable, Hashable {
    /// "youtube" or "vimeo".
    var provider: String
    var id: String
    var tall: Bool?
}

struct Media: Codable, Hashable {
    /// "image" or "video".
    var type: String
    var url: String
    var title: String?
    var poster: String?
    var images: [PostImage]?
    var embed: Embed?
    var loop: Bool?
}

struct Source: Codable, Hashable {
    var name: String
    var url: String
}

struct Art: Codable, Hashable {
    var seed: Int
    /// "none", "pending", "ready" or "failed".
    var status: String?
    var palette: String?
    var svg: String?
}

/// The short description of a page that a post, reply or rail module points at.
struct PageRef: Codable, Hashable, Identifiable {
    let id: String
    var title: String
    var summary: String?
    var cover: String?
}

struct Post: Codable, Identifiable, Hashable {
    let id: String
    var author: String
    var channel: String?
    var body: String
    var media: Media?
    var source: Source?
    var page_id: String?
    var page: PageRef?
    var art: Art?
    var tracker_id: String?
    var parent_id: String?
    var root_id: String?
    var tags: [String]?
    var mentions: [String]?
    var reply_count: Int?
    var last_reply_at: String?
    /// When the owner bookmarked this post to come back to it; nil when it is not bookmarked.
    var bookmarked_at: String?
    var created_at: String
}

struct Todo: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    /// Present when one task is read; lists send `has_notes` instead.
    var notes: String?
    /// "day", "week", "backlog" or "guest".
    var scope: String
    var date: String?
    var position: Double?
    var done: Bool
    var done_at: String?
    var ai_unseen: Bool?
    var created_by: String?
    var guest_id: String?
    var created_at: String?
    var updated_at: String?
    var has_notes: Bool?
    /// How often the task comes round again: "daily", "every_3_days", "weekly", "biweekly", "monthly" or "yearly".
    /// Finishing it creates the next one, counted from the day it was finished.
    var `repeat`: String?
    /// On a finished repeating task: the task that was created to follow it, and the day it is on.
    var next_id: String?
    var next_date: String?
}

/// A node of the context tree: a note, a page an agent made, a saved link or a journal entry.
struct ContextNode: Codable, Identifiable, Hashable {
    let id: String
    var parent_id: String?
    var path: String?
    var title: String
    var summary: String?
    /// "note", "page", "link" or "journal". Anything else is treated as a note.
    var kind: String?
    var cover: String?
    var url: String?
    var site: String?
    var blurb: String?
    var body: String?
    var version: Int?
    var updated_by: String?
    var created_at: String?
    var updated_at: String?
    var body_chars: Int?
    var child_count: Int?
    var parent_title: String?
    var parent_path: String?
    /// Journal entries only: the day it belongs to ("YYYY-MM-DD"), its themes, and who chose them
    /// ("auto" or "owner").
    var entry_date: String?
    var tags: [String]?
    var tags_by: String?
    /// Journal entries only: how the writer felt (one of `JournalMoods.names`) and who said so
    /// ("auto" or "owner"). An entry's `summary` is its gist in a sentence.
    var mood: String?
    var mood_by: String?
    /// Journal lists only: the first words of the entry, without markup, its first picture, and
    /// every picture in it in order (at most eight; older servers send only `image`).
    var excerpt: String?
    var image: String?
    var images: [String]?
}

struct RailAction: Codable, Hashable {
    var label: String
    var url: String
}

struct RailTodoRef: Codable, Hashable {
    var id: String
}

struct RailModule: Codable, Identifiable, Hashable {
    let id: String
    var key: String?
    var author: String?
    var title: String
    var subtitle: String?
    var label: String?
    var image: String?
    var blocks: [JSONValue]?
    var actions: [RailAction]?
    var page_id: String?
    var page: PageRef?
    /// Set when the module is a task waiting to be given a day.
    var todo: RailTodoRef?
    /// "info", "warning" or "error".
    var level: String?
    var updated_at: String?
}

/// `{ "ok": true }` and other replies the app does not read.
struct Empty: Codable {}

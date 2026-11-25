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
    /// What the owner lets this agent see and do; nil is everything.
    var access: AgentAccess?

    var isHuman: Bool { kind == "human" }
}

/// An agent's limits, as the server keeps them. A nil list means all of them.
struct AgentAccess: Codable, Hashable {
    var read_only: Bool?
    /// Parts of the app it can see: feed, todos, journal, following, pages, links, rail.
    var sections: [String]?
    /// Top-level sections of context it can see, by the first part of their path.
    var context: [String]?
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
    /// The agent a chat message goes to when it names nobody.
    var default_agent: String?
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

/// What the owner had on screen when they wrote a message to an agent: the screen ("todos"), and
/// the one thing open on it when there was one.
struct About: Codable, Hashable {
    var screen: String
    /// "post", "todo", "journal", "context", "page", "link", "tracker" or "idea".
    var type: String?
    var id: String?
    var title: String?
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
    /// A message from the owner to an agent: what was on their screen when they wrote it.
    var about: About?
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
    /// Short labels the lists can be narrowed to ("finance", "house"). At most six.
    var tags: [String]?
    /// The line of the plan the task is part of (a priority, or a part of one), and that line's name.
    var plan_id: String?
    var plan: String?
    /// The rail module this task is tied to, while that module exists: the one pointing at it, or
    /// the one it was kept from with "Later". Sent when one task is read.
    var rail: TodoRail?
}

/// What a task shows of the rail module it came from, so the owner can still act from the task.
struct TodoRail: Codable, Hashable {
    var id: String?
    var key: String?
    var author: String?
    var title: String?
    var label: String?
    var actions: [RailAction]?
    var page_id: String?
    /// True when the owner made this task of the module with "Later".
    var kept: Bool?
    /// What the owner sent the module's agent from one of its buttons, if they did.
    var sent: RailSent?
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
    /// The last day the note holds ("YYYY-MM-DD"), for what is only true for now; nil for what lasts.
    var until: String?
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

/// A module's button: a link (`url`), or an action sent back to the agent that raised the module (`send`).
struct RailAction: Codable, Hashable {
    var label: String
    var url: String?
    /// The word the agent gave this button; when set, tapping sends it to that agent.
    var send: String? = nil

    /// Where a link button goes; empty for one that sends.
    var link: String { url ?? "" }
    var sends: Bool { send != nil || url == nil }
}

/// What the owner sent a module's agent from one of its buttons.
struct RailSent: Codable, Hashable {
    var label: String?
    var send: String?
    var at: String?
    /// True once the agent has read far enough to have seen it.
    var picked_up: Bool?
}

/// The reply to tapping a module's button.
struct RailActedReply: Decodable {
    struct Sent: Decodable {
        struct To: Decodable { var name: String? }
        var label: String?
        var to: To?
    }
    var cleared: Bool?
    var sent: Sent?
}

struct RailTodoRef: Codable, Hashable {
    var id: String
}

/// The task in the owner's list that a rail module is about.
struct RailTaskRef: Codable, Hashable {
    var id: String
    var title: String?
}

/// A notification in the Now rail. It leaves the rail when the owner acts on it: taps any of its
/// buttons, opens its task, keeps it for later (it becomes a task) or dismisses it.
struct RailModule: Codable, Identifiable, Hashable {
    let id: String
    var key: String?
    var author: String?
    var title: String
    /// One sentence of detail, shown when the module is opened.
    var subtitle: String?
    /// A few words about timing, above the title.
    var label: String?
    /// The small picture at its front: one of a fixed set of names ("plane", "bed", "package"), or nil for the usual one.
    var icon: String?
    /// A real picture of the thing, shown small in place of the icon.
    var image: String?
    /// At most one small block, shown when the module is opened.
    var blocks: [JSONValue]?
    /// Its buttons. The first is the one thing to do, and shows before the module is opened.
    var actions: [RailAction]?
    var page_id: String?
    var page: PageRef?
    /// Set when the module is a task waiting to be given a day.
    var todo: RailTodoRef?
    /// The task this module is about, when an agent needs the owner to follow something up.
    var task: RailTaskRef?
    /// "info", "warning" or "error".
    var level: String?
    var updated_at: String?
}

/// `{ "ok": true }` and other replies the app does not read.
struct Empty: Codable {}

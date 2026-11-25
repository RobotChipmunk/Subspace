import SwiftUI

struct SearchThreadReply: Decodable {
    var root: Post
    var replies: [Post]
}

/// Search over everything the owner has: notes, pages, journal entries, links, tasks, posts,
/// topics and ideas, best match first. A result opens where it lives; a post, which has no place
/// of its own, is read where it was found.
struct SearchSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var hits: [ContextHit]? = nil
    /// The post being read in place, and its thread once it has arrived.
    @State private var reading: String? = nil
    @State private var threads: [String: [Post]] = [:]
    /// The words already reported as searched for, so each search is told once.
    @State private var told = ""
    @FocusState private var typing: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 0) {
            field
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if let hits, trimmed.count > 1 {
                        ForEach(hits, id: \.id) { hit in
                            row(hit)
                        }
                        if hits.isEmpty {
                            Text("Nothing found for “\(trimmed)”.")
                                .font(.ssBody)
                                .foregroundStyle(Theme.ink3)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 48)
                                .accessibilityIdentifier("search.empty")
                        }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 16)
                .column(680)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task(id: trimmed) { await search() }
        .onAppear { typing = true }
        .onDisappear { tell(nil) }
    }

    /// What was searched for, how much it found and whether a result was opened is kept (never the
    /// results themselves): once for the words in the field, when a result is opened or the sheet closes.
    private func tell(_ opened: String?) {
        let words = trimmed
        guard words.count > 1, !(told == words && opened == nil) else { return }
        told = words
        app.reportSearch(words, results: hits?.count ?? 0, opened: opened)
    }

    private var field: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").font(.system(size: 16)).foregroundStyle(Theme.ink3).accessibilityHidden(true)
            TextField("Search", text: $query)
                .font(.system(size: 16))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .submitLabel(.search)
                .focused($typing)
                .accessibilityLabel("Search everything")
                .accessibilityIdentifier("search.field")
            if !query.isEmpty {
                Button {
                    query = ""
                    typing = true
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.ink3)
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.9))
                .accessibilityLabel("Clear")
                .accessibilityIdentifier("search.clear")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, query.isEmpty ? 16 : 6)
        .frame(minHeight: 44)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.top, 24)
        .padding(.bottom, 10)
        .column(680)
    }

    // MARK: Results

    /// What a result is, told apart for its icon and for where it opens.
    private func kind(_ hit: ContextHit) -> String {
        if hit.type == "context", let k = hit.kind, k == "journal" || k == "page" { return k }
        return hit.type
    }

    private func icon(_ kind: String) -> String {
        switch kind {
        case "post": return "sparkle"
        case "todo": return "checkmark.circle"
        case "journal": return "square.and.pencil"
        case "page": return "doc.text"
        case "link": return "link"
        case "tracker": return "dot.radiowaves.left.and.right"
        case "idea": return "lightbulb"
        default: return "book"
        }
    }

    private func name(_ kind: String) -> String {
        switch kind {
        case "post": return "Post"
        case "todo": return "Task"
        case "journal": return "Journal"
        case "page": return "Page"
        case "link": return "Link"
        case "tracker": return "Topic"
        case "idea": return "Idea"
        default: return "Note"
        }
    }

    /// The snippet with the words that matched picked out (the server wraps them in **).
    private func marked(_ text: String) -> AttributedString {
        var out = AttributedString()
        for (i, part) in text.components(separatedBy: "**").enumerated() {
            var piece = AttributedString(part)
            if i % 2 == 1 {
                piece.backgroundColor = Theme.accentSoft
                piece.foregroundColor = Theme.ink
            }
            out += piece
        }
        return out
    }

    private func row(_ hit: ContextHit) -> some View {
        let k = kind(hit)
        // a post is found by its words: they are its title
        let title = hit.type == "post" ? "" : (hit.title ?? "")
        let snippet = hit.snippet ?? ""
        let plain = snippet.replacingOccurrences(of: "**", with: "")
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                open(hit)
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: icon(k))
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.ink3)
                        .frame(width: 22)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 2) {
                        if !title.isEmpty {
                            Text(title).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                        }
                        if !snippet.isEmpty {
                            Text(marked(snippet))
                                .font(.system(size: title.isEmpty ? 15 : 13.5))
                                .foregroundStyle(title.isEmpty ? Theme.ink : Theme.ink2)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(ago(hit.at)).font(.system(size: 12)).foregroundStyle(Theme.ink3).padding(.top, 2)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 9)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle(scale: 0.99))
            .accessibilityLabel("\(name(k)): \(title.isEmpty ? plain : title)")
            .accessibilityIdentifier("search.hit.\(k).\(hit.id)")

            if reading == hit.id {
                peek(hit.id)
                    .transition(.opacity)
            }
        }
    }

    /// A post read in place: what it said, where it came from and what was said under it.
    private func peek(_ id: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let thread = threads[id] {
                ForEach(thread, id: \.id) { p in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(app.agent(p.author)?.name ?? "").font(.system(size: 12.5, weight: .medium)).foregroundStyle(Theme.ink3)
                        Text(richText(p.body, handles: app.handles))
                            .font(.system(size: 14))
                            .foregroundStyle(p.id == id ? Theme.ink : Theme.ink2)
                            .tint(Theme.accent)
                            .fixedSize(horizontal: false, vertical: true)
                        if let source = p.source {
                            Button {
                                app.open(source.url)
                            } label: {
                                Text(source.name).font(.system(size: 12.5)).underline().foregroundStyle(Theme.ink3)
                            }
                            .buttonStyle(PressStyle())
                        }
                    }
                }
            } else {
                Text("…").font(.system(size: 14)).foregroundStyle(Theme.ink3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.leading, 44)
        .padding(.trailing, 10)
        .padding(.bottom, 6)
        .accessibilityIdentifier("search.peek.\(id)")
    }

    private func open(_ hit: ContextHit) {
        tell(hit.id)
        switch kind(hit) {
        case "post":
            withAnimation(.ssSoft) { reading = reading == hit.id ? nil : hit.id }
            if threads[hit.id] == nil { Task { await loadThread(hit.id) } }
            return
        case "todo":
            app.open("/todos?open=\(hit.id)")
        case "journal":
            app.open("/journal?entry=\(hit.id)")
        case "page":
            // a page opens over whatever is on screen, once this sheet has gone
            let id = hit.id
            dismiss()
            Task {
                try? await Task.sleep(for: .milliseconds(450))
                app.presentedPage = PageTarget(id: id)
            }
            return
        case "tracker":
            app.open("/following?topic=\(hit.id)")
        case "idea":
            app.open("/ideas?idea=\(hit.id)")
        default:
            app.open("/context?node=\(hit.id)")
        }
        dismiss()
    }

    // MARK: Data

    private func search() async {
        let text = trimmed
        guard text.count > 1 else {
            hits = nil
            reading = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(250))
        if Task.isCancelled { return }
        if let reply: ContextSearchReply = try? await app.api.get("search?q=" + q(text)) {
            if Task.isCancelled { return }
            reading = nil
            hits = reply.results
        }
    }

    private func loadThread(_ id: String) async {
        guard let reply: SearchThreadReply = try? await app.api.get("posts/\(id)") else { return }
        threads[id] = [reply.root] + reply.replies
    }
}

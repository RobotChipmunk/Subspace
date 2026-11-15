import SwiftUI

/// One area, note or page inside the tree: a glass card with its title, summary and who last touched it.
struct ContextNodeCard: View {
    var node: ContextNode
    var onOpen: () -> Void

    @Environment(AppModel.self) private var app

    private var summary: String {
        if let s = node.summary, !s.isEmpty { return s }
        return (node.body_chars ?? 0) > 0 ? "No summary yet." : "Empty."
    }

    private var metaLine: String {
        let name = app.agent(node.updated_by)?.name ?? ""
        let when = ago(node.updated_at)
        return name.isEmpty ? when : "\(name) · \(when)"
    }

    private var spoken: String {
        var parts: [String] = []
        let count = node.child_count ?? 0
        if count > 0 { parts.append(count == 1 ? "1 item" : "\(count) items") }
        if node.kind == "page" { parts.append("Page") }
        parts.append(summary)
        parts.append(metaLine)
        return parts.joined(separator: ", ")
    }

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 14) {
                ContextNodeTile(node: node)
                texts
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glass(radius: 22)
            .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(PressStyle(scale: 0.985))
        .accessibilityLabel(node.title)
        .accessibilityValue(spoken)
        .accessibilityIdentifier("context.node.\(node.id)")
    }

    private var texts: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Text(node.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                if node.kind == "page" {
                    Text("Page")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.accentSoft, in: Capsule())
                }
            }
            Text(summary)
                .font(.ssSecondary)
                .foregroundStyle(Theme.ink2)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            HStack(spacing: 6) {
                if let by = app.agent(node.updated_by) { AvatarView(agent: by, size: 14) }
                Text(metaLine).font(.system(size: 12)).foregroundStyle(Theme.ink3).lineLimit(1)
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The pastel tile on a card: its cover, how many things are inside, or what kind of thing it is.
private struct ContextNodeTile: View {
    var node: ContextNode

    var body: some View {
        let seed = stableHash(node.id)
        let palette = Palette.forSeed(seed)
        let count = node.child_count ?? 0
        ZStack {
            MeshView(seed: seed, palette: palette)
            if let cover = node.cover, !cover.isEmpty {
                RemoteImage(cover)
            } else if count > 0 {
                Text("\(count)").font(.system(size: 15, weight: .bold)).foregroundStyle(palette.inkColor)
            } else {
                Image(systemName: node.kind == "page" ? "doc.richtext" : "doc.text")
                    .font(.system(size: 17))
                    .foregroundStyle(palette.inkColor)
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.white.opacity(0.4), lineWidth: 1))
        .accessibilityHidden(true)
    }
}

/// "New area", "Add a note inside", "Add a link": a quiet dashed outline that asks for nothing.
struct ContextDashedButton: View {
    var icon: String
    var label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 15, weight: .medium))
                Text(label).font(.system(size: 14.5))
            }
            .foregroundStyle(Theme.ink2)
            .frame(maxWidth: .infinity, minHeight: 84)
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(Theme.fill2, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            )
            .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(PressStyle(scale: 0.98))
    }
}

/// The newest pages agents made, as a shelf that scrolls sideways.
struct ContextPagesShelf: View {
    var pages: [ContextNode]
    var onOpen: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("RECENT PAGES")
                .font(.system(size: 12.5, weight: .semibold))
                .tracking(0.7)
                .foregroundStyle(Theme.ink3)
                .padding(.horizontal, 4)
                .accessibilityLabel("Recent pages")
                .accessibilityAddTraits(.isHeader)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(pages, id: \.id) { page in
                        ContextPageTile(page: page) { onOpen(page.id) }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .padding(.horizontal, -16)
        }
    }
}

private struct ContextPageTile: View {
    var page: ContextNode
    var onOpen: () -> Void

    private var metaLine: String {
        let place = contextParentPath(page.path)
        let when = ago(page.created_at)
        return place.isEmpty ? when : "\(place) · \(when)"
    }

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 0) {
                top.frame(width: 210, height: 92).clipped()
                VStack(alignment: .leading, spacing: 2) {
                    Text(page.title).font(.system(size: 14.5, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(page.summary ?? "")
                        .font(.ssMeta)
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(2, reservesSpace: true)
                        .multilineTextAlignment(.leading)
                    Text(metaLine).font(.system(size: 11.5)).foregroundStyle(Theme.ink3).lineLimit(1).padding(.top, 2)
                }
                .padding(12)
                .frame(width: 210, alignment: .leading)
            }
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .glass(radius: 20)
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(PressStyle(scale: 0.98))
        .accessibilityLabel(page.title)
        .accessibilityValue("\(page.summary ?? ""), \(metaLine)")
        .accessibilityIdentifier("context.page.\(page.id)")
    }

    @ViewBuilder private var top: some View {
        if let cover = page.cover, !cover.isEmpty {
            RemoteImage(cover)
        } else {
            let seed = stableHash(page.id)
            let palette = Palette.forSeed(seed)
            ZStack {
                MeshView(seed: seed, palette: palette)
                Image(systemName: "doc.richtext").font(.system(size: 22)).foregroundStyle(palette.inkColor)
            }
        }
    }
}

/// What a search found, across notes, pages, links, tasks, posts and followed topics.
struct ContextSearchResults: View {
    var hits: [ContextHit]?
    var query: String
    var onOpen: (ContextHit) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let hits {
                ForEach(hits, id: \.id) { hit in
                    ContextHitRow(hit: hit) { onOpen(hit) }
                }
                if hits.isEmpty {
                    Text("Nothing found for “\(query)”.")
                        .font(.ssBody)
                        .foregroundStyle(Theme.ink3)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 56)
                        .accessibilityIdentifier("context.search.empty")
                }
            }
        }
    }
}

private struct ContextHitRow: View {
    var hit: ContextHit
    var onOpen: () -> Void

    /// Where it lives for notes and links; what it is for everything else.
    private var place: String {
        switch hit.type {
        case "context":
            return contextParentPath(hit.path)
        case "link":
            let where_ = contextParentPath(hit.path)
            let site = hit.site ?? ""
            if where_.isEmpty { return site.isEmpty ? "Link" : site }
            return site.isEmpty ? where_ : "\(where_) · \(site)"
        case "todo":
            return "Task"
        case "post":
            return "Post"
        case "tracker":
            return "Following"
        default:
            return ""
        }
    }

    private var plain: String {
        (hit.snippet ?? "").replacingOccurrences(of: "**", with: "")
    }

    /// The snippet with the words that matched picked out (the server wraps them in **).
    private var snippet: AttributedString {
        var out = AttributedString()
        let parts = (hit.snippet ?? "").components(separatedBy: "**")
        for (i, part) in parts.enumerated() {
            var piece = AttributedString(part)
            if i % 2 == 1 {
                piece.backgroundColor = Theme.accentSoft
                piece.foregroundColor = Theme.ink
            }
            out += piece
        }
        return out
    }

    var body: some View {
        let title = hit.title ?? ""
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 2) {
                if !place.isEmpty {
                    Text(place).font(.ssMeta).foregroundStyle(Theme.ink3).lineLimit(1)
                }
                if !title.isEmpty {
                    Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                }
                if !plain.isEmpty {
                    Text(snippet)
                        .font(.system(size: 14))
                        .foregroundStyle(title.isEmpty ? Theme.ink : Theme.ink2)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glass(radius: 20)
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(PressStyle(scale: 0.99))
        .accessibilityLabel(title.isEmpty ? plain : title)
        .accessibilityValue(title.isEmpty ? place : "\(place), \(plain)")
        .accessibilityIdentifier("context.hit.\(hit.id)")
    }
}

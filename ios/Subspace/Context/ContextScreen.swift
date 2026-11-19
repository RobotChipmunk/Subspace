import SwiftUI

/// Context: what the agents know, as a tree to browse. Areas at the root; inside one, its note,
/// what it holds and the links filed there. Search looks through everything.
struct ContextScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var nodeID: String?
    @State private var showLinks = false
    @State private var tree: ContextTree?
    @State private var pages: [ContextNode] = []
    @State private var query = ""
    @State private var hits: [ContextHit]?
    @State private var adding = false
    @State private var focusAdd = false
    @State private var refreshToken = 0
    @State private var error = ""

    init() {}

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var searching: Bool { trimmedQuery.count > 1 }
    private var wide: Bool { sizeClass == .regular }

    /// The ancestors of the open node; its own title is shown in the note itself.
    private var crumbs: [ContextCrumb] {
        guard nodeID != nil, let tree, tree.node?.id == nodeID else { return [] }
        return Array((tree.trail ?? []).dropLast())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ContextHeader(
                    crumbs: crumbs,
                    atRoot: nodeID == nil && !showLinks,
                    showLinks: showLinks,
                    wide: wide,
                    query: $query,
                    onGo: { id in go(id) },
                    onToggleLinks: { toggleLinks() }
                )
                if !error.isEmpty {
                    Text(error).font(.ssSecondary).foregroundStyle(Theme.danger).padding(.horizontal, 4).padding(.bottom, 12)
                }
                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 32)
            .column(880)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable {
            refreshToken += 1
            await load()
        }
        .environment(\.openURL, OpenURLAction { url in follow(url) })
        .task(id: nodeID) {
            while !Task.isCancelled {
                if app.tab == .context { await load() }
                try? await Task.sleep(for: .seconds(20))
            }
        }
        .task(id: trimmedQuery) { await search() }
        .onChange(of: app.tab) { _, now in
            if now == .context { Task { await load() } }
        }
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        if searching {
            ContextSearchResults(hits: hits, query: trimmedQuery) { hit in open(hit) }
        } else if showLinks {
            ContextLinkSection(parent: nil, showAdd: true, focusAdd: focusAdd, showArea: true, showEmpty: true, refreshToken: refreshToken, onOpen: { id in go(id) })
        } else if let tree, tree.node?.id == nodeID {
            if let node = tree.node {
                inside(node, children: tree.children ?? [])
            } else {
                root(children: tree.children ?? [])
            }
        }
    }

    private func root(children: [ContextNode]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("What your agents know about you, your life and their work. They keep it current; you can change anything.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
                .padding(.top, -12)
                .padding(.bottom, 24)
            // house rules: what agents have proposed waits here as well as in the rail
            ContextProposals(onDecided: { Task { await load() } })
            if let current = tree?.current, !current.isEmpty {
                ContextCurrentShelf(notes: current, wide: wide) { id in go(id) }
            }
            if !pages.isEmpty {
                ContextPagesShelf(pages: pages) { id in go(id) }
            }
            ContextGrid(wide: wide) {
                ForEach(children, id: \.id) { child in
                    ContextNodeCard(node: child) { go(child.id) }
                }
                ContextDashedButton(icon: "plus", label: "New area") { addChild() }
                    .accessibilityIdentifier("context.new")
                ContextDashedButton(icon: "link", label: "Add a link") { addLinkFromRoot() }
                    .accessibilityIdentifier("context.addlink")
            }
        }
    }

    private func inside(_ node: ContextNode, children: [ContextNode]) -> some View {
        let holds = node.kind != "link"
        let path = node.path ?? ""
        return VStack(alignment: .leading, spacing: 0) {
            if path == "system" || path.hasPrefix("system/") {
                ContextProposals(onDecided: { Task { await load() } })
            }
            ContextNodeDetail(
                node: node,
                onChanged: { fresh in adopt(fresh) },
                onArchived: { go(node.parent_id) }
            )
            .id(node.id)
            .padding(.bottom, 20)
            ContextGrid(wide: wide) {
                ForEach(children, id: \.id) { child in
                    ContextNodeCard(node: child) { go(child.id) }
                }
                if holds {
                    ContextDashedButton(icon: "plus", label: "Add a note inside") { addChild() }
                        .accessibilityIdentifier("context.new")
                }
                if holds && !adding {
                    ContextDashedButton(icon: "link", label: "Add a link") {
                        withAnimation(.ssSoft) { adding = true }
                    }
                    .accessibilityIdentifier("context.addlink")
                }
            }
            if holds {
                ContextLinkSection(parent: node.id, showAdd: adding, focusAdd: true, refreshToken: refreshToken, onSaved: { withAnimation(.ssSoft) { adding = false } }, onOpen: { id in go(id) })
                    .padding(.top, 16)
            }
        }
    }

    // MARK: Moving around

    private func go(_ id: String?) {
        _ = UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        error = ""
        withAnimation(.ssSoft) {
            nodeID = id
            showLinks = false
            adding = false
            focusAdd = false
            if !query.isEmpty { query = "" }
        }
    }

    private func toggleLinks() {
        error = ""
        withAnimation(.ssSoft) {
            if showLinks {
                showLinks = false
            } else {
                nodeID = nil
                focusAdd = false
                showLinks = true
            }
            adding = false
        }
    }

    /// At the root a link has no area yet: open the list of every link with the box ready.
    private func addLinkFromRoot() {
        withAnimation(.ssSoft) {
            focusAdd = true
            showLinks = true
        }
    }

    private func open(_ hit: ContextHit) {
        switch hit.type {
        case "context", "link":
            go(hit.id)
        case "todo":
            app.open("/todos?open=\(hit.id)")
        case "post":
            app.open("/feed")
        case "tracker":
            app.open("/following")
        default:
            break
        }
    }

    /// A link inside a note that points at another note or page opens it here.
    private func follow(_ url: URL) -> OpenURLAction.Result {
        if let id = contextPageID(from: url, base: app.api.baseURL) {
            go(id)
            return .handled
        }
        app.open(url.absoluteString)
        return .handled
    }

    // MARK: Data

    private func adopt(_ fresh: ContextNode) {
        guard tree?.node?.id == fresh.id else { return }
        tree?.node = fresh
    }

    private func load() async {
        let id = nodeID
        var path = "context"
        if let id { path += "?node=" + q(id) }
        do {
            let fresh: ContextTree = try await app.api.get(path)
            guard id == nodeID else { return }
            // a path may have been asked for; from here on the node goes by its id
            if let id, let real = fresh.node?.id, real != id {
                tree = fresh
                nodeID = real
                return
            }
            if tree == nil {
                tree = fresh
            } else {
                withAnimation(.ssSoft) { tree = fresh }
            }
            if !error.isEmpty { error = "" }
        } catch is CancellationError {
            return
        } catch let e as APIError {
            guard id == nodeID else { return }
            if e.status == 404, id != nil {
                // it was removed somewhere else: back to the top
                go(nil)
            } else if tree == nil || tree?.node?.id != id {
                error = e.message
            }
        } catch {
            return
        }
        if id == nil, let reply: ContextPagesReply = try? await app.api.get("pages") {
            if reply.pages != pages { pages = reply.pages }
        }
    }

    private func search() async {
        let text = trimmedQuery
        guard text.count > 1 else {
            hits = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(250))
        if Task.isCancelled { return }
        if let reply: ContextSearchReply = try? await app.api.get("search?q=" + q(text)) {
            if Task.isCancelled { return }
            hits = reply.results
        }
    }

    private func addChild() {
        var fields: [String: Any] = ["title": "Untitled"]
        if let nodeID { fields["parent"] = nodeID }
        let payload = fields
        Task {
            do {
                let made: ContextNode = try await app.api.send("POST", "context", body: payload)
                go(made.id)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// One column on a phone, two beside each other on wide screens.
private struct ContextGrid<Content: View>: View {
    var wide: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        let one = GridItem(.flexible(), spacing: 12, alignment: .top)
        let columns: [GridItem] = wide ? [one, one] : [one]
        LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
            content()
        }
    }
}

/// The breadcrumb trail, the switch to every saved link, and search.
private struct ContextHeader: View {
    var crumbs: [ContextCrumb]
    var atRoot: Bool
    var showLinks: Bool
    var wide: Bool
    @Binding var query: String
    var onGo: (String?) -> Void
    var onToggleLinks: () -> Void

    var body: some View {
        Group {
            if wide {
                HStack(alignment: .center, spacing: 16) {
                    trail.frame(maxWidth: .infinity, alignment: .leading)
                    controls.frame(width: 340)
                }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    trail.frame(maxWidth: .infinity, alignment: .leading)
                    controls
                }
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 24)
    }

    private var trail: some View {
        FlowRow(spacing: 4) {
            Button {
                onGo(nil)
            } label: {
                Text("Context")
                    .font(.ssTitle)
                    .tracking(-0.9)
                    .foregroundStyle(atRoot ? Theme.ink : Theme.ink3)
                    .frame(minHeight: 36)
            }
            .buttonStyle(PressStyle(scale: 0.98))
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("context.crumb.root")
            if showLinks {
                HStack(spacing: 4) {
                    chevron
                    Text("Links").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink)
                }
                .frame(minHeight: 36)
            }
            ForEach(crumbs, id: \.id) { crumb in
                Button {
                    onGo(crumb.id)
                } label: {
                    HStack(spacing: 4) {
                        chevron
                        Text(crumb.title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink3).lineLimit(1)
                    }
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.98))
                .accessibilityLabel(crumb.title)
                .accessibilityIdentifier("context.crumb.\(crumb.id)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Breadcrumb")
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.ink3)
            .accessibilityHidden(true)
    }

    private var controls: some View {
        HStack(spacing: 12) {
            Button(action: onToggleLinks) {
                HStack(spacing: 6) {
                    Image(systemName: "link").font(.system(size: 14, weight: .medium))
                    Text("Links").font(.system(size: 14.5, weight: .medium))
                }
                .foregroundStyle(showLinks ? Theme.accent : Theme.ink2)
                .padding(.horizontal, 14)
                .frame(minHeight: 40)
                .glass(radius: 20)
                .contentShape(Capsule())
            }
            .buttonStyle(PressStyle())
            .accessibilityAddTraits(showLinks ? .isSelected : [])
            .accessibilityIdentifier("context.links")
            searchField
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(Theme.ink3).accessibilityHidden(true)
            TextField("Search", text: $query)
                .font(.system(size: 15))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .submitLabel(.search)
                .accessibilityLabel("Search context")
                .accessibilityIdentifier("context.search")
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.ink3)
                        .frame(width: 32, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.9))
                .accessibilityLabel("Clear")
                .accessibilityIdentifier("context.search.clear")
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, query.isEmpty ? 14 : 4)
        .frame(minHeight: 40)
        .frame(maxWidth: .infinity)
        .glass(radius: 20)
    }
}

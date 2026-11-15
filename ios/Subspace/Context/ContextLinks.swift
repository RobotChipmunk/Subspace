import SwiftUI

/// Saved links, newest first, a page at a time: everywhere (`parent` nil) or inside one area,
/// with the box to add one.
struct ContextLinkSection: View {
    var parent: String?
    /// Show the "Paste a link" box.
    var showAdd: Bool
    var focusAdd: Bool = false
    /// Name the area each link is filed under (the list of every link).
    var showArea: Bool = false
    var showEmpty: Bool = false
    /// Changes when the screen is pulled to refresh.
    var refreshToken: Int = 0
    var onSaved: () -> Void = {}
    var onOpen: (String) -> Void

    @Environment(AppModel.self) private var app
    @State private var store = ContextLinkStore()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if showAdd {
                ContextQuickAdd(parent: parent, autoFocus: focusAdd) {
                    onSaved()
                    Task { await store.refresh(api: app.api, parent: parent, merge: false) }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
            if !store.links.isEmpty {
                ContextLinkList(store: store, parent: parent, showArea: showArea, onOpen: onOpen)
            }
            if showEmpty && store.loaded && store.links.isEmpty {
                Text("No links yet. Paste one above, or tell an agent to save one.")
                    .font(.system(size: 14.5))
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 48)
            }
        }
        .task(id: parent) {
            var first = true
            while !Task.isCancelled {
                if first || app.tab == .context {
                    await store.refresh(api: app.api, parent: parent, merge: !first)
                }
                first = false
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .onChange(of: refreshToken) { _, _ in
            Task { await store.refresh(api: app.api, parent: parent, merge: false) }
        }
    }
}

/// The rows, and a marker at the end that fetches the next page as it scrolls into view.
private struct ContextLinkList: View {
    var store: ContextLinkStore
    var parent: String?
    var showArea: Bool
    var onOpen: (String) -> Void

    @Environment(AppModel.self) private var app

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(store.links, id: \.id) { link in
                ContextLinkRow(link: link, area: area(link), onOpen: { onOpen(link.id) })
            }
            if store.next != nil {
                more
            }
        }
    }

    private func area(_ link: ContextNode) -> String? {
        guard showArea, let path = link.parent_path, path != "links" else { return nil }
        return link.parent_title
    }

    private var more: some View {
        let label = store.busy ? "Loading" : "Show more · \(store.links.count) of \(store.total.formatted())"
        return Button(label) {
            Task { await store.loadMore(api: app.api, parent: parent) }
        }
        .font(.ssSecondary)
        .foregroundStyle(Theme.ink3)
        .frame(maxWidth: .infinity, minHeight: 44)
        .buttonStyle(PressStyle())
        .accessibilityIdentifier("context.links.more")
        .id(store.links.count)
        .onAppear {
            Task { await store.loadMore(api: app.api, parent: parent) }
        }
    }
}

/// One saved link: tapping it opens the page on the web; the small button opens its notes.
private struct ContextLinkRow: View {
    var link: ContextNode
    var area: String?
    var onOpen: () -> Void

    @Environment(AppModel.self) private var app

    private var hasNotes: Bool { (link.body_chars ?? 0) > 0 }

    private var metaLine: String {
        var parts: [String] = []
        if let site = link.site, !site.isEmpty { parts.append(site) }
        if let area, !area.isEmpty { parts.append(area) }
        let when = ago(link.created_at)
        if !when.isEmpty { parts.append(when) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Button {
                if let url = link.url, !url.isEmpty { app.open(url) } else { onOpen() }
            } label: {
                texts
            }
            .buttonStyle(PressStyle(scale: 0.99))
            .accessibilityLabel(link.title)
            .accessibilityValue(spoken)
            .accessibilityHint("Opens the link")
            .accessibilityIdentifier("context.link.\(link.id)")

            Button(action: onOpen) {
                Image(systemName: hasNotes ? "doc.text" : "ellipsis")
                    .font(.system(size: 15))
                    .foregroundStyle(hasNotes ? Theme.ink2 : Theme.ink3)
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle(scale: 0.9))
            .padding(.top, 4)
            .accessibilityLabel(hasNotes ? "Notes on \(link.title)" : "Details for \(link.title)")
            .accessibilityIdentifier("context.link.notes.\(link.id)")
        }
    }

    private var spoken: String {
        var parts: [String] = []
        if let s = link.summary, !s.isEmpty { parts.append(s) }
        parts.append(metaLine)
        return parts.joined(separator: ", ")
    }

    private var texts: some View {
        let why = link.summary ?? ""
        let line = why.isEmpty ? (link.blurb ?? "") : why
        return VStack(alignment: .leading, spacing: 2) {
            Text(link.title).font(.ssRowTitle).foregroundStyle(Theme.ink).lineLimit(1)
            if !line.isEmpty {
                Text(line)
                    .font(.ssSecondary)
                    .foregroundStyle(why.isEmpty ? Theme.ink3 : Theme.ink2)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            Text(metaLine).font(.system(size: 12)).foregroundStyle(Theme.ink3).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10)
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .contentShape(Rectangle())
    }
}

/// Paste an address, optionally say why, save.
struct ContextQuickAdd: View {
    var parent: String?
    var autoFocus: Bool = false
    var onSaved: () -> Void

    @Environment(AppModel.self) private var app
    @State private var url = ""
    @State private var why = ""
    @State private var busy = false
    @State private var error = ""
    @FocusState private var urlFocused: Bool

    private var trimmed: String { url.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The same test as the web: something, a dot, at least two more characters, no spaces.
    private var ready: Bool {
        trimmed.range(of: "^\\S+\\.\\S{2,}$", options: .regularExpression) != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            addressRow
            if ready {
                TextField("Why you’re keeping it (optional)", text: $why)
                    .font(.system(size: 14.5))
                    .foregroundStyle(Theme.ink2)
                    .submitLabel(.done)
                    .onSubmit { save() }
                    .padding(.leading, 27)
                    .padding(.bottom, 12)
                    .frame(minHeight: 36)
                    .accessibilityLabel("Why you’re keeping it")
                    .accessibilityIdentifier("context.addlink.why")
                    .transition(.opacity)
            }
            if !error.isEmpty {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.danger)
                    .padding(.leading, 27)
                    .padding(.bottom, 12)
                    .accessibilityIdentifier("context.addlink.error")
            }
        }
        .padding(.horizontal, 16)
        .glass(radius: 22)
        .animation(.ssSoft, value: ready)
        .onAppear { if autoFocus { urlFocused = true } }
        .onChange(of: url) { _, _ in error = "" }
        .onChange(of: why) { _, now in
            if now.count > 400 { why = String(now.prefix(400)) }
        }
    }

    private var addressRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "link").font(.system(size: 15)).foregroundStyle(Theme.ink3).frame(width: 17)
            TextField("Paste a link", text: $url)
                .font(.ssBody)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .submitLabel(.done)
                .focused($urlFocused)
                .onSubmit { save() }
                .accessibilityLabel("Link address")
                .accessibilityIdentifier("context.addlink.url")
            if ready {
                Button(busy ? "Saving" : "Save") { save() }
                    .buttonStyle(PillStyle(prominent: true))
                    .disabled(busy)
                    .opacity(busy ? 0.6 : 1)
                    .transition(.scale(scale: 0.9).combined(with: .opacity))
                    .accessibilityIdentifier("context.addlink.save")
            }
        }
        .frame(minHeight: 48)
    }

    private func save() {
        guard ready, !busy else { return }
        busy = true
        error = ""
        var fields: [String: Any] = ["url": trimmed]
        let reason = why.trimmingCharacters(in: .whitespacesAndNewlines)
        if !reason.isEmpty { fields["why"] = reason }
        if let parent { fields["parent"] = parent }
        let payload = fields
        Task {
            do {
                try await app.api.send("POST", "links", body: payload)
                url = ""
                why = ""
                onSaved()
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}

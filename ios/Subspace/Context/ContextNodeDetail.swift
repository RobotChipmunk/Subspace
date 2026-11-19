import SwiftUI

private enum ContextDetailField: Hashable {
    case title, summary, body
}

/// One note, page or saved link, opened: title, summary, who updated it and when, and its body.
/// The owner can edit a note's title, summary and markdown; changes save silently.
struct ContextNodeDetail: View {
    var node: ContextNode
    /// Draw it as a glass card (inside the Context screen) or bare (inside a sheet).
    var card: Bool = true
    var onChanged: (ContextNode) -> Void
    var onArchived: () -> Void

    @Environment(AppModel.self) private var app
    @State private var shown: ContextNode
    @State private var editing: Bool
    @State private var title: String
    @State private var summary: String
    @State private var text: String
    @State private var saver = ContextSaver()
    @State private var error = ""
    @FocusState private var focus: ContextDetailField?

    init(node: ContextNode, card: Bool = true, onChanged: @escaping (ContextNode) -> Void, onArchived: @escaping () -> Void) {
        self.node = node
        self.card = card
        self.onChanged = onChanged
        self.onArchived = onArchived
        // A note that was just made opens ready to be named, as on the web.
        let fresh = node.title == "Untitled" && node.kind != "page"
        _shown = State(initialValue: node)
        _editing = State(initialValue: fresh)
        _title = State(initialValue: fresh ? "" : node.title)
        _summary = State(initialValue: node.summary ?? "")
        _text = State(initialValue: node.body ?? "")
    }

    private var isLink: Bool { shown.kind == "link" }
    /// Pages are laid out by agents with blocks; this version only reads them.
    private var canEdit: Bool { shown.kind != "page" }
    private var draft: ContextDraft { ContextDraft(title: title, summary: summary, body: text) }

    var body: some View {
        Group {
            if card {
                inner.padding(20).glass(radius: 26)
            } else {
                inner
            }
        }
        .onAppear { begin() }
        .onDisappear { saver.flush() }
        .onChange(of: node) { _, fresh in adopt(fresh) }
        .onChange(of: title) { _, now in titleChanged(now) }
        .onChange(of: summary) { _, now in summaryChanged(now) }
        .onChange(of: text) { _, _ in typed() }
    }

    private var inner: some View {
        VStack(alignment: .leading, spacing: 0) {
            cover
            header
            summaryLine
            linkLine
            meta
            if !error.isEmpty {
                Text(error).font(.ssMeta).foregroundStyle(Theme.danger).padding(.bottom, 12)
            }
            bodyArea
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Parts

    @ViewBuilder private var cover: some View {
        if let ref = shown.cover, !ref.isEmpty {
            RemoteImage(ref)
                .frame(height: 170)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.bottom, 18)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 8) {
            titleView
            Spacer(minLength: 0)
            if canEdit { editButton }
            ConfirmDelete(label: "Remove", confirm: "Remove") { await archive() }
                .accessibilityIdentifier("page.remove")
        }
    }

    @ViewBuilder private var titleView: some View {
        if editing {
            TextField("Untitled", text: $title, axis: .vertical)
                .font(.ssDetailTitle)
                .tracking(-0.6)
                .foregroundStyle(Theme.ink)
                .focused($focus, equals: .title)
                .submitLabel(.done)
                .accessibilityLabel("Title")
                .accessibilityIdentifier("page.title")
        } else {
            Text(shown.title)
                .font(.ssDetailTitle)
                .tracking(-0.6)
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("page.title")
        }
    }

    private var editButton: some View {
        Button(editing ? "Done" : "Edit") {
            if editing { finish() } else { startEditing(.body) }
        }
        .buttonStyle(PillStyle())
        .frame(minHeight: 36)
        .accessibilityIdentifier("page.edit")
    }

    @ViewBuilder private var summaryLine: some View {
        if editing {
            TextField(isLink ? "Why you’re keeping it" : "One line on what this is about", text: $summary, axis: .vertical)
                .font(.system(size: 15))
                .foregroundStyle(Theme.ink2)
                .focused($focus, equals: .summary)
                .submitLabel(.done)
                .padding(.top, 4)
                .accessibilityLabel("Summary")
                .accessibilityIdentifier("page.summary")
        } else if let s = shown.summary, !s.isEmpty {
            Text(s)
                .font(.system(size: 15))
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
                .accessibilityIdentifier("page.summary")
        }
    }

    @ViewBuilder private var linkLine: some View {
        if isLink, let url = shown.url, !url.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                if let blurb = shown.blurb, !blurb.isEmpty {
                    Text(blurb).font(.system(size: 14)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
                }
                Button {
                    app.open(url)
                } label: {
                    HStack(spacing: 4) {
                        Text(contextBareURL(url)).font(.ssSecondary).underline().lineLimit(1)
                        Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.ink3)
                    }
                    .foregroundStyle(Theme.ink2)
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.98))
                .accessibilityLabel("Open \(contextBareURL(url))")
                .accessibilityIdentifier("page.link")
            }
            .padding(.top, 6)
        }
    }

    private var meta: some View {
        let by = app.agent(shown.updated_by)
        let name = by?.name ?? "someone"
        var line = "Updated by \(name) · \(ago(shown.updated_at))"
        if let v = shown.version { line += " · version \(v)" }
        // a note that is only true for now says until when; one under Current always offers the day
        let offersUntil = (shown.kind ?? "note") == "note" && (shown.until != nil || (shown.path ?? "").hasPrefix("current/"))
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let by { AvatarView(agent: by, size: 15) }
                Text(line).font(.ssMeta).foregroundStyle(Theme.ink3)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("page.meta")
            if offersUntil {
                ContextUntilRow(until: shown.until) { day in setUntil(day) }
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 22)
    }

    @ViewBuilder private var bodyArea: some View {
        if editing {
            editor
        } else if (shown.body ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            emptyBody
        } else {
            MarkdownView(markdown: shown.body ?? "")
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("page.body")
        }
    }

    private var placeholder: String {
        isLink ? "Notes, if you want them." : "Write what is worth remembering. Agents read this before they ask you."
    }

    @ViewBuilder private var emptyBody: some View {
        if canEdit {
            Button {
                startEditing(.body)
            } label: {
                Text(placeholder)
                    .font(.ssBody)
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .topLeading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("page.body")
        } else {
            Text("Empty.").font(.ssBody).foregroundStyle(Theme.ink3).accessibilityIdentifier("page.body")
        }
    }

    /// Raw markdown in a plain editor that grows with what is typed.
    private var editor: some View {
        ZStack(alignment: .topLeading) {
            // sizes the editor to its text
            Text(text + "\n")
                .font(.ssBody)
                .padding(.horizontal, 5)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .opacity(0)
                .accessibilityHidden(true)
            if text.isEmpty {
                Text(placeholder)
                    .font(.ssBody)
                    .foregroundStyle(Theme.ink3)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 8)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $text)
                .font(.ssBody)
                .foregroundStyle(Theme.ink)
                .scrollContentBackground(.hidden)
                .scrollDisabled(true)
                .focused($focus, equals: .body)
                .accessibilityLabel("Body, markdown")
                .accessibilityIdentifier("page.body.editor")
        }
        .frame(minHeight: 220)
        .padding(.horizontal, -5)
    }

    // MARK: Behaviour

    /// Moves the day the note holds until, or takes it off.
    private func setUntil(_ day: String?) {
        let before = shown.until
        shown.until = day
        Task {
            do {
                let saved = try await app.api.send("PATCH", "context/\(node.id)", body: ["until": day ?? NSNull()], as: ContextNode.self)
                shown.until = saved.until
                shown.version = saved.version
                shown.updated_at = saved.updated_at
                shown.updated_by = saved.updated_by
                error = ""
                onChanged(saved)
            } catch let e {
                shown.until = before
                error = e.localizedDescription
            }
        }
    }

    private func begin() {
        saver.start(api: app.api, nodeID: node.id, baseline: ContextDraft(title: node.title, summary: node.summary ?? "", body: node.body ?? ""))
        saver.onSaved = { saved in
            error = ""
            if editing {
                shown.version = saved.version
                shown.updated_at = saved.updated_at
                shown.updated_by = saved.updated_by
                shown.path = saved.path
            } else if !saver.dirty {
                shown = saved
            }
            onChanged(saved)
        }
        saver.onError = { message in error = message }
        if editing && focus == nil {
            focus = title.isEmpty ? .title : .body
        }
    }

    /// Fresh content from agents flows in unless something typed here is still unsaved.
    private func adopt(_ fresh: ContextNode) {
        guard !editing, !saver.dirty else { return }
        shown = fresh
    }

    private func startEditing(_ field: ContextDetailField) {
        title = shown.title
        summary = shown.summary ?? ""
        text = shown.body ?? ""
        withAnimation(.ssSoft) { editing = true }
        focus = field
    }

    private func finish() {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { shown.title = name }
        shown.summary = summary
        shown.body = text
        focus = nil
        saver.push(draft)
        saver.flush()
        withAnimation(.ssSoft) { editing = false }
    }

    private func titleChanged(_ now: String) {
        if now.contains("\n") {
            title = now.replacingOccurrences(of: "\n", with: "")
            focus = .body
            return
        }
        typed()
    }

    private func summaryChanged(_ now: String) {
        if now.contains("\n") {
            summary = now.replacingOccurrences(of: "\n", with: "")
            focus = .body
            return
        }
        typed()
    }

    private func typed() {
        guard editing else { return }
        saver.push(draft)
    }

    private func archive() async {
        saver.drop()
        do {
            try await app.api.send("DELETE", "context/\(node.id)")
            onArchived()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

import SwiftUI

/// One page or note by id, on its own: what the shell shows in a sheet when something points at
/// "/page/<id>". Links inside it that lead to another page open in the same sheet, with a way back.
struct PageView: View {
    private let pageID: String

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    /// Pages opened from inside this one, newest last.
    @State private var stack: [String] = []
    @State private var tree: ContextTree?
    @State private var loadedFor: String?
    @State private var error = ""

    init(pageID: String) {
        self.pageID = pageID
    }

    private var currentID: String { stack.last ?? pageID }

    /// Where the page lives, without its own name: "Home › Travel".
    private var place: String {
        guard loadedFor == currentID, let trail = tree?.trail else { return "" }
        return trail.dropLast().map { $0.title }.joined(separator: " › ")
    }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    bar
                    content
                }
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 40)
                .column(760)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await load() }
        }
        .foregroundStyle(Theme.ink)
        .environment(\.openURL, OpenURLAction { url in follow(url) })
        .task(id: currentID) {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }

    // MARK: Parts

    private var bar: some View {
        HStack(spacing: 8) {
            if !stack.isEmpty {
                Button {
                    back()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.ink2)
                        .frame(width: 36, height: 36)
                        .background(Theme.fill, in: Circle())
                }
                .buttonStyle(PressStyle(scale: 0.9))
                .accessibilityLabel("Back")
                .accessibilityIdentifier("page.back")
            }
            Text(place)
                .font(.ssMeta)
                .foregroundStyle(Theme.ink3)
                .lineLimit(1)
                .accessibilityIdentifier("page.trail")
            Spacer(minLength: 0)
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.ink2)
                    .frame(width: 36, height: 36)
                    .background(Theme.fill, in: Circle())
            }
            .buttonStyle(PressStyle(scale: 0.9))
            .accessibilityLabel("Close")
            .accessibilityIdentifier("page.close")
        }
        .padding(.bottom, 14)
    }

    @ViewBuilder private var content: some View {
        if loadedFor == currentID, let node = tree?.node {
            ContextNodeDetail(
                node: node,
                card: false,
                onChanged: { fresh in adopt(fresh) },
                onArchived: { removed() }
            )
            .id(node.id)
            children
        } else if !error.isEmpty {
            Text(error)
                .font(.ssSecondary)
                .foregroundStyle(Theme.danger)
                .padding(.vertical, 32)
                .accessibilityIdentifier("page.error")
        }
    }

    /// What a note holds, so a folder opened here can still be walked.
    @ViewBuilder private var children: some View {
        let inside = tree?.children ?? []
        if !inside.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(inside, id: \.id) { child in
                    ContextNodeCard(node: child) { push(child.id) }
                }
            }
            .padding(.top, 24)
        }
    }

    // MARK: Behaviour

    private func push(_ id: String) {
        guard id != currentID else { return }
        withAnimation(.ssSoft) { stack.append(id) }
    }

    private func back() {
        guard !stack.isEmpty else { return }
        withAnimation(.ssSoft) { _ = stack.removeLast() }
    }

    private func removed() {
        if stack.isEmpty { dismiss() } else { back() }
    }

    private func adopt(_ fresh: ContextNode) {
        guard tree?.node?.id == fresh.id else { return }
        tree?.node = fresh
    }

    /// A link to another page or note stays in this sheet; anything else goes where it belongs.
    private func follow(_ url: URL) -> OpenURLAction.Result {
        if let id = contextPageID(from: url, base: app.api.baseURL) {
            push(id)
            return .handled
        }
        app.open(url.absoluteString)
        return .handled
    }

    private func load() async {
        let id = currentID
        do {
            let fresh: ContextTree = try await app.api.get("context?node=" + q(id))
            guard id == currentID else { return }
            tree = fresh
            loadedFor = id
            error = ""
        } catch is CancellationError {
            return
        } catch {
            guard id == currentID else { return }
            if loadedFor != id { self.error = error.localizedDescription }
        }
    }
}

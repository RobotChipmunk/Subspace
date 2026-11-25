import SwiftUI

struct TodosThreadReply: Decodable {
    var messages: [Post]
}

/// A task's conversation: what is asked and answered about it, under its notes and apart from
/// them. What the owner writes goes to whoever the task is given to, else to the agent they name,
/// else to the default agent; every agent that has spoken hears the rest.
struct TodosThread: View {
    var todoID: String
    /// The name of the agent the task is given to, if any.
    var to: String?

    @Environment(AppModel.self) private var app
    @State private var messages: [Post] = []
    @State private var text = ""
    @State private var busy = false
    @State private var problem = ""

    var body: some View {
        let meID = app.me?.id
        let handles = app.handles
        let ready = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let name = to ?? app.defaultAgent?.name ?? "an agent"
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(messages.enumerated()), id: \.element.id) { item in
                ChatRow(
                    post: item.element,
                    mine: item.element.author == meID,
                    gap: nil,
                    about: nil,
                    face: Self.face(messages, item.offset, meID: meID) ? app.agent(item.element.author) : nil,
                    handles: handles,
                    tag: "todos.thread",
                    onPage: { id in app.presentedPage = PageTarget(id: id) }
                )
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Message \(name)", text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.ink)
                    .padding(.vertical, 6)
                    .accessibilityIdentifier("todos.thread.message")
                SendButton(show: ready, busy: busy) { send() }
                    .accessibilityIdentifier("todos.thread.send")
            }
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .padding(.top, messages.isEmpty ? 0 : 6)
            if !problem.isEmpty {
                Text(problem)
                    .font(.ssMeta)
                    .foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("todos.thread.error")
            }
        }
        .task(id: todoID) {
            while !Task.isCancelled {
                if app.tab == .todos { await load() }
                try? await Task.sleep(for: .seconds(6))
            }
        }
    }

    /// An agent's message shows its face when the speaker changes.
    private static func face(_ list: [Post], _ index: Int, meID: String?) -> Bool {
        let m = list[index]
        guard m.author != meID else { return false }
        return index == 0 || list[index - 1].author != m.author
    }

    private func send() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !busy else { return }
        busy = true
        problem = ""
        text = ""
        Task {
            do {
                let said = try await app.api.send("POST", "todos/\(todoID)/thread", body: ["body": body], as: Post.self)
                var current = messages.filter { $0.id != said.id }
                current.append(said)
                withAnimation(.ssSoft) { messages = current }
                await load()
            } catch {
                // Put the words back so nothing typed is lost.
                if text.isEmpty { text = body }
                problem = error.localizedDescription
            }
            busy = false
        }
    }

    private func load() async {
        guard let r = try? await app.api.get("todos/\(todoID)/thread", as: TodosThreadReply.self) else { return }
        if messages != r.messages {
            withAnimation(.ssSoft) { messages = r.messages }
        }
    }
}

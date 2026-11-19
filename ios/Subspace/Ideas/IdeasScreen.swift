import SwiftUI

/// Ideas: a place to let an idea grow. The first screen is the ideas themselves, each a small
/// picture of its canvas; an idea opened is the canvas (see IdeaCanvas).
struct IdeasScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var ideas: [IdeaCard] = []
    @State private var loaded = false
    @State private var openID: String? = nil
    @State private var busy = false

    var body: some View {
        ZStack {
            if let id = openID {
                IdeaCanvas(id: id, onOpen: { other in withAnimation(.ssSoft) { openID = other } }) {
                    withAnimation(.ssSoft) { openID = nil }
                    Task { await load() }
                }
                .id(id)
                .transition(.opacity)
            } else {
                shelf.transition(.opacity)
            }
        }
        .task { await load() }
        // an address that names an idea ("/ideas?idea=<id>", as a task made of one does) opens its canvas
        .onChange(of: app.pendingIdeaID, initial: true) { _, id in
            guard let id else { return }
            app.pendingIdeaID = nil
            withAnimation(.ssSoft) { openID = id }
        }
    }

    private var shelf: some View {
        let wide = sizeClass == .regular
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Ideas").font(.system(size: 30, weight: .bold)).tracking(-0.9)
                Text("Put an idea down and let it grow. Your agents add to it a little each day; you keep what you like.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
                    .padding(.bottom, 24)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: wide ? 3 : 2), spacing: 12) {
                    Button {
                        start()
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: "plus").font(.system(size: 18, weight: .medium))
                            Text("New idea").font(.system(size: 14.5))
                        }
                        .foregroundStyle(Theme.ink2)
                        .frame(maxWidth: .infinity, minHeight: 188)
                        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(Theme.fill2, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                        .contentShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                    }
                    .buttonStyle(PressStyle(scale: 0.98))
                    .disabled(busy)
                    .accessibilityIdentifier("ideas.new")
                    ForEach(ideas) { idea in
                        card(idea)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 120)
            .column(880)
        }
        .refreshable { await load() }
    }

    private func card(_ idea: IdeaCard) -> some View {
        let count = idea.items ?? 0
        let grew = idea.woken_by.map { "Woken by " + (app.agent($0)?.name ?? "an agent") } ?? (idea.state == "resting" ? "Resting" : idea.last_grown_at.map { "Grew " + agentsAgoPhrase($0) } ?? "Not grown yet")
        return Button {
            withAnimation(.ssSoft) { openID = idea.id }
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                IdeaThumb(dots: idea.preview ?? [])
                    .frame(height: 124)
                    .frame(maxWidth: .infinity)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text((idea.title ?? "").isEmpty ? "Untitled idea" : idea.title ?? "")
                            .font(.system(size: 15.5, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        if (idea.unseen ?? 0) > 0 {
                            Circle().fill(Theme.accent).frame(width: 8, height: 8).accessibilityLabel("\(idea.unseen ?? 0) new")
                        }
                    }
                    (Text("\(grew) · \(count) \(count == 1 ? "piece" : "pieces")").foregroundStyle(Theme.ink3)
                        + Text(idea.ripe == true ? " · Ready" : "").foregroundStyle(Theme.accent))
                        .font(.system(size: 12.5))
                        .lineLimit(1)
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 14)
            }
            .frame(maxWidth: .infinity, minHeight: 188, alignment: .topLeading)
            .glass(radius: 26)
        }
        .buttonStyle(PressStyle(scale: 0.985))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("ideas.card.\(idea.id)")
    }

    private func load() async {
        if let reply: IdeasReply = try? await app.api.get("ideas") {
            withAnimation(.ssSoft) { ideas = reply.ideas ?? [] }
        }
        loaded = true
    }

    private func start() {
        busy = true
        Task {
            if let idea = try? await app.api.send("POST", "ideas", body: [:], as: Idea.self) {
                withAnimation(.ssSoft) { openID = idea.id }
            }
            busy = false
        }
    }
}

/// A small picture of a canvas: a dot where each piece sits, the owner's in ink and the agents' in accent.
private struct IdeaThumb: View {
    var dots: [IdeaCard.Dot]

    var body: some View {
        Canvas { context, size in
            guard !dots.isEmpty else {
                context.fill(Path(ellipseIn: CGRect(x: size.width / 2 - 3, y: size.height / 2 - 3, width: 6, height: 6)), with: .color(Theme.ink3.opacity(0.5)))
                return
            }
            let xs = dots.map(\.x), ys = dots.map(\.y)
            let span = max(400, (xs.max() ?? 0) - (xs.min() ?? 0), ((ys.max() ?? 0) - (ys.min() ?? 0)) * 1.6)
            let cx = ((xs.max() ?? 0) + (xs.min() ?? 0)) / 2, cy = ((ys.max() ?? 0) + (ys.min() ?? 0)) / 2
            let unit = min(size.width / 160, size.height / 100)
            for d in dots {
                let mine = d.mine == true
                let r = (mine ? 4.2 : 3.2) * unit
                let x = size.width / 2 + (d.x - cx) / span * 120 * unit
                let y = size.height / 2 + (d.y - cy) / span * 120 * unit
                context.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)), with: .color(mine ? Theme.ink.opacity(0.55) : Theme.accent.opacity(0.7)))
            }
        }
        .accessibilityHidden(true)
    }
}

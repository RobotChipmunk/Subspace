import SwiftUI

/// The Now rail: notifications for short-lived things the owner must see. Closed, a module is a
/// glance: a picture or icon, when, what, and the one thing to do about it. Opened, it adds a
/// sentence, one small block and its other buttons. Any button takes it off the rail; "Later" keeps
/// it as a task first. One open at a time.
struct RailView: View {
    /// True when shown as a sheet from the right edge; false when docked beside the content.
    var sheet: Bool
    /// The status bar's height. The sheet softens its own top edge; docked, the shell does it.
    var topInset: CGFloat = 0
    @Environment(AppModel.self) private var app
    @State private var openID: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Now").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink3).accessibilityAddTraits(.isHeader)
                    Spacer()
                    if sheet {
                        Button {
                            withAnimation(.ssSpring) { app.railSheet = false }
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink3).frame(width: 36, height: 36).contentShape(Circle())
                        }
                        .buttonStyle(PressStyle(scale: 0.9))
                        .accessibilityLabel("Close")
                        .accessibilityIdentifier("rail.close")
                    }
                }
                .frame(height: 36)
                .padding(.leading, 12)

                ForEach(app.rail) { m in
                    RailModuleView(module: m, open: openID == m.id) {
                        withAnimation(.ssSoft) { openID = openID == m.id ? nil : m.id }
                    }
                    .transition(.opacity.combined(with: .scale(scale: 0.97)))
                }
                if app.rail.isEmpty { EmptyNote("Nothing timely right now.") }
            }
            // 16 from the right edge, the same as the nav bar's gap from the left edge
            .padding(.leading, 12)
            .padding(.trailing, 16)
            .padding(.top, 12)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.hidden)
        .softTopEdge(topInset, active: sheet)
        .background {
            if sheet {
                Rectangle().fill(.regularMaterial).overlay(Theme.surface).ignoresSafeArea()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("rail")
    }
}

/// The small picture at the front of a module. The names are the ones agents choose from
/// (RAIL_ICONS in src/lib/core/rail.ts); each maps to the nearest system symbol.
private let railSymbols: [String: String] = [
    "bell": "bell", "calendar": "calendar", "clock": "clock", "plane": "airplane", "train": "tram", "car": "car", "bed": "bed.double",
    "food": "fork.knife", "package": "shippingbox", "pin": "mappin.and.ellipse", "ticket": "ticket", "money": "banknote", "card": "creditcard",
    "document": "doc.text", "mail": "envelope", "phone": "phone", "person": "person", "home": "house", "health": "heart.text.square",
    "cart": "cart", "weather": "cloud.sun", "key": "key", "tool": "wrench.and.screwdriver", "gift": "gift", "school": "graduationcap",
    "alert": "exclamationmark.triangle", "check": "checkmark.circle", "question": "questionmark.circle",
]

/// The days a module can be kept for, or a waiting task given.
private let railDays: [(view: String, label: String)] = [("today", "Today"), ("tomorrow", "Tomorrow"), ("week", "This week")]

private struct RailModuleView: View {
    var module: RailModule
    var open: Bool
    var toggle: () -> Void
    @Environment(AppModel.self) private var app
    @State private var busy = false
    /// "Later" asks which day; closing the module takes the question back.
    @State private var asking = false

    private var level: String { module.level ?? "info" }
    private var key: String { module.key ?? module.id }
    /// A task waiting for a day. It leaves by being given one, so it has no dismiss and no "Later".
    private var waiting: RailTodoRef? { module.todo }
    /// What it is, at a glance: a problem, something that needs the owner, or something to know.
    private var needsOwner: Bool { module.task != nil || module.todo != nil }
    private var tint: Color { level == "error" ? Theme.danger : level == "warning" ? Theme.warn : needsOwner ? Theme.accent : Theme.ink2 }
    private var wash: Color { level == "error" ? Theme.danger.opacity(0.14) : level == "warning" ? Theme.warn.opacity(0.16) : needsOwner ? Theme.accentSoft : Theme.fill }
    private var symbol: String {
        if let name = module.icon, let known = railSymbols[name] { return known }
        return level != "info" ? "exclamationmark.triangle" : module.todo != nil ? "person" : module.task != nil ? "checkmark.circle" : "bell"
    }
    /// What it offers, most important first: its own actions, then the task and the page it points at.
    private var buttons: [RailAction] {
        let task: [RailAction] = module.task.map { [RailAction(label: "Open task", url: "/todos?open=\($0.id)")] } ?? []
        let page: [RailAction] = module.page.map { [RailAction(label: "Open page", url: "/page/\($0.id)")] } ?? []
        return (module.actions ?? []) + task + page
    }

    var body: some View {
        let m = module
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            header(m)
            if open, hasMore(m) { more(m).transition(.opacity) }
            if asking {
                question.transition(.opacity)
            } else {
                actionRow(m)
            }
            if open, !asking { footer(m).transition(.opacity) }
        }
        .background(Theme.surface, in: shape)
        .overlay(shape.strokeBorder(Theme.line, lineWidth: 1))
        .shadow(color: open ? Theme.shadowLift : Theme.shadow, radius: open ? 24 : 12, x: 0, y: open ? 12 : 6)
        .onChange(of: open) { _, now in
            if !now { asking = false }
        }
    }

    private func hasMore(_ m: RailModule) -> Bool {
        !(m.subtitle ?? "").isEmpty || !(m.blocks ?? []).isEmpty
    }

    /// When and what, with the picture at its front. Tapping it opens and closes the module.
    private func header(_ m: RailModule) -> some View {
        let label = (m.label ?? "").isEmpty ? (level == "error" ? "Error" : level == "warning" ? "Warning" : "") : (m.label ?? "")
        return Button(action: toggle) {
            HStack(alignment: .top, spacing: 10) {
                tile(m)
                VStack(alignment: .leading, spacing: 1) {
                    if !label.isEmpty {
                        Text(label).font(.system(size: 11.5, weight: .medium)).foregroundStyle(level == "info" ? Theme.ink3 : tint).lineLimit(1)
                    }
                    Text(m.title).font(.system(size: 14.5, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(open ? nil : 2).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, 12)
            .padding(.trailing, waiting == nil ? 36 : 12)
            .padding(.top, 12)
            .padding(.bottom, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel([level == "info" ? "" : level, label, m.title].filter { !$0.isEmpty }.joined(separator: ", "))
        .accessibilityHint(open ? "Closes the details" : "Opens the details")
        .accessibilityIdentifier("rail.module.\(key)")
        .overlay(alignment: .topTrailing) {
            // closed without acting on it
            if waiting == nil {
                Button {
                    Task { await app.dismissRail(m.id) }
                } label: {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.ink3).frame(width: 36, height: 36).contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(scale: 0.9))
                .accessibilityLabel("Dismiss \(m.title)")
                .accessibilityIdentifier("rail.dismiss.\(key)")
            }
        }
    }

    /// A real picture of the thing when there is one; otherwise its icon, or the usual one for what it is.
    @ViewBuilder private func tile(_ m: RailModule) -> some View {
        let shape = RoundedRectangle(cornerRadius: 11, style: .continuous)
        if let image = m.image, !image.isEmpty {
            RemoteImage(image).frame(width: 36, height: 36).background(Theme.fill).clipShape(shape).accessibilityHidden(true)
        } else {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 36, height: 36)
                .background(wash, in: shape)
                .accessibilityHidden(true)
        }
    }

    /// Opened: one sentence, and one small block (the server accepts no more; an older module may still hold several).
    private func more(_ m: RailModule) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let s = m.subtitle, !s.isEmpty {
                Text(s).font(.system(size: 13)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true).padding(.leading, 46)
            }
            ForEach(Array((m.blocks ?? []).enumerated()), id: \.offset) { item in
                BlockView(block: item.element, compact: true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    /// What to do about it: always in sight, and in the same place opened or closed.
    private func actionRow(_ m: RailModule) -> some View {
        let all = buttons
        let shown = open ? all : Array(all.prefix(1))
        return HStack(alignment: .bottom, spacing: 4) {
            FlowRow(spacing: 6) {
                if let todo = waiting {
                    ForEach(Array(railDays.prefix(open ? 3 : 2).enumerated()), id: \.offset) { item in
                        Button(item.element.label) { place(todo.id, item.element.view) }
                            .buttonStyle(PillStyle(soft: item.offset == 0))
                            .disabled(busy)
                            .accessibilityIdentifier("rail.place.\(key).\(item.element.view)")
                    }
                    if open {
                        Button("Open") {
                            withAnimation(.ssSpring) { app.railSheet = false }
                            app.open("/todos?open=\(todo.id)")
                        }
                        .buttonStyle(PillStyle())
                    }
                } else {
                    ForEach(Array(shown.enumerated()), id: \.offset) { item in
                        let a = item.element
                        Button {
                            if a.url.hasPrefix("/") { withAnimation(.ssSpring) { app.railSheet = false } }
                            app.open(a.url)
                            // it has done its job: any button takes the module off the rail
                            Task { await app.railActed(m, label: a.label) }
                        } label: {
                            HStack(spacing: 4) {
                                Text(a.label)
                                if a.url.hasPrefix("http") { Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold)).opacity(0.6) }
                            }
                        }
                        .buttonStyle(PillStyle(soft: item.offset == 0))
                        .accessibilityIdentifier("rail.action.\(key).\(item.offset)")
                    }
                    // nothing to do but know it: saying so is the action
                    if all.isEmpty {
                        Button("Got it") { Task { await app.railActed(m, label: "Got it") } }
                            .buttonStyle(PillStyle(quiet: true))
                            .accessibilityIdentifier("rail.gotit.\(key)")
                    }
                }
            }
            // the row's whole width, less the chevron: beside a spacer it would be offered only half
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: toggle) {
                Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3).rotationEffect(.degrees(open ? 180 : 0)).frame(width: 32, height: 32).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHidden(true)
        }
        .padding(.leading, 58)
        .padding(.trailing, 6)
        .padding(.bottom, open ? 4 : 10)
    }

    /// Who says so, and the way to put it off without losing it.
    private func footer(_ m: RailModule) -> some View {
        HStack(spacing: 6) {
            if let by = app.agent(m.author) {
                AvatarView(agent: by, size: 14)
                Text("\(by.name) · \(ago(m.updated_at))").lineLimit(1)
            } else {
                Text(ago(m.updated_at))
            }
            Spacer(minLength: 0)
            if waiting == nil {
                Button("Later") { withAnimation(.ssSoft) { asking = true } }
                    .buttonStyle(.plain)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 32)
                    .contentShape(Rectangle())
                    .accessibilityHint("Keeps it as a task and takes it off the rail")
                    .accessibilityIdentifier("rail.later.\(key)")
            }
        }
        .font(.system(size: 11.5))
        .foregroundStyle(Theme.ink3)
        .padding(.leading, 58)
        .padding(.trailing, 6)
        .padding(.bottom, 4)
    }

    /// "Later" asks one thing: which day. It takes the whole width, so the three days sit on one line.
    private var question: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Keep as a task for")
                Spacer()
                Button("Cancel") { withAnimation(.ssSoft) { asking = false } }
                    .buttonStyle(.plain)
                    .frame(minHeight: 28)
                    .contentShape(Rectangle())
            }
            .font(.system(size: 11.5))
            .foregroundStyle(Theme.ink3)
            HStack(spacing: 6) {
                ForEach(railDays, id: \.view) { day in
                    Button {
                        busy = true
                        Task { await app.railLater(module, view: day.view) }
                    } label: {
                        Text(day.label).lineLimit(1).minimumScaleFactor(0.85).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PillStyle(tight: true))
                    .disabled(busy)
                    .accessibilityIdentifier("rail.later.\(key).\(day.view)")
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 12)
    }

    /// A task waiting for a day is given one, and leaves the rail by having it.
    private func place(_ id: String, _ view: String) {
        busy = true
        Task {
            try? await app.api.send("PATCH", "todos/\(id)", body: ["view": view])
            await app.refreshRail()
            busy = false
        }
    }
}

/// Lays children out in rows, wrapping to the next row when one is full (chips, small buttons).
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let placed = arrange(bounds.width, subviews)
        for (i, p) in placed.points.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: .unspecified)
        }
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        var points: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
            widest = max(widest, x - spacing)
        }
        return (CGSize(width: widest, height: y + rowHeight), points)
    }
}

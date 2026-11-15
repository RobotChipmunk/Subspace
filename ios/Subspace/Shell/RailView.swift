import SwiftUI

/// The Now rail: small modules for short-lived things the owner must see. Closed, a module is two
/// quiet lines (when, and what); everything else waits behind a tap. One open at a time.
struct RailView: View {
    /// True when shown as a sheet from the right edge; false when docked beside the content.
    var sheet: Bool
    @Environment(AppModel.self) private var app
    @State private var openID: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
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
                .padding(.bottom, 4)

                ForEach(app.rail) { m in
                    RailModuleView(module: m, open: openID == m.id) {
                        withAnimation(.ssSoft) { openID = openID == m.id ? nil : m.id }
                    }
                    .transition(.opacity.combined(with: .scale(scale: 0.97)))
                }
                if app.rail.isEmpty { EmptyNote("Nothing timely right now.") }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.hidden)
        .background {
            if sheet {
                Rectangle().fill(.regularMaterial).overlay(Theme.surface).ignoresSafeArea()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("rail")
    }
}

private struct RailModuleView: View {
    var module: RailModule
    var open: Bool
    var toggle: () -> Void
    @Environment(AppModel.self) private var app
    @State private var busy = false

    private var level: String { module.level ?? "info" }
    private var tone: Color { level == "error" ? Theme.danger : level == "warning" ? Theme.warn : Theme.ink3 }

    var body: some View {
        let m = module
        let label = (m.label ?? "").isEmpty ? (level == "error" ? "Error" : level == "warning" ? "Warning" : "") : (m.label ?? "")
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        if !label.isEmpty {
                            HStack(spacing: 6) {
                                if level != "info" { Circle().fill(tone).frame(width: 6, height: 6) }
                                Text(label).font(.system(size: 11.5, weight: .medium)).foregroundStyle(tone).lineLimit(1)
                            }
                        }
                        Text(m.title).font(.system(size: 14.5, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(open ? nil : 2).multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3).rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel([level == "info" ? "" : level, label, m.title].filter { !$0.isEmpty }.joined(separator: ", "))
            .accessibilityHint(open ? "Closes the details" : "Opens the details")
            .accessibilityIdentifier("rail.module.\(m.key ?? m.id)")

            if open {
                VStack(alignment: .leading, spacing: 10) {
                    if let s = m.subtitle, !s.isEmpty { Text(s).font(.system(size: 13)).foregroundStyle(Theme.ink2) }
                    if let image = m.image, !image.isEmpty {
                        RemoteImage(image).frame(height: 104).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    ForEach(Array((m.blocks ?? []).enumerated()), id: \.offset) { item in
                        BlockView(block: item.element, compact: true)
                    }
                    if let todo = m.todo { place(todo.id) }
                    let actions = (m.actions ?? []) + (m.page.map { [RailAction(label: "Open page", url: "/page/\($0.id)")] } ?? [])
                    if !actions.isEmpty {
                        FlowRow(spacing: 6) {
                            ForEach(Array(actions.enumerated()), id: \.offset) { item in
                                let a = item.element
                                Button {
                                    if a.url.hasPrefix("/") { withAnimation(.ssSpring) { app.railSheet = false } }
                                    app.open(a.url)
                                } label: {
                                    HStack(spacing: 4) {
                                        Text(a.label)
                                        if a.url.hasPrefix("http") { Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.ink3) }
                                    }
                                }
                                .buttonStyle(PillStyle())
                            }
                        }
                    }
                    HStack(spacing: 6) {
                        if let by = app.agent(m.author) {
                            AvatarView(agent: by, size: 14)
                            Text("\(by.name) · \(ago(m.updated_at))").lineLimit(1)
                        } else {
                            Text(ago(m.updated_at))
                        }
                        Spacer(minLength: 0)
                        // a waiting task stays until it is given a day, so it cannot be missed
                        if m.todo == nil {
                            Button("Dismiss") { Task { await app.dismissRail(m.id) } }
                                .buttonStyle(.plain)
                                .padding(.horizontal, 8)
                                .frame(minHeight: 32)
                                .contentShape(Rectangle())
                                .accessibilityLabel("Dismiss \(m.title)")
                                .accessibilityIdentifier("rail.dismiss.\(m.key ?? m.id)")
                        }
                    }
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.ink3)
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
                .transition(.opacity)
            }
        }
        .background(open ? Theme.surface : Color.clear, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(open ? Theme.line : Color.clear, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    /// For a task waiting for a day: one tap puts it on the list. It leaves the rail as soon as it has a place.
    private func place(_ id: String) -> some View {
        FlowRow(spacing: 6) {
            ForEach([("today", "Today"), ("tomorrow", "Tomorrow"), ("week", "This week")], id: \.0) { item in
                let view = item.0
                Button(item.1) {
                    busy = true
                    Task {
                        try? await app.api.send("PATCH", "todos/\(id)", body: ["view": view])
                        await app.refreshRail()
                        busy = false
                    }
                }
                .buttonStyle(PillStyle())
                .disabled(busy)
            }
            Button("Open") {
                withAnimation(.ssSpring) { app.railSheet = false }
                app.open("/todos?open=\(id)")
            }
            .buttonStyle(PillStyle())
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

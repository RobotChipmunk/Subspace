import PhotosUI
import SwiftUI

/// One idea's canvas: a calm, free surface. The owner puts text and pictures on it anywhere;
/// agents branch from those a little each day; and the owner steers with their hands:
///   double-tap empty space   write something there
///   drag a piece             move it
///   drag it onto another     the two belong together (a join is drawn)
///   double-tap a piece       keep it (more like this); on your own text, change the words
///   press and hold           more of this, please
///   flick it away            prune it (not this way); it can be brought back for a moment
/// A chosen piece also offers the same things as quiet buttons, for anyone who would rather tap.
struct IdeaCanvas: View {
    let id: String
    var onBack: () -> Void

    @Environment(AppModel.self) private var app
    @State private var idea: Idea? = nil
    @State private var items: [IdeaItem] = []
    @State private var links: [IdeaLink] = []
    @State private var loaded = false
    @State private var fitted = false

    /// Where the middle of the canvas sits on screen, and how far in it is zoomed.
    @State private var offset: CGSize = .zero
    @State private var panFrom: CGSize? = nil
    @State private var scale: CGFloat = 1
    @State private var zoomFrom: CGFloat? = nil

    @State private var sizes: [String: CGSize] = [:]
    /// A piece being dragged: where it is now, before the server knows.
    @State private var dragging: [String: CGPoint] = [:]
    @State private var target: String? = nil
    @State private var selected: String? = nil
    @State private var editing: String? = nil
    @State private var editText = ""
    @State private var draftAt: CGPoint? = nil
    @State private var draftText = ""
    @State private var undo: IdeaItem? = nil
    @State private var said: (id: String, text: String)? = nil
    @State private var title = ""
    @State private var photo: PhotosPickerItem? = nil
    @FocusState private var focus: Field?

    private enum Field: Hashable { case draft, edit, title }

    private var growing: Bool { idea?.state != "resting" }

    var body: some View {
        GeometryReader { geo in
            let middle = CGPoint(x: geo.size.width / 2 + offset.width, y: geo.size.height / 2 + offset.height)
            ZStack {
                background(geo.size, middle: middle)
                joins(middle: middle)
                ForEach(items) { item in
                    piece(item, middle: middle)
                }
                if let at = draftAt {
                    draftField.position(screen(at, middle))
                }
                if loaded && items.isEmpty && draftAt == nil {
                    Text("Double-tap anywhere to put something down.\nAdd a picture from the button above.")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.ink3)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .allowsHitTesting(false)
                }
                controls
                bottomBar
            }
            .onPreferenceChange(IdeaSizeKey.self) { sizes = $0 }
            .onChange(of: loaded) { _, now in
                if now && !fitted { fit(geo.size) }
            }
        }
        .ignoresSafeArea(.keyboard)
        .task { await watch() }
        .onChange(of: photo) { _, item in photoPicked(item) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ideas.canvas")
    }

    // MARK: The surface

    private func screen(_ p: CGPoint, _ middle: CGPoint) -> CGPoint {
        CGPoint(x: middle.x + p.x * scale, y: middle.y + p.y * scale)
    }

    private func world(_ p: CGPoint, _ middle: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - middle.x) / scale, y: (p.y - middle.y) / scale)
    }

    private func place(_ item: IdeaItem) -> CGPoint {
        dragging[item.id] ?? CGPoint(x: item.x, y: item.y)
    }

    /// A faint field of dots that moves with the canvas, and the gestures that move about on it.
    private func background(_ size: CGSize, middle: CGPoint) -> some View {
        Canvas { context, canvas in
            let step = 28 * scale
            guard step > 8 else { return }
            var x = middle.x.truncatingRemainder(dividingBy: step)
            while x < canvas.width {
                var y = middle.y.truncatingRemainder(dividingBy: step)
                while y < canvas.height {
                    context.fill(Path(ellipseIn: CGRect(x: x - 1, y: y - 1, width: 2, height: 2)), with: .color(Theme.ink.opacity(0.09)))
                    y += step
                }
                x += step
            }
        }
        .contentShape(Rectangle())
        .gesture(
            SpatialTapGesture(count: 2).onEnded { tap in
                selected = nil
                editing = nil
                draftText = ""
                draftAt = world(tap.location, middle)
                focus = .draft
            }
        )
        .simultaneousGesture(TapGesture().onEnded { selected = nil })
        .gesture(
            DragGesture(minimumDistance: 4)
                .onChanged { drag in
                    if panFrom == nil { panFrom = offset }
                    offset = CGSize(width: (panFrom?.width ?? 0) + drag.translation.width, height: (panFrom?.height ?? 0) + drag.translation.height)
                }
                .onEnded { _ in panFrom = nil }
        )
        .simultaneousGesture(
            MagnifyGesture()
                .onChanged { pinch in
                    if zoomFrom == nil { zoomFrom = scale }
                    scale = min(max((zoomFrom ?? 1) * pinch.magnification, 0.3), 2.5)
                }
                .onEnded { _ in zoomFrom = nil }
        )
        .accessibilityLabel("Canvas")
        .accessibilityHint("Double-tap to write here")
        .accessibilityIdentifier("ideas.canvas.surface")
    }

    private func fit(_ size: CGSize) {
        fitted = true
        guard !items.isEmpty else { return }
        let xs = items.map(\.x), ys = items.map(\.y)
        let w = (xs.max() ?? 0) - (xs.min() ?? 0) + 420
        let h = (ys.max() ?? 0) - (ys.min() ?? 0) + 420
        let k = min(max(min(size.width / w, size.height / h), 0.35), 1)
        scale = k
        offset = CGSize(width: -((xs.max() ?? 0) + (xs.min() ?? 0)) / 2 * k, height: -((ys.max() ?? 0) + (ys.min() ?? 0)) / 2 * k)
    }

    // MARK: Joins

    /// Where a line from the middle of a piece towards a point leaves the piece, a little outside it.
    private func edge(_ c: CGPoint, _ size: CGSize?, towards to: CGPoint) -> CGPoint {
        let hw = (size?.width ?? 120) / 2 + 10, hh = (size?.height ?? 44) / 2 + 10
        let dx = to.x - c.x, dy = to.y - c.y
        if dx == 0 && dy == 0 { return c }
        let t = min(min(hw / max(abs(dx), 0.0001), hh / max(abs(dy), 0.0001)), 1)
        return CGPoint(x: c.x + dx * t, y: c.y + dy * t)
    }

    /// Soft curved lines between pieces that belong together, each bowed a little to one side so
    /// no two look ruled. An agent's join is dotted and carries its words; the owner's are in accent.
    private func joins(middle: CGPoint) -> some View {
        Canvas { context, _ in
            for link in links {
                guard let a = items.first(where: { $0.id == link.a }), let b = items.first(where: { $0.id == link.b }) else { continue }
                let pa = place(a), pb = place(b)
                let p = edge(pa, sizes[a.id], towards: pb), q = edge(pb, sizes[b.id], towards: pa)
                let len = max(hypot(q.x - p.x, q.y - p.y), 1)
                let h = stableHash(link.id)
                let bow = (h % 2 == 1 ? 1.0 : -1.0) * (0.1 + Double(h % 9) / 100) * len
                let mid = CGPoint(x: (p.x + q.x) / 2 + (-(q.y - p.y) / len) * bow, y: (p.y + q.y) / 2 + ((q.x - p.x) / len) * bow)
                let mine = app.agent(link.author)?.isHuman == true
                var path = Path()
                path.move(to: screen(p, middle))
                path.addQuadCurve(to: screen(q, middle), control: screen(mid, middle))
                let colour = mine ? Theme.accent.opacity(0.55) : Theme.ink3.opacity(0.6)
                context.stroke(path, with: .color(colour), style: StrokeStyle(lineWidth: 1.8, lineCap: .round, dash: mine ? [] : [0.1, 7]))
                let end = screen(q, middle)
                context.fill(Path(ellipseIn: CGRect(x: end.x - 2.6, y: end.y - 2.6, width: 5.2, height: 5.2)), with: .color(mine ? Theme.accent.opacity(0.6) : Theme.ink3.opacity(0.6)))
                if let label = link.label, !label.isEmpty {
                    let at = screen(CGPoint(x: (p.x + 2 * mid.x + q.x) / 4, y: (p.y + 2 * mid.y + q.y) / 4 - 8), middle)
                    context.draw(Text(label).font(.system(size: 12, design: .rounded).italic()).foregroundStyle(Theme.ink3), at: at)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    // MARK: Pieces

    private func isMine(_ item: IdeaItem) -> Bool { app.agent(item.author)?.isHuman == true }

    private func piece(_ item: IdeaItem, middle: CGPoint) -> some View {
        let mine = isMine(item)
        let isDragging = dragging[item.id] != nil
        return pieceBody(item, mine: mine)
            .overlay(alignment: .topTrailing) { marks(item) }
            .overlay(alignment: .bottom) {
                if let said, said.id == item.id {
                    Text(said.text)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 5)
                        .glass(radius: 14)
                        .fixedSize()
                        .offset(y: 36)
                        .transition(.opacity)
                }
            }
            .background(GeometryReader { g in Color.clear.preference(key: IdeaSizeKey.self, value: [item.id: g.size]) })
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(target == item.id ? Theme.accent : selected == item.id ? Theme.accentSoft : Color.clear, lineWidth: 2)
            )
            .scaleEffect(scale * (isDragging ? 1.04 : 1))
            .position(screen(place(item), middle))
            .zIndex(isDragging ? 10 : 0)
            .gesture(
                DragGesture(minimumDistance: 6)
                    .onChanged { drag in
                        guard editing != item.id else { return }
                        let at = CGPoint(x: item.x + drag.translation.width / scale, y: item.y + drag.translation.height / scale)
                        dragging[item.id] = at
                        // over another piece: letting go here joins the two
                        target = items.first { other in
                            guard other.id != item.id else { return false }
                            let s = sizes[other.id] ?? CGSize(width: 160, height: 60)
                            return abs(other.x - at.x) < s.width / 2 && abs(other.y - at.y) < s.height / 2
                        }?.id
                    }
                    .onEnded { drag in dropped(item, drag) }
            )
            .onTapGesture(count: 2) {
                if mine && item.kind == "text" {
                    selected = nil
                    editText = item.text ?? ""
                    editing = item.id
                    focus = .edit
                } else {
                    keep(item)
                }
            }
            .onTapGesture { selected = item.id }
            .onLongPressGesture(minimumDuration: 0.56) { more(item) }
            .transition(.scale(scale: 0.7).combined(with: .opacity))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(label(item, mine: mine))
            .accessibilityAddTraits(item.kept == true ? .isSelected : [])
            .accessibilityIdentifier("ideas.piece.\(item.id)")
    }

    private func label(_ item: IdeaItem, mine: Bool) -> String {
        let who = mine ? "Yours" : (app.agent(item.author)?.name ?? "An agent")
        let what = (item.text ?? "").isEmpty ? "a picture" : item.text ?? ""
        return "\(who): \(what)" + (item.kept == true ? ", kept" : "")
    }

    @ViewBuilder private func pieceBody(_ item: IdeaItem, mine: Bool) -> some View {
        if mine && item.kind == "text" {
            if editing == item.id {
                TextField("", text: $editText, axis: .vertical)
                    .font(ideaFont(item.size))
                    .multilineTextAlignment(.center)
                    .focused($focus, equals: .edit)
                    .submitLabel(.done)
                    .onSubmit { finishEdit(item) }
                    .onChange(of: focus) { _, now in
                        if now != .edit && editing == item.id { finishEdit(item) }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(width: 300)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .accessibilityIdentifier("ideas.piece.edit")
            } else {
                Text(item.text ?? "")
                    .font(ideaFont(item.size))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
        } else if mine && item.kind == "image" {
            RemoteImage(item.image, contentMode: .fill)
                .frame(width: 220, height: 170)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 15, x: 0, y: 10)
                .rotationEffect(.degrees(Double(stableHash(item.id) % 300) / 100 - 1.5))
        } else {
            agentPiece(item)
        }
    }

    /// An agent's piece: a rounded container in that agent's own quiet tint, so who added what is
    /// seen without a label.
    private func agentPiece(_ item: IdeaItem) -> some View {
        let by = app.agent(item.author)
        let tint = Color(hex: Palette.forSeed(stableHash(by?.handle ?? "?")).colors[0])
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        return VStack(alignment: .leading, spacing: 0) {
            if item.image != nil {
                RemoteImage(item.image, contentMode: .fill)
                    .frame(width: 236, height: 150)
                    .clipped()
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if let by { AvatarView(agent: by, size: 15) }
                    Text(by?.name ?? "").lineLimit(1)
                    if let word = ideaKindWord(item.kind) {
                        Text(word)
                            .font(.system(size: 11.5, weight: .medium))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Theme.ink.opacity(0.07), in: Capsule())
                    }
                }
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.ink3)
                if let text = item.text, !text.isEmpty {
                    Text(text)
                        .font(.system(size: 14.5))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let url = item.source?.url, !url.isEmpty {
                    Button {
                        app.open(url)
                    } label: {
                        HStack(spacing: 2) {
                            Text(item.source?.name ?? (URL(string: url)?.host ?? url)).underline().lineLimit(1)
                            Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.ink3)
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.ink2)
                        .frame(minHeight: 28)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)
            .padding(.bottom, 12)
        }
        .frame(width: 236, alignment: .leading)
        .background {
            ZStack {
                Theme.solid
                tint.opacity(0.26)
            }
        }
        .clipShape(shape)
        .overlay(shape.strokeBorder(tint.opacity(0.55), lineWidth: 1))
        .shadow(color: .black.opacity(0.07), radius: 12, x: 0, y: 8)
    }

    /// Kept: a small star at its corner. New since the owner last looked: a soft accent dot.
    @ViewBuilder private func marks(_ item: IdeaItem) -> some View {
        if item.kept == true {
            Image(systemName: "star.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(Theme.accent, in: Circle())
                .offset(x: 6, y: -6)
                .accessibilityHidden(true)
        } else if item.seen == false {
            Circle().fill(Theme.accent).frame(width: 10, height: 10).offset(x: 4, y: -4).accessibilityLabel("New")
        }
    }

    private var draftField: some View {
        TextField("Write…", text: $draftText, axis: .vertical)
            .font(.system(size: 24, weight: .semibold, design: .rounded))
            .multilineTextAlignment(.center)
            .focused($focus, equals: .draft)
            .submitLabel(.done)
            .onSubmit { putDown() }
            .onChange(of: focus) { _, now in
                if now != .draft && draftAt != nil { putDown() }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(width: 300)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.accentSoft, lineWidth: 2))
            .accessibilityIdentifier("ideas.draft")
    }

    // MARK: Controls

    /// The way back, the idea's name, and the few things that are about the whole idea.
    private var controls: some View {
        VStack {
            HStack(spacing: 6) {
                Button(action: onBack) {
                    Image(systemName: "chevron.left").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink2).frame(width: 40, height: 40)
                }
                .buttonStyle(PressStyle(scale: 0.92))
                .glass(radius: 20)
                .accessibilityLabel("All ideas")
                .accessibilityIdentifier("ideas.back")
                TextField("Untitled idea", text: $title)
                    .font(.system(size: 15, weight: .semibold))
                    .focused($focus, equals: .title)
                    .submitLabel(.done)
                    .onSubmit { focus = nil }
                    .onChange(of: focus) { before, now in
                        if before == .title && now != .title { rename() }
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 40)
                    .frame(maxWidth: 240)
                    .glass(radius: 20)
                    .accessibilityLabel("Idea name")
                    .accessibilityIdentifier("ideas.title")
                Spacer(minLength: 0)
                PhotosPicker(selection: $photo, matching: .images) {
                    Image(systemName: "photo.badge.plus").font(.system(size: 15)).foregroundStyle(Theme.ink2).frame(width: 40, height: 40)
                }
                .glass(radius: 20)
                .accessibilityLabel("Add a picture")
                .accessibilityIdentifier("ideas.picture")
                Button {
                    setState(growing ? "resting" : "growing")
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: growing ? "leaf" : "moon").font(.system(size: 13, weight: .medium))
                        Text(growing ? "Growing" : "Resting").font(.system(size: 13.5, weight: .medium))
                    }
                    .foregroundStyle(growing ? Theme.accent : Theme.ink3)
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                }
                .buttonStyle(PressStyle(scale: 0.96))
                .glass(radius: 20)
                .accessibilityLabel(growing ? "Growing. Tap to let it rest" : "Resting. Tap to let it grow")
                .accessibilityIdentifier("ideas.state")
                ConfirmDelete(label: "Remove idea", confirm: "Remove", size: 15) {
                    try? await app.api.send("DELETE", "ideas/\(id)")
                    onBack()
                }
                .frame(minWidth: 40, minHeight: 40)
                .glass(radius: 20)
                .accessibilityIdentifier("ideas.remove")
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            Spacer(minLength: 0)
        }
    }

    /// What a chosen piece offers, for anyone who would rather tap than gesture; or, after a prune, the way to bring it back.
    @ViewBuilder private var bottomBar: some View {
        VStack {
            Spacer(minLength: 0)
            if let gone = undo {
                HStack(spacing: 8) {
                    Text("Pruned " + ((gone.text ?? "").isEmpty ? "a picture" : "“\((gone.text ?? "").prefix(32))”"))
                        .font(.system(size: 13.5))
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(1)
                    Button("Bring back") { bringBack(gone) }
                        .buttonStyle(PillStyle(soft: true))
                        .accessibilityIdentifier("ideas.undo")
                }
                .padding(.leading, 16)
                .padding(.trailing, 6)
                .padding(.vertical, 6)
                .glass(radius: 24)
                .transition(.opacity)
            } else if let chosen = items.first(where: { $0.id == selected }), editing == nil {
                HStack(spacing: 2) {
                    act(chosen.kept == true ? "star.fill" : "star", chosen.kept == true ? "Kept. Tap to let go" : "Keep: more like this", on: chosen.kept == true, id: "keep") { keep(chosen) }
                    act("sparkles", "More of this", id: "more") { more(chosen) }
                    if isMine(chosen) && chosen.kind == "text" {
                        act("textformat.size.smaller", "Smaller", id: "smaller") { resize(chosen, by: -1) }
                        act("textformat.size.larger", "Larger", id: "larger") { resize(chosen, by: 1) }
                    }
                    act("scissors", "Prune: not this way", id: "prune") { prune(chosen) }
                }
                .padding(4)
                .glass(radius: 24)
                .transition(.opacity)
            }
        }
        .padding(.bottom, 76)
    }

    private func act(_ symbol: String, _ label: String, on: Bool = false, id: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(on ? Theme.accent : Theme.ink2)
                .frame(width: 44, height: 44)
                .background(on ? Theme.accentSoft : Color.clear, in: Circle())
        }
        .buttonStyle(PressStyle(scale: 0.9))
        .accessibilityLabel(label)
        .accessibilityIdentifier("ideas.act.\(id)")
    }

    // MARK: What the owner does

    private func dropped(_ item: IdeaItem, _ drag: DragGesture.Value) {
        guard let at = dragging[item.id] else { return }
        let over = target
        target = nil
        let speed = hypot(drag.velocity.width, drag.velocity.height)
        if let over {
            // they belong together: the piece goes home and a join is drawn
            withAnimation(.ssSpring) { dragging[item.id] = nil }
            Task {
                try? await app.api.send("POST", "ideas/\(id)/joins", body: ["a": item.id, "b": over])
                await load()
            }
        } else if speed > 1500 {
            dragging[item.id] = nil
            prune(item)
        } else {
            if let index = items.firstIndex(where: { $0.id == item.id }) {
                items[index].x = at.x
                items[index].y = at.y
            }
            dragging[item.id] = nil
            Task { try? await app.api.send("PATCH", "idea-items/\(item.id)", body: ["x": at.x, "y": at.y]) }
        }
    }

    private func keep(_ item: IdeaItem) {
        let now = !(item.kept == true)
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            withAnimation(.ssSpring) { items[index].kept = now }
        }
        Task { try? await app.api.send("PATCH", "idea-items/\(item.id)", body: ["kept": now]) }
    }

    private func more(_ item: IdeaItem) {
        withAnimation(.ssSoft) { said = (item.id, "Asking for more") }
        Task {
            let reply = try? await app.api.send("POST", "idea-items/\(item.id)/more", as: IdeaMoreReply.self)
            let names = reply?.to ?? []
            withAnimation(.ssSoft) {
                said = (item.id, reply == nil ? "Could not ask just now" : names.isEmpty ? "Asked for more" : "Asked \(names.joined(separator: " and ")) for more")
            }
            try? await Task.sleep(for: .milliseconds(2200))
            if said?.id == item.id { withAnimation(.ssSoft) { said = nil } }
        }
    }

    private func prune(_ item: IdeaItem) {
        selected = nil
        withAnimation(.ssSoft) {
            items.removeAll { $0.id == item.id }
            undo = item
        }
        Task {
            try? await app.api.send("DELETE", "idea-items/\(item.id)")
            try? await Task.sleep(for: .seconds(6))
            if undo?.id == item.id { withAnimation(.ssSoft) { undo = nil } }
        }
    }

    private func bringBack(_ item: IdeaItem) {
        withAnimation(.ssSoft) { undo = nil }
        Task {
            try? await app.api.send("POST", "idea-items/\(item.id)/restore")
            await load()
        }
    }

    private func resize(_ item: IdeaItem, by step: Int) {
        let next = min(max((item.size ?? 2) + step, 1), 4)
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            withAnimation(.ssSpring) { items[index].size = next }
        }
        Task { try? await app.api.send("PATCH", "idea-items/\(item.id)", body: ["size": next]) }
    }

    private func finishEdit(_ item: IdeaItem) {
        guard editing == item.id else { return }
        let text = editText.trimmingCharacters(in: .whitespacesAndNewlines)
        editing = nil
        guard !text.isEmpty, text != item.text else { return }
        if let index = items.firstIndex(where: { $0.id == item.id }) { items[index].text = text }
        Task { try? await app.api.send("PATCH", "idea-items/\(item.id)", body: ["text": text]) }
    }

    private func putDown() {
        guard let at = draftAt else { return }
        let text = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        draftAt = nil
        draftText = ""
        if focus == .draft { focus = nil }
        guard !text.isEmpty else { return }
        Task {
            try? await app.api.send("POST", "ideas/\(id)/items", body: ["kind": "text", "text": text, "x": at.x, "y": at.y, "size": text.count <= 28 ? 3 : 2])
            await load()
        }
    }

    private func rename() {
        let wanted = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard wanted != (idea?.title ?? "") else { return }
        Task {
            try? await app.api.send("PATCH", "ideas/\(id)", body: ["title": wanted])
            await load()
        }
    }

    private func setState(_ state: String) {
        idea?.state = state
        Task {
            try? await app.api.send("PATCH", "ideas/\(id)", body: ["state": state])
            await load()
        }
    }

    private func photoPicked(_ item: PhotosPickerItem?) {
        guard let item else { return }
        photo = nil
        Task {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.85) else { return }
            guard let url = try? await app.api.upload(jpeg, mime: "image/jpeg", filename: "idea.jpg") else { return }
            // in the middle of what is in view
            let at = CGPoint(x: -offset.width / scale, y: -offset.height / scale)
            try? await app.api.send("POST", "ideas/\(id)/items", body: ["kind": "image", "image": url, "x": at.x, "y": at.y])
            await load()
        }
    }

    // MARK: Data

    private func load() async {
        guard let reply: IdeaCanvasReply = try? await app.api.get("ideas/\(id)") else { return }
        // what is being dragged or was just thrown away stays as the owner left it
        let gone = undo?.id
        withAnimation(.ssSpring) {
            idea = reply.idea
            items = (reply.items ?? []).filter { $0.id != gone }
            links = reply.links ?? []
        }
        if focus != .title { title = reply.idea.title ?? "" }
        loaded = true
    }

    /// Reads the canvas, tells the server it has been looked at, and keeps reading so what agents add arrives by itself.
    private func watch() async {
        await load()
        try? await Task.sleep(for: .milliseconds(2500))
        try? await app.api.send("POST", "ideas/\(id)/seen")
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(15))
            if Task.isCancelled { break }
            if dragging.isEmpty && editing == nil && draftAt == nil { await load() }
        }
    }
}

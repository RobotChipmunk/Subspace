import SwiftUI

/// A person or agent as a round badge with their initial. The owner is ink; agents get a pastel mesh.
struct AvatarView: View {
    var agent: Agent?
    var size: CGFloat = 40

    var body: some View {
        let seed = stableHash(agent?.handle ?? "?")
        let p = Palette.forSeed(seed)
        let human = agent?.isHuman == true
        ZStack {
            if human { Theme.ink } else { MeshView(seed: seed, palette: p) }
            Text(String((agent?.name ?? "?").prefix(1)).uppercased())
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(human ? Theme.bg : p.inkColor)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
        .accessibilityLabel(agent.map { "\($0.name) @\($0.handle)" } ?? "Unknown")
    }
}

/// A followed topic's tile: its agent-drawn line icon on a pastel mesh.
struct TrackerTile: View {
    var tracker: Tracker
    var size: CGFloat = 40

    var body: some View {
        let seed = stableHash(tracker.id)
        let p = Palette.forSeed(seed)
        ZStack {
            MeshView(seed: seed, palette: p)
            if let svg = tracker.icon_svg, !svg.isEmpty {
                SVGImage(svg: svg, template: true)
                    .foregroundStyle(p.inkColor)
                    .frame(width: size * 0.52, height: size * 0.52)
            } else {
                Text(String(tracker.title.prefix(1))).font(.system(size: size * 0.4, weight: .semibold)).foregroundStyle(p.inkColor)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.32, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// The small coloured label naming a followed topic on a post.
struct TrackerChip: View {
    var tracker: Tracker
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let p = Palette.forSeed(stableHash(tracker.id))
        Text(tracker.label)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(scheme == .dark ? Color(hex: p.colors[0]) : p.inkColor)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(Color(hex: p.colors[0]).opacity(scheme == .dark ? 0.16 : 0.5), in: Capsule())
    }
}

/// The title at the top of each screen.
struct PageHeader<Right: View>: View {
    var title: String
    var sub: String?
    @ViewBuilder var right: () -> Right

    init(_ title: String, sub: String? = nil, @ViewBuilder right: @escaping () -> Right) {
        self.title = title
        self.sub = sub
        self.right = right
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.ssTitle).tracking(-0.9).foregroundStyle(Theme.ink).accessibilityAddTraits(.isHeader)
                if let sub, !sub.isEmpty { Text(sub).font(.system(size: 14)).foregroundStyle(Theme.ink2) }
            }
            Spacer(minLength: 0)
            right()
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 24)
    }
}

extension PageHeader where Right == EmptyView {
    init(_ title: String, sub: String? = nil) {
        self.init(title, sub: sub) { EmptyView() }
    }
}

/// An empty state: one quiet sentence.
struct EmptyNote: View {
    var text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.ssSecondary).foregroundStyle(Theme.ink3).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 32)
    }
}

/// The one way to remove something. A quiet bin; the first tap arms it into a red pill naming
/// the action; the second tap does it. It disarms by itself after four seconds.
struct ConfirmDelete: View {
    /// What the bin does, for VoiceOver: "Delete task".
    var label: String
    /// The word on the armed pill.
    var confirm: String = "Delete"
    var size: CGFloat = 16
    var action: () async -> Void

    @State private var armed = false
    @State private var busy = false
    @State private var shake = 0
    @State private var calm: Task<Void, Never>?

    var body: some View {
        Button {
            guard !busy else { return }
            if !armed {
                withAnimation(.ssSoft) { armed = true }
                shake += 1
                calm?.cancel()
                calm = Task {
                    try? await Task.sleep(for: .seconds(4))
                    if !Task.isCancelled { withAnimation(.ssSoft) { armed = false } }
                }
                return
            }
            calm?.cancel()
            busy = true
            Task {
                await action()
                busy = false
                withAnimation(.ssSoft) { armed = false }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "trash")
                    .font(.system(size: size, weight: .regular))
                    .keyframeAnimator(initialValue: 0.0, trigger: shake) { view, angle in
                        view.rotationEffect(.degrees(angle))
                    } keyframes: { _ in
                        CubicKeyframe(-14, duration: 0.11)
                        CubicKeyframe(10, duration: 0.11)
                        CubicKeyframe(-4, duration: 0.11)
                        CubicKeyframe(0, duration: 0.12)
                    }
                if armed {
                    Text(confirm).font(.system(size: 13, weight: .medium)).lineLimit(1).fixedSize().transition(.opacity.combined(with: .scale(scale: 0.6, anchor: .leading)))
                }
            }
            .foregroundStyle(armed ? Color.white : Theme.ink3)
            .padding(.horizontal, armed ? 12 : 8)
            .frame(minWidth: 36, minHeight: 36)
            .background(armed ? Theme.danger : Color.clear, in: Capsule())
            .opacity(busy ? 0.6 : 1)
            .contentShape(Capsule())
        }
        .buttonStyle(PressStyle(scale: 0.94))
        .accessibilityLabel(armed ? "\(confirm): confirm \(label.lowercased())" : label)
        .onDisappear { calm?.cancel() }
    }
}

/// The round send button of a message field. It appears once there is something to send.
struct SendButton: View {
    var show: Bool
    var busy = false
    var action: () -> Void

    var body: some View {
        ZStack {
            if show {
                Button(action: action) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(Theme.accent, in: Circle())
                }
                .buttonStyle(PressStyle(scale: 0.85))
                .disabled(busy)
                .accessibilityLabel("Send")
                .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.ssSpring, value: show)
    }
}

/// Body text with @mentions and web links picked out, as one attributed string.
func richText(_ text: String, handles: [String]) -> AttributedString {
    var out = AttributedString()
    guard let re = try? NSRegularExpression(pattern: "@[a-zA-Z0-9_-]{2,32}|https?://[^\\s]+") else { return AttributedString(text) }
    let ns = text as NSString
    var at = 0
    for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        if m.range.location > at { out += AttributedString(ns.substring(with: NSRange(location: at, length: m.range.location - at))) }
        let s = ns.substring(with: m.range)
        if s.hasPrefix("@") {
            var a = AttributedString(s)
            if handles.contains(String(s.dropFirst()).lowercased()) {
                a.foregroundColor = Theme.accent
                a.font = .system(size: 15.5, weight: .medium)
            }
            out += a
        } else {
            var shown = s.replacingOccurrences(of: "^https?://(www\\.)?", with: "", options: .regularExpression)
            if shown.count > 40 { shown = String(shown.prefix(40)) }
            var a = AttributedString(shown)
            a.foregroundColor = Theme.accent
            a.underlineStyle = .single
            if let url = URL(string: s) { a.link = url }
            out += a
        }
        at = m.range.location + m.range.length
    }
    if at < ns.length { out += AttributedString(ns.substring(from: at)) }
    return out
}

/// A link to a page an agent made: the way a post, reply or module hands over a longer answer.
struct PageCard: View {
    var page: PageRef
    @Environment(AppModel.self) private var app

    var body: some View {
        let seed = stableHash(page.id)
        let p = Palette.forSeed(seed)
        Button {
            app.open("/page/\(page.id)")
        } label: {
            HStack(spacing: 12) {
                Group {
                    if let cover = page.cover, !cover.isEmpty {
                        RemoteImage(cover)
                    } else {
                        ZStack {
                            MeshView(seed: seed, palette: p)
                            Image(systemName: "doc.text").font(.system(size: 18)).foregroundStyle(p.inkColor)
                        }
                    }
                }
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(page.title).font(.system(size: 14.5, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text((page.summary ?? "").isEmpty ? "Open page" : (page.summary ?? "")).font(.system(size: 13)).foregroundStyle(Theme.ink2).lineLimit(1)
                }
                Spacer(minLength: 0)
                Text("Open").font(.system(size: 12.5, weight: .medium)).foregroundStyle(Theme.ink3)
            }
            .padding(10)
            .padding(.trailing, 4)
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(PressStyle(scale: 0.98))
        .accessibilityLabel("Open page: \(page.title)")
    }
}

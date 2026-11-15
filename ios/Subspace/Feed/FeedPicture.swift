import SwiftUI

/// A post's picture. Video plays in place as it scrolls into view; anything else opens the source when tapped.
struct FeedPicture: View {
    var post: Post
    var model: FeedModel

    var body: some View {
        if let media = post.media, media.type == "image" {
            if let images = media.images, images.count > 1 {
                FeedPictures(post: post, images: images).padding(.top, 12)
            } else {
                FeedSinglePicture(post: post, media: media).padding(.top, 12)
            }
        } else if let media = post.media, media.type == "video" {
            FeedClip(post: post, media: media, model: model).padding(.top, 12)
        } else if let art = post.art, (art.status ?? "none") != "none" {
            FeedArtPanel(art: art)
                .aspectRatio(2, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .modifier(FeedToSource(source: post.source))
                .padding(.top, 12)
                .accessibilityHidden(true)
        }
    }
}

/// One picture, in its own shape.
private struct FeedSinglePicture: View {
    var post: Post
    var media: Media
    @State private var ratio: CGFloat = 1.6

    var body: some View {
        let shape = min(3, max(0.5, ratio))
        RemoteImage(media.url, onRatio: { r in ratio = r })
            .aspectRatio(shape, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .frame(maxHeight: 520)
            .modifier(FeedToSource(source: post.source))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(media.title ?? "Picture")
            .accessibilityAddTraits(.isImage)
            .accessibilityIdentifier("feed.picture.\(post.id)")
    }
}

/// Several pictures on one post: swipe sideways, dots show how many and which. The frame takes the
/// shape of the first picture; one of a clearly different shape is shown whole rather than cropped.
private struct FeedPictures: View {
    var post: Post
    var images: [PostImage]
    @State private var at = 0
    @State private var shapes: [Int: CGFloat] = [:]

    var body: some View {
        let shape = min(2.4, max(0.8, shapes[0] ?? 1.6))
        VStack(spacing: 10) {
            TabView(selection: $at) {
                ForEach(Array(images.enumerated()), id: \.offset) { item in
                    FeedSlide(image: item.element, known: shapes[item.offset], box: shape) { r in
                        shapes[item.offset] = r
                    }
                    .modifier(FeedToSource(source: post.source))
                    .tag(item.offset)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .background(Theme.fill)
            .aspectRatio(shape, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .animation(.ssSoft, value: shape)
            FeedDots(count: images.count, at: at)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(images.count) pictures")
        .accessibilityValue("Picture \(at + 1) of \(images.count)")
        .accessibilityIdentifier("feed.pictures.\(post.id)")
    }
}

private struct FeedSlide: View {
    var image: PostImage
    var known: CGFloat?
    var box: CGFloat
    var onRatio: (CGFloat) -> Void

    /// Close to the frame's shape: fill it. Clearly different: show the whole picture.
    private var fits: Bool {
        guard let known, box > 0 else { return true }
        return abs(known / box - 1) < 0.12
    }

    var body: some View {
        RemoteImage(image.url, contentMode: fits ? .fill : .fit, onRatio: onRatio)
    }
}

/// Six-point dots under a set of pictures; the current one is in accent.
private struct FeedDots: View {
    var count: Int
    var at: Int

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<count, id: \.self) { i in
                Circle()
                    .fill(i == at ? Theme.accent : Theme.ink3)
                    .opacity(i == at ? 1 : 0.45)
                    .scaleEffect(i == at ? 1 : 0.84)
                    .frame(width: 6, height: 6)
            }
        }
        .animation(.ssSoft, value: at)
        .accessibilityHidden(true)
    }
}

/// The feed's visual language: a pastel backdrop with a code-drawn illustration floating on it,
/// or a soft pulsing dot while the illustration is still being drawn.
struct FeedArtPanel: View {
    var art: Art
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let seed = UInt32(truncatingIfNeeded: art.seed)
        let palette = Palette.named(art.palette, seed: seed)
        let dark = scheme == .dark
        let base = dark ? Color(hex: "#17171D") : Color(hex: palette.colors[3])
        let drawing = feedArtSVG(art.svg, ink: palette.ink, dark: dark)
        ZStack {
            base
            MeshView(seed: seed, palette: palette, deepInDark: true)
                .scaleEffect(1.2)
                .blur(radius: 18)
            if let drawing {
                SVGImage(svg: drawing)
                    .padding(10)
                    .shadow(color: Color(hex: "#3C285A").opacity(0.16), radius: 12, x: 0, y: 10)
            } else if art.status == "pending" {
                FeedPendingDot()
            }
        }
        .clipped()
    }
}

/// Illustrations are drawn for the light theme. In dark mode ink goes near-black and white dims a little.
private func feedArtSVG(_ svg: String?, ink: String, dark: Bool) -> String? {
    guard let svg, !svg.isEmpty else { return nil }
    guard dark else { return svg }
    let hex = ink.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    let n = UInt32(hex, radix: 16) ?? 0
    let r = Int((Double((n >> 16) & 255) * 0.38).rounded())
    let g = Int((Double((n >> 8) & 255) * 0.38).rounded())
    let b = Int((Double(n & 255) * 0.38).rounded())
    let shaded = String(format: "#%02lx%02lx%02lx", r, g, b)
    let inked = svg.replacingOccurrences(of: ink, with: shaded, options: [.caseInsensitive])
    return inked.replacingOccurrences(of: "(#fff(?:fff)?\\b|\\bwhite\\b)", with: "#f3f1fa", options: [.regularExpression, .caseInsensitive])
}

private struct FeedPendingDot: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathe = false

    var body: some View {
        let dark = scheme == .dark
        Circle()
            .fill(Color.white.opacity(dark ? 0.25 : 0.6))
            .frame(width: 64, height: 64)
            .shadow(color: Color.white.opacity(dark ? 0.18 : 0.6), radius: 15, x: 0, y: 8)
            .scaleEffect(breathe ? 0.94 : 1)
            .opacity(breathe ? 0.55 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1.3).repeatForever(autoreverses: true)) { breathe = true }
            }
    }
}

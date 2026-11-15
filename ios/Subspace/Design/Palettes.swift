import SwiftUI

/// The visual language shared with the web app (src/lib/palettes.ts). Same table, same order,
/// so a post or avatar gets the same colours everywhere.
struct Palette {
    let name: String
    let colors: [String]
    let ink: String

    static let all: [Palette] = [
        Palette(name: "dawn", colors: ["#FFC9B5", "#F7B1D0", "#C9B8FF", "#FFE7A8"], ink: "#5B3A6B"),
        Palette(name: "lagoon", colors: ["#A8E6FF", "#B5F5D8", "#C4C8FF", "#E3FBFF"], ink: "#1F4E6B"),
        Palette(name: "orchid", colors: ["#E2B8FF", "#FFB8E1", "#B8C9FF", "#FFD9F2"], ink: "#4B2E78"),
        Palette(name: "meadow", colors: ["#C6F3B0", "#FFF2A6", "#A8EBD9", "#DFF7C2"], ink: "#2F5A3D"),
        Palette(name: "ember", colors: ["#FFB8A8", "#FFD6A0", "#FFA8C5", "#FFE9C7"], ink: "#7A3327"),
        Palette(name: "glacier", colors: ["#BFD7FF", "#D4C8FF", "#B8F0F5", "#EEF3FF"], ink: "#2B3F7A"),
        Palette(name: "sorbet", colors: ["#FFC2E0", "#FFDFA8", "#B9F2E2", "#D6C4FF"], ink: "#6B3358"),
        Palette(name: "dusk", colors: ["#B9B4FF", "#F2AEDA", "#9FD8FF", "#FFCDB8"], ink: "#33306E"),
    ]

    static func forSeed(_ seed: UInt32) -> Palette { all[Int(seed % UInt32(all.count))] }
    static func named(_ name: String?, seed: UInt32) -> Palette { all.first { $0.name == name } ?? forSeed(seed) }

    var inkColor: Color { Color(hex: ink) }

    /// The night version of a pastel: same hue, richer and much deeper.
    static func deep(_ hex: String) -> Color {
        let n = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        let r = Double((n >> 16) & 255) / 255, g = Double((n >> 8) & 255) / 255, b = Double(n & 255) / 255
        let mx = max(r, g, b), mn = min(r, g, b), d = mx - mn
        var h = 0.0
        if d > 0 {
            if mx == r { h = ((g - b) / d).truncatingRemainder(dividingBy: 6) }
            else if mx == g { h = (b - r) / d + 2 }
            else { h = (r - g) / d + 4 }
        }
        var hue = (h * 60).truncatingRemainder(dividingBy: 360)
        if hue < 0 { hue += 360 }
        // hsl(h 52% 30%) converted to HSB
        let l = 0.30, s = 0.52
        let v = l + s * min(l, 1 - l)
        let sb = v == 0 ? 0 : 2 * (1 - l / v)
        return Color(hue: hue / 360, saturation: sb, brightness: v)
    }
}

/// A pastel mesh built from layered radial gradients, placed by a stable seed (see `mesh` in bits.tsx).
struct MeshView: View {
    let seed: UInt32
    let palette: Palette
    @Environment(\.colorScheme) private var scheme
    /// Deepen the colours in dark mode. Avatars and tiles keep their pastels; post art deepens.
    var deepInDark = false

    private func r(_ n: Int) -> Double { Double((seed >> UInt32((n * 3) % 32)) % 100) / 100 }

    var body: some View {
        let colors: [Color] = palette.colors.map { deepInDark && scheme == .dark ? Palette.deep($0) : Color(hex: $0) }
        GeometryReader { geo in
            let side = max(geo.size.width, geo.size.height)
            ZStack {
                LinearGradient(colors: [colors[0], colors[2]], startPoint: .top, endPoint: .bottom)
                    .rotationEffect(.degrees(r(7) * 360))
                    .scaleEffect(1.6)
                ForEach(Array(colors.enumerated().reversed()), id: \.offset) { item in
                    let i = item.offset
                    let c = item.element
                    RadialGradient(
                        colors: [c, c.opacity(0)],
                        center: UnitPoint(x: 0.12 + r(i) * 0.76, y: 0.10 + r(i + 4) * 0.80),
                        startRadius: 0,
                        endRadius: side * (0.46 + r(i + 2) * 0.18)
                    )
                }
            }
        }
        .clipped()
    }
}

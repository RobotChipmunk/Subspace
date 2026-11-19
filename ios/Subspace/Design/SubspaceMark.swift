import SwiftUI

/// The Subspace mark: particles in a latent space. A sparse sphere of neutral particles is the
/// space; through it, tilted, runs a sheet of coloured ones, the subspace. It turns slowly, so the
/// sheet is seen from every side, and it is drawn for the mode the screen is in: deep colours on
/// light, glowing pastels on dark. The geometry is the same on the web (src/components/Mark.tsx)
/// and in the icons (scripts/mark.swift); change all three together.
struct SubspaceMark: View {
    var size: CGFloat = 140

    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // thirty frames a second is plenty for something this slow; it holds still for anyone who asked for less motion
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { timeline in
            let seconds = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, canvas in
                SubspaceMark.paint(&context, side: min(canvas.width, canvas.height), dark: scheme == .dark, angle: 0.5 + seconds / 60 * 2 * .pi)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    // MARK: Geometry

    private struct Particle {
        var x: Double, y: Double, z: Double
        /// True for the coloured sheet, false for the neutral space around it.
        var sheet: Bool
        /// Where round the palette its colour comes from.
        var t: Double
        var s: Double
    }

    private struct Random {
        var a: UInt32
        mutating func next() -> Double {
            a = a &+ 0x6D2B_79F5
            var t = (a ^ (a >> 15)) &* (1 | a)
            t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
            return Double(t ^ (t >> 14)) / 4_294_967_296.0
        }
    }

    private static let light: [UInt32] = [0xFF8A65, 0xF0609E, 0x8B6CF6, 0x3BA9F5, 0x2CC79A, 0xF5B62E]
    private static let dark: [UInt32] = [0xFFC9B5, 0xF7B1D0, 0xC9B8FF, 0xA8E6FF, 0xB5F5D8, 0xFFE7A8]

    private static let particles: [Particle] = {
        var r = Random(a: 11)
        var out: [Particle] = []
        let golden = 2.39996323
        let tiltX = 0.52, tiltZ = -0.40
        // the latent space: a sparse shell of neutral particles
        let n = 58
        for i in 0..<n {
            let y = 1 - (2 * (Double(i) + 0.5)) / Double(n)
            let rad = (1 - y * y).squareRoot()
            let th = Double(i) * golden
            let k = 0.88 + r.next() * 0.12
            out.append(Particle(x: cos(th) * rad * k, y: y * k, z: sin(th) * rad * k, sheet: false, t: 0, s: 0.7 + r.next() * 0.6))
        }
        // the subspace: a tilted sheet of coloured particles through its middle
        let m = 72
        for i in 0..<m {
            let a = Double(i) * golden
            let d = ((Double(i) + 0.5) / Double(m)).squareRoot() * 0.8
            let lift = (r.next() - 0.5) * 0.05
            let x = cos(a) * d, z = sin(a) * d
            let y1 = lift * cos(tiltX) - z * sin(tiltX)
            let z1 = lift * sin(tiltX) + z * cos(tiltX)
            out.append(Particle(x: x * cos(tiltZ) - y1 * sin(tiltZ), y: x * sin(tiltZ) + y1 * cos(tiltZ), z: z1, sheet: true, t: (a / (2 * .pi)).truncatingRemainder(dividingBy: 1), s: 0.75 + r.next() * 0.5))
        }
        return out
    }()

    private static func channels(_ hex: UInt32) -> (Double, Double, Double) {
        (Double((hex >> 16) & 255) / 255, Double((hex >> 8) & 255) / 255, Double(hex & 255) / 255)
    }

    private static func hue(_ palette: [UInt32], _ t: Double) -> (Double, Double, Double) {
        let x = (t - t.rounded(.down)) * Double(palette.count)
        let i = Int(x) % palette.count
        let f = x - x.rounded(.down)
        let a = channels(palette[i]), b = channels(palette[(i + 1) % palette.count])
        return (a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f, a.2 + (b.2 - a.2) * f)
    }

    /// One frame: the particles turned by `angle` about the upright axis and drawn back to front.
    private static func paint(_ context: inout GraphicsContext, side: CGFloat, dark: Bool, angle: Double) {
        let palette = dark ? SubspaceMark.dark : SubspaceMark.light
        let c = cos(angle), s = sin(angle)
        let span = 0.4
        let px = Double(side)
        struct Seen { var x: Double, y: Double, depth: Double, k: Double, particle: Particle }
        var seen: [Seen] = particles.map { p in
            let turnedX = p.x * c + p.z * s
            let turnedZ = -p.x * s + p.z * c
            let k = 1 / (1 - turnedZ * 0.22)
            return Seen(x: (0.5 + turnedX * span * k) * px, y: (0.5 - p.y * span * k) * px, depth: (turnedZ + 1) / 2, k: k, particle: p)
        }
        seen.sort { $0.depth < $1.depth }
        for e in seen {
            let rgb: (Double, Double, Double) = e.particle.sheet ? hue(palette, e.particle.t) : (dark ? (1, 1, 1) : (0.09, 0.09, 0.11))
            let radius = (e.particle.sheet ? 2.05 : 1.15) * e.particle.s * (0.6 + 0.4 * e.depth) * e.k / 100 * px
            let opacity = e.particle.sheet ? 0.45 + 0.55 * e.depth : (dark ? 0.16 + 0.44 * e.depth : 0.12 + 0.36 * e.depth)
            let colour = Color(.sRGB, red: rgb.0, green: rgb.1, blue: rgb.2, opacity: opacity)
            let dot = Path(ellipseIn: CGRect(x: e.x - radius, y: e.y - radius, width: radius * 2, height: radius * 2))
            if dark && e.particle.sheet {
                // on dark the coloured particles glow a little
                var glowing = context
                glowing.addFilter(.shadow(color: Color(.sRGB, red: rgb.0, green: rgb.1, blue: rgb.2, opacity: 0.55 * opacity), radius: radius * 0.8))
                glowing.fill(dot, with: .color(colour))
            } else {
                context.fill(dot, with: .color(colour))
            }
        }
    }
}

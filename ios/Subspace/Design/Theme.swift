import SwiftUI
import UIKit

/// The colour tokens of DESIGN.md, light and dark. Never write a raw colour in a screen.
enum Theme {
    private static func dyn(_ light: UIColor, _ dark: UIColor) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
    private static func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
    }

    /// Page background, behind the ambient light.
    static let bg = dyn(rgb(0xF4F3F1), rgb(0x0D0D10))
    /// Translucent tint laid over blur for glass.
    static let surface = dyn(UIColor(white: 1, alpha: 0.66), rgb(0x222228, 0.62))
    /// Opaque surfaces: menus, lifted rows.
    static let solid = dyn(.white, rgb(0x1C1C21))
    static let ink = dyn(rgb(0x1D1D1F), rgb(0xF5F5F7))
    static let ink2 = dyn(rgb(0x6E6E73), rgb(0xA1A1A8))
    static let ink3 = dyn(rgb(0xA1A1A6), rgb(0x6B6B73))
    /// Hairlines on glass only; never between list rows.
    static let line = dyn(UIColor(white: 0, alpha: 0.07), UIColor(white: 1, alpha: 0.09))
    static let fill = dyn(UIColor(white: 0, alpha: 0.045), UIColor(white: 1, alpha: 0.06))
    static let fill2 = dyn(UIColor(white: 0, alpha: 0.08), UIColor(white: 1, alpha: 0.11))
    static let accent = dyn(rgb(0x6B5CF6), rgb(0x9D92FF))
    static let accentSoft = dyn(rgb(0x6B5CF6, 0.12), rgb(0x9D92FF, 0.16))
    /// Marks text an agent wrote in the owner's notes.
    static let ai = dyn(rgb(0x6B5CF6, 0.14), rgb(0x9D92FF, 0.18))
    static let aiLine = dyn(rgb(0x6B5CF6, 0.55), rgb(0x9D92FF, 0.7))
    static let danger = Color(rgb(0xE5484D))
    static let good = dyn(rgb(0x1F9D55), rgb(0x4CC38A))
    static let warn = dyn(rgb(0xB7791F), rgb(0xE0A84A))
    static let shadow = dyn(rgb(0x1E143C, 0.07), UIColor(white: 0, alpha: 0.35))
    static let shadowLift = dyn(rgb(0x1E143C, 0.16), UIColor(white: 0, alpha: 0.55))

    /// Content never grows wider than this.
    static let column: CGFloat = 880
}

extension Animation {
    /// Direct responses: taps, toggles, sheets, the nav indicator.
    static let ssSpring = Animation.interpolatingSpring(mass: 0.9, stiffness: 420, damping: 36)
    /// Things entering, leaving or resizing.
    static let ssSoft = Animation.interpolatingSpring(mass: 1, stiffness: 260, damping: 30)
}

extension Color {
    /// "#RRGGBB".
    init(hex: String) {
        let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        let n = UInt32(s, radix: 16) ?? 0
        self.init(red: Double((n >> 16) & 255) / 255, green: Double((n >> 8) & 255) / 255, blue: Double(n & 255) / 255)
    }
}

extension Font {
    /// Page title: 30 bold.
    static let ssTitle = Font.system(size: 30, weight: .bold)
    /// Detail title (a task, a note): 26 bold.
    static let ssDetailTitle = Font.system(size: 26, weight: .bold)
    /// Body and list rows.
    static let ssBody = Font.system(size: 15.5)
    static let ssRowTitle = Font.system(size: 15.5, weight: .medium)
    /// Secondary line, in ink2.
    static let ssSecondary = Font.system(size: 13.5)
    /// Meta line, in ink3.
    static let ssMeta = Font.system(size: 12.5)
    /// Small label or section heading.
    static let ssLabel = Font.system(size: 12, weight: .semibold)
}

// MARK: Surfaces

private struct Glass: ViewModifier {
    var radius: CGFloat
    var lifted: Bool
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background(Theme.surface, in: shape)
            .background(.ultraThinMaterial, in: shape)
            .overlay(shape.strokeBorder(Theme.line, lineWidth: 1))
            .shadow(color: lifted ? Theme.shadowLift : Theme.shadow, radius: lifted ? 30 : 15, x: 0, y: lifted ? 18 : 8)
    }
}

extension View {
    /// The frosted surface for things that float over content: the nav, cards, composers.
    func glass(radius: CGFloat = 22, lifted: Bool = false) -> some View { modifier(Glass(radius: radius, lifted: lifted)) }

    /// Centres content in the reading column (at most `max` wide).
    func column(_ max: CGFloat = Theme.column) -> some View {
        frame(maxWidth: max).frame(maxWidth: .infinity)
    }
}

/// Buttons scale down a little while pressed.
struct PressStyle: ButtonStyle {
    var scale: CGFloat = 0.96
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.ssSpring, value: configuration.isPressed)
    }
}

/// A quiet round button on `fill`: "Today", "Reconnect", "Open".
struct PillStyle: ButtonStyle {
    var prominent = false
    /// The one thing to do in its place (a rail module's first button): accent on a soft accent wash.
    var soft = false
    /// Stands back: an acknowledgement rather than an action ("Got it").
    var quiet = false
    /// Less padding at the sides, for pills that share one line equally.
    var tight = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(prominent ? Color.white : soft ? Theme.accent : quiet ? Theme.ink2 : Theme.ink)
            .padding(.horizontal, tight ? 4 : 12)
            .frame(minHeight: 32)
            .background(prominent ? Theme.accent : soft ? Theme.accentSoft : (configuration.isPressed ? Theme.fill2 : Theme.fill), in: Capsule())
            .opacity(soft && configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.ssSpring, value: configuration.isPressed)
    }
}

/// Slow pastel light behind everything. It holds still under Reduce Motion.
struct AmbientBackground: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift = false

    var body: some View {
        GeometryReader { geo in
            let m = max(geo.size.width, geo.size.height)
            let glow = scheme == .dark ? 0.2 : 0.55
            ZStack {
                Theme.bg
                blob("#FFD3E4", m * 0.6).position(x: m * 0.2, y: m * 0.05).offset(x: drift ? m * 0.14 : 0, y: drift ? m * 0.1 : 0)
                blob("#CFE0FF", m * 0.6).position(x: geo.size.width + m * 0.05, y: m * 0.4).offset(x: drift ? -m * 0.12 : 0, y: drift ? m * 0.08 : 0)
                blob("#DCD2FF", m * 0.6).position(x: m * 0.5, y: geo.size.height + m * 0.05).offset(x: drift ? m * 0.08 : 0, y: drift ? -m * 0.12 : 0)
                blob("#FFF0C9", m * 0.4).position(x: 0, y: geo.size.height).offset(x: drift ? m * 0.1 : 0, y: drift ? -m * 0.06 : 0)
            }
            .overlay(Theme.bg.opacity(1 - glow).allowsHitTesting(false))
            .background(Theme.bg)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 52).repeatForever(autoreverses: true)) { drift = true }
        }
    }

    private func blob(_ hex: String, _ size: CGFloat) -> some View {
        Circle().fill(Color(hex: hex)).frame(width: size, height: size).blur(radius: 90)
    }
}

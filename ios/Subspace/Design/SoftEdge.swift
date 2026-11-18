import SwiftUI
import UIKit

/// The top of the screen has no bar. Content that scrolls up under the status bar blurs and thins
/// out, barely at first and completely by the top edge, so the clock stays readable. At rest
/// nothing is drawn there: the fade is a mask on the content and the blur has no tint.
enum SoftEdge {
    /// How far below the status bar the effect starts. Short enough that nothing resting at the
    /// top of a screen (a title, the comments panel, the rail's heading) is touched.
    static let reach: CGFloat = 20
    /// The blur at full strength, in points.
    static let radius: CGFloat = 14

    /// How much of the content is taken away at `u`, which runs from 0 where the effect starts
    /// to 1 at the top edge. Both curves steepen towards the top.
    static func fade(_ u: Double) -> Double { min(1, pow(max(0, u) / 0.75, 1.7)) }
    /// How much of the blur is applied at `u`.
    static func blur(_ u: Double) -> Double { min(1, pow(max(0, u) / 0.65, 2)) }

    /// The fade as a mask, top to bottom: clear where content is gone, black where it is whole.
    static let maskStops: [Gradient.Stop] = (0...16).map { i in
        let t = Double(i) / 16
        return Gradient.Stop(color: Color.black.opacity(1 - SoftEdge.fade(1 - t)), location: t)
    }
}

private struct SoftTopEdge: ViewModifier {
    /// The height of the status bar: the top safe-area inset.
    var inset: CGFloat

    func body(content: Content) -> some View {
        let height = inset + SoftEdge.reach
        content
            .mask {
                VStack(spacing: 0) {
                    LinearGradient(stops: SoftEdge.maskStops, startPoint: .top, endPoint: .bottom)
                        .frame(height: height)
                    Color.black
                }
                .ignoresSafeArea()
            }
            .overlay {
                ProgressiveBlur()
                    .frame(height: height)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
    }
}

extension View {
    /// Softens whatever scrolls up under the status bar. `inset` is the top safe-area inset.
    @ViewBuilder func softTopEdge(_ inset: CGFloat, active: Bool = true) -> some View {
        if active { modifier(SoftTopEdge(inset: inset)) } else { self }
    }
}

private struct ProgressiveBlur: UIViewRepresentable {
    func makeUIView(context: Context) -> ProgressiveBlurView { ProgressiveBlurView(radius: SoftEdge.radius) }
    func updateUIView(_ view: ProgressiveBlurView, context: Context) {}
}

/// A blur of what lies behind it that grows from nothing at its lower edge to full at the top,
/// following `SoftEdge.blur`, with no tint of its own.
///
/// UIKit has no public blur that varies across a view. This borrows the backdrop layer of a
/// visual effect view and gives it Core Animation's `variableBlur` filter, the one the system's
/// own soft edges use. Both are reached by name, so if either is ever missing the view hides
/// itself and the fade is left to do the work alone.
final class ProgressiveBlurView: UIVisualEffectView {
    private let filter: NSObject?

    init(radius: CGFloat) {
        filter = ProgressiveBlurView.makeFilter(radius: radius)
        super.init(effect: UIBlurEffect(style: .regular))
        isUserInteractionEnabled = false
        // UIKit rebuilds the effect when the appearance changes; put ours back after it has.
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: ProgressiveBlurView, _: UITraitCollection) in
            DispatchQueue.main.async { view.apply() }
        }
        apply()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        apply()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        apply()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        // Deliberately not passed to super: it would rebuild the effect over the borrowed layer.
    }

    private func apply() {
        guard let filter, let backdrop = subviews.first?.layer, NSStringFromClass(type(of: backdrop)).contains("Backdrop") else {
            isHidden = true
            return
        }
        isHidden = false
        // Only the variable blur: the effect's own blur, saturation and tint would show as a bar.
        backdrop.filters = [filter]
        // Sample at the screen's scale, or the lightly blurred end looks pixelated.
        backdrop.setValue(traitCollection.displayScale, forKey: "scale")
        for view in subviews.dropFirst() { view.alpha = 0 }
    }

    private static func makeFilter(radius: CGFloat) -> NSObject? {
        let make = NSSelectorFromString("filterWithType:")
        guard let type = NSClassFromString("CAFilter") as? NSObject.Type,
              (type as AnyObject).responds(to: make),
              let filter = type.perform(make, with: "variableBlur")?.takeUnretainedValue() as? NSObject,
              let mask = maskImage()
        else { return nil }
        filter.setValue(radius, forKey: "inputRadius")
        filter.setValue(mask, forKey: "inputMaskImage")
        filter.setValue(true, forKey: "inputNormalizeEdges")
        return filter
    }

    /// The blur's strength down the view, as the alpha of a thin image: opaque is full blur.
    private static func maskImage() -> CGImage? {
        let rows = 128
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        format.preferredRange = .standard
        let image = UIGraphicsImageRenderer(size: CGSize(width: 4, height: rows), format: format).image { context in
            for row in 0..<rows {
                let u = 1 - (Double(row) + 0.5) / Double(rows)
                UIColor.black.withAlphaComponent(SoftEdge.blur(u)).setFill()
                context.fill(CGRect(x: 0, y: row, width: 4, height: 1))
            }
        }
        return image.cgImage
    }
}

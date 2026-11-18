import SafariServices
import SwiftUI
import UIKit

/// Web links open inside the app, in the system's own viewer, over whatever is on screen: a
/// screen, a page in a sheet, the comments. "Done" returns to exactly where the link was tapped.
/// Anything that is not a web page (mail, phone, maps) still goes to the app that handles it.
@MainActor
enum WebViewer {
    static func open(_ url: URL) {
        let scheme = url.scheme?.lowercased() ?? ""
        guard scheme == "http" || scheme == "https", let top = topController() else {
            UIApplication.shared.open(url)
            return
        }
        let viewer = SFSafariViewController(url: url)
        viewer.preferredControlTintColor = UIColor(Theme.accent)
        viewer.dismissButtonStyle = .done
        top.present(viewer, animated: true)
    }

    /// The controller in front, so a link tapped inside a sheet opens over that sheet.
    private static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
        var top = window?.rootViewController
        while let next = top?.presentedViewController, !next.isBeingDismissed {
            top = next
        }
        return top
    }
}

import SwiftUI
import UIKit
import WebKit

/// Pictures fetched once and kept in memory.
@MainActor
final class ImageStore {
    static let shared = ImageStore()
    private let cache = NSCache<NSString, UIImage>()
    private var loading: [String: Task<UIImage?, Never>] = [:]

    func cached(_ key: String) -> UIImage? { cache.object(forKey: key as NSString) }

    func image(for url: URL, api: API) async -> UIImage? {
        let key = url.absoluteString
        if let hit = cached(key) { return hit }
        if let running = loading[key] { return await running.value }
        let task = Task<UIImage?, Never> {
            guard let data = try? await api.data(from: url), let img = UIImage(data: data) else { return nil }
            return await img.byPreparingForDisplay() ?? img
        }
        loading[key] = task
        let img = await task.value
        loading[key] = nil
        if let img { cache.setObject(img, forKey: key as NSString) }
        return img
    }
}

/// A picture from the server or the web. Fills its frame by default; a quiet `fill` shows while
/// it loads, and stays if it cannot be loaded.
struct RemoteImage: View {
    var ref: String?
    var contentMode: ContentMode = .fill
    /// Reports the picture's width divided by its height once known.
    var onRatio: ((CGFloat) -> Void)?
    /// Reports that there is no picture to show: no address, or it could not be loaded.
    var onFailed: (() -> Void)?

    @Environment(AppModel.self) private var app
    @State private var image: UIImage?

    init(_ ref: String?, contentMode: ContentMode = .fill, onRatio: ((CGFloat) -> Void)? = nil, onFailed: (() -> Void)? = nil) {
        self.ref = ref
        self.contentMode = contentMode
        self.onRatio = onRatio
        self.onFailed = onFailed
    }

    var body: some View {
        // Color.clear takes exactly the offered space, so a wide picture can never push its frame wider.
        Color.clear
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode).transition(.opacity)
                } else {
                    Theme.fill
                }
            }
            .clipped()
            .task(id: ref) {
                guard let url = app.api.resolve(ref) else {
                    onFailed?()
                    return
                }
                let img = await ImageStore.shared.image(for: url, api: app.api)
                guard !Task.isCancelled else { return }
                if let img, img.size.height > 0 {
                    onRatio?(img.size.width / img.size.height)
                } else {
                    onFailed?()
                }
                withAnimation(.easeOut(duration: 0.25)) { image = img }
            }
            .accessibilityHidden(true)
    }
}

/// Draws SVG code (post illustrations, topic icons) into a picture, off screen, once.
/// The SVG is loaded as an image inside an empty page with scripts off, so it can never run code.
@MainActor
final class SVGRenderer: NSObject {
    static let shared = SVGRenderer()
    private let cache = NSCache<NSString, UIImage>()
    private var queue: [(key: String, svg: String, side: CGFloat, done: (UIImage?) -> Void)] = []
    private var busy = false
    private var web: WKWebView?

    func cached(_ svg: String, side: CGFloat) -> UIImage? { cache.object(forKey: Self.key(svg, side) as NSString) }

    private static func key(_ svg: String, _ side: CGFloat) -> String { "\(Int(side)):\(svg.hashValue)" }

    func render(_ svg: String, side: CGFloat) async -> UIImage? {
        let key = Self.key(svg, side)
        if let hit = cache.object(forKey: key as NSString) { return hit }
        return await withCheckedContinuation { (c: CheckedContinuation<UIImage?, Never>) in
            queue.append((key, svg, side, { c.resume(returning: $0) }))
            next()
        }
    }

    private func next() {
        guard !busy, !queue.isEmpty else { return }
        let job = queue.removeFirst()
        if let hit = cache.object(forKey: job.key as NSString) {
            job.done(hit)
            return next()
        }
        busy = true
        Task {
            let img = await draw(job.svg, side: job.side)
            if let img { cache.setObject(img, forKey: job.key as NSString) }
            job.done(img)
            busy = false
            next()
        }
    }

    private func draw(_ svg: String, side: CGFloat) async -> UIImage? {
        let view: WKWebView
        if let web {
            view = web
        } else {
            let config = WKWebViewConfiguration()
            config.defaultWebpagePreferences.allowsContentJavaScript = false
            view = WKWebView(frame: CGRect(x: 0, y: 0, width: side, height: side), configuration: config)
            view.isOpaque = false
            view.backgroundColor = .clear
            view.scrollView.backgroundColor = .clear
            view.isUserInteractionEnabled = false
            view.accessibilityElementsHidden = true
            // A web view draws only while it is in a window and on screen. It sits at the very back,
            // behind the app's own opaque background, so it is never seen.
            guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap({ $0.windows }).first(where: { $0.isKeyWindow }) ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap({ $0.windows }).first else { return nil }
            window.insertSubview(view, at: 0)
            web = view
        }
        view.frame = CGRect(x: 0, y: 0, width: side, height: side)
        // As a picture, SVG needs its namespace; agents sometimes leave it out.
        let source = svg.contains("xmlns=") ? svg : svg.replacingOccurrences(of: "<svg", with: "<svg xmlns=\"http://www.w3.org/2000/svg\"", options: [], range: svg.range(of: "<svg"))
        let encoded = Data(source.utf8).base64EncodedString()
        let html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><style>html,body{margin:0;height:100%;background:transparent}img{width:100%;height:100%;object-fit:contain;display:block}</style><img src='data:image/svg+xml;base64,\(encoded)'>"
        let loaded = Loader()
        view.navigationDelegate = loaded
        view.loadHTMLString(html, baseURL: nil)
        await loaded.wait()
        try? await Task.sleep(for: .milliseconds(80))
        let config = WKSnapshotConfiguration()
        config.rect = CGRect(x: 0, y: 0, width: side, height: side)
        let img = try? await view.takeSnapshot(configuration: config)
        view.navigationDelegate = nil
        return img
    }

    private final class Loader: NSObject, WKNavigationDelegate {
        private var continuation: CheckedContinuation<Void, Never>?
        private var finished = false

        func wait() async {
            if finished { return }
            await withCheckedContinuation { continuation = $0 }
        }
        private func finish() {
            finished = true
            continuation?.resume()
            continuation = nil
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish() }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish() }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish() }
    }
}

/// SVG code as a picture. With `template`, it is tinted by the foreground style (line icons).
struct SVGImage: View {
    var svg: String
    var template = false
    /// The side, in points, the drawing is prepared at.
    var side: CGFloat = 512

    @State private var image: UIImage?

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    Image(uiImage: image).renderingMode(template ? .template : .original).resizable().aspectRatio(contentMode: .fit).transition(.opacity)
                }
            }
            .task(id: svg) {
                let source = template ? svg.replacingOccurrences(of: "currentColor", with: "#000") : svg
                let s = template ? min(side, 128) : side
                if let hit = SVGRenderer.shared.cached(source, side: s) {
                    image = hit
                    return
                }
                let img = await SVGRenderer.shared.render(source, side: s)
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.25)) { image = img }
            }
            .accessibilityHidden(true)
    }
}

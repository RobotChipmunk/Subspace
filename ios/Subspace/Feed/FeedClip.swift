import SwiftUI
import UIKit
import AVKit
import WebKit

/// Moving pictures in the feed: video files, clips that repeat like a GIF, and YouTube or Vimeo
/// players. Whichever file video is most in view plays, silently; the rest wait.
struct FeedClip: View {
    var post: Post
    var media: Media
    var model: FeedModel

    var body: some View {
        if media.embed != nil {
            FeedEmbedClip(post: post, media: media)
        } else {
            FeedFileClip(post: post, media: media, model: model)
        }
    }
}

/// A video file. It plays without sound as it comes into view; a tap turns the sound on or off.
/// A looping clip has no sound and no controls, and opens the source like a picture.
private struct FeedFileClip: View {
    var post: Post
    var media: Media
    var model: FeedModel

    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var player: AVPlayer?
    @State private var shape: CGFloat?
    /// Set when the system player cannot read the file (WebM): a web view plays it instead.
    @State private var useWeb = false
    @State private var started = false

    private var loop: Bool { media.loop == true }

    var body: some View {
        let playing = model.playingClip == post.id
        let muted = loop || !model.sound
        let ratio = min(2.4, max(0.62, shape ?? (16.0 / 9.0)))
        ZStack(alignment: .bottomTrailing) {
            Color.black
            FeedClipSurface(
                url: app.api.resolve(media.url),
                poster: started ? nil : media.poster,
                player: player,
                useWeb: useWeb,
                still: still,
                playing: playing,
                muted: muted,
                onShape: { r in shape = r }
            )
            if !loop && !still {
                FeedSoundButton(model: model).padding(4)
            }
        }
        .aspectRatio(ratio, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .frame(maxHeight: 560)
        .background {
            FeedFrameReporter { frame in model.clipMoved(post.id, frame) }
        }
        .gesture(TapGesture().onEnded { tapped() }, including: still ? .subviews : .all)
        .task(id: media.url) { await prepare() }
        .onDisappear {
            model.clipMoved(post.id, nil)
            player?.pause()
            player = nil
            started = false
        }
        .onChange(of: playing) { _, now in apply(now, muted) }
        .onChange(of: muted) { _, now in apply(playing, now) }
        .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime)) { note in
            again(note, playing)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(media.title ?? "Video")
        .accessibilityIdentifier("feed.clip.\(post.id)")
    }

    private func tapped() {
        if loop {
            if let source = post.source { app.open(source.url) }
        } else {
            model.sound.toggle()
        }
    }

    /// Makes the player and waits until the file is known to be playable, or not.
    private func prepare() async {
        guard !useWeb, let url = app.api.resolve(media.url) else { return }
        let item = AVPlayerItem(url: url)
        let made = AVPlayer(playerItem: item)
        made.isMuted = true
        made.actionAtItemEnd = .none
        player = made
        for _ in 0..<150 {
            if Task.isCancelled { return }
            if item.status == .failed {
                player = nil
                useWeb = true
                return
            }
            if item.status == .readyToPlay {
                let size = item.presentationSize
                if size.width > 0 && size.height > 0 { shape = size.width / size.height }
                apply(model.playingClip == post.id, loop || !model.sound)
                return
            }
            try? await Task.sleep(for: .milliseconds(200))
        }
    }

    private func apply(_ playing: Bool, _ muted: Bool) {
        guard let player else { return }
        player.isMuted = muted
        if playing {
            player.play()
            started = true
        } else {
            player.pause()
        }
    }

    /// Every clip repeats.
    private func again(_ note: Notification, _ playing: Bool) {
        guard let player, let item = note.object as? AVPlayerItem, item === player.currentItem else { return }
        player.seek(to: CMTime.zero)
        if playing { player.play() }
    }
}

/// What a file clip draws: the system player's picture, the system player with its controls under
/// Reduce Motion, or a web view for files the system player cannot read.
private struct FeedClipSurface: View {
    var url: URL?
    var poster: String?
    var player: AVPlayer?
    var useWeb: Bool
    var still: Bool
    var playing: Bool
    var muted: Bool
    var onShape: (CGFloat) -> Void

    var body: some View {
        ZStack {
            if useWeb, let url {
                FeedWebVideo(url: url, playing: playing, muted: muted, controls: still, onShape: onShape)
                    .allowsHitTesting(still)
            } else if let player {
                if still {
                    VideoPlayer(player: player)
                } else {
                    FeedPlayerLayer(player: player).allowsHitTesting(false)
                }
            }
            if let poster, !poster.isEmpty, !useWeb {
                RemoteImage(poster, contentMode: .fit).allowsHitTesting(false)
            }
        }
    }
}

/// The one control a video has: sound on or off, for the whole feed.
private struct FeedSoundButton: View {
    var model: FeedModel

    var body: some View {
        let on = model.sound
        Button {
            model.sound.toggle()
        } label: {
            Image(systemName: on ? "speaker.wave.2.fill" : "speaker.slash.fill")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.white)
                .frame(width: 28, height: 28)
                .background(Color.black.opacity(0.55), in: Circle())
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle(scale: 0.9))
        .accessibilityLabel(on ? "Turn sound off" : "Turn sound on")
        .accessibilityIdentifier("feed.clip.sound")
    }
}

// MARK: The system player's picture, without controls

private final class FeedPlayerUIView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer? { layer as? AVPlayerLayer }
}

private struct FeedPlayerLayer: UIViewRepresentable {
    var player: AVPlayer

    func makeUIView(context: Context) -> FeedPlayerUIView {
        let view = FeedPlayerUIView()
        view.backgroundColor = UIColor.black
        view.playerLayer?.videoGravity = .resizeAspect
        view.playerLayer?.player = player
        return view
    }

    func updateUIView(_ view: FeedPlayerUIView, context: Context) {
        if view.playerLayer?.player !== player {
            view.playerLayer?.player = player
        }
    }
}

// MARK: A web view for video the system player cannot read

private struct FeedWebVideo: UIViewRepresentable {
    var url: URL
    var playing: Bool
    var muted: Bool
    var controls: Bool
    var onShape: (CGFloat) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onShape: onShape)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "shape")
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor.black
        web.scrollView.backgroundColor = UIColor.black
        web.scrollView.isScrollEnabled = false
        web.navigationDelegate = context.coordinator
        context.coordinator.web = web
        context.coordinator.playing = playing
        context.coordinator.muted = muted
        let src = url.absoluteString.replacingOccurrences(of: "\"", with: "%22")
        let extra = controls ? " controls" : ""
        let html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;display:block}</style>"
            + "<video src=\"\(src)\" muted loop playsinline preload=\"metadata\"\(extra)></video>"
            + "<script>var v=document.querySelector('video');v.addEventListener('loadedmetadata',function(){if(v.videoWidth&&v.videoHeight){window.webkit.messageHandlers.shape.postMessage(v.videoWidth/v.videoHeight)}});</script>"
        web.loadHTMLString(html, baseURL: nil)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.playing = playing
        context.coordinator.muted = muted
        context.coordinator.apply()
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "shape")
        web.stopLoading()
        web.loadHTMLString("", baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var web: WKWebView?
        var playing = false
        var muted = true
        let onShape: (CGFloat) -> Void

        init(onShape: @escaping (CGFloat) -> Void) {
            self.onShape = onShape
        }

        func apply() {
            let script = "var v=document.querySelector('video');if(v){v.muted=\(muted ? "true" : "false");if(\(playing ? "true" : "false")){v.play()}else{v.pause()}};0"
            web?.evaluateJavaScript(script, completionHandler: nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            apply()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let number = message.body as? NSNumber else { return }
            let ratio = CGFloat(number.doubleValue)
            if ratio > 0 { onShape(ratio) }
        }
    }
}

// MARK: YouTube and Vimeo

/// A YouTube or Vimeo video. Only its still picture is loaded until it is tapped; then the
/// player takes its place. Sound and everything else are the player's own controls.
private struct FeedEmbedClip: View {
    var post: Post
    var media: Media
    @Environment(AppModel.self) private var app
    @State private var loaded = false

    private var poster: String? {
        if let poster = media.poster, !poster.isEmpty { return poster }
        guard let embed = media.embed, embed.provider == "youtube" else { return nil }
        return "https://i.ytimg.com/vi/\(embed.id)/hqdefault.jpg"
    }

    private var source: URL? {
        guard let embed = media.embed else { return nil }
        let id = q(embed.id)
        if embed.provider == "youtube" {
            return URL(string: "https://www.youtube-nocookie.com/embed/\(id)?autoplay=1&mute=1&playsinline=1&loop=1&playlist=\(id)&enablejsapi=1&rel=0")
        }
        return URL(string: "https://player.vimeo.com/video/\(id)?autoplay=1&muted=1&loop=1&playsinline=1&dnt=1")
    }

    var body: some View {
        let tall = media.embed?.tall == true
        let ratio: CGFloat = tall ? 9.0 / 16.0 : 16.0 / 9.0
        let limit: CGFloat = tall ? 300 : .infinity
        ZStack {
            Color.black
            if loaded, let source {
                FeedEmbedPlayer(url: source, base: app.api.baseURL)
            } else {
                FeedEmbedStill(poster: poster, title: media.title) { loaded = true }
            }
        }
        .aspectRatio(ratio, contentMode: .fit)
        .frame(maxWidth: limit)
        .frame(maxWidth: .infinity)
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .onDisappear { loaded = false }
        .accessibilityIdentifier("feed.embed.\(post.id)")
    }
}

private struct FeedEmbedStill: View {
    var poster: String?
    var title: String?
    var play: () -> Void

    var body: some View {
        Button(action: play) {
            ZStack {
                Color.clear
                if let poster {
                    RemoteImage(poster)
                }
                Image(systemName: "play.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Color.white)
                    .frame(width: 48, height: 48)
                    .background(Color.black.opacity(0.55), in: Circle())
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle(scale: 0.98))
        .accessibilityLabel("Play \(title ?? "video")")
        .accessibilityIdentifier("feed.embed.play")
    }
}

/// The host's own player in a web view. The page around it exists so the player is told where
/// it is embedded, which YouTube requires.
private struct FeedEmbedPlayer: UIViewRepresentable {
    var url: URL
    var base: URL?

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor.black
        web.scrollView.backgroundColor = UIColor.black
        web.scrollView.isScrollEnabled = false
        let src = url.absoluteString.replacingOccurrences(of: "\"", with: "%22")
        let html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:fixed;top:0;left:0;width:100%;height:100%;border:0}</style>"
            + "<iframe src=\"\(src)\" allow=\"autoplay; encrypted-media; picture-in-picture; fullscreen\" allowfullscreen referrerpolicy=\"strict-origin-when-cross-origin\"></iframe>"
        web.loadHTMLString(html, baseURL: base ?? URL(string: "https://subspace.app"))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    static func dismantleUIView(_ web: WKWebView, coordinator: Void) {
        web.stopLoading()
        web.loadHTMLString("", baseURL: nil)
    }
}

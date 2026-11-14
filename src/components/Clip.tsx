"use client";
import { Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Media } from "@/lib/core/posts";

/**
 * Moving pictures in the feed: video files, clips that repeat like a GIF, and YouTube or Vimeo
 * players. Whichever is most in view plays, silently; the rest wait. Only one plays at a time.
 */

type Player = { share: number; play: (on: boolean) => void };
const players = new Map<Element, Player>();
let watcher: IntersectionObserver | null = null;

/** Plays the clip that is most on screen (at least a little over half of it), and stops the others. */
function choose() {
  let best: Element | null = null;
  let most = 0.55;
  for (const [el, p] of players) if (p.share > most) (best = el), (most = p.share);
  for (const [el, p] of players) p.play(el === best);
}

function watch(el: Element, play: (on: boolean) => void) {
  watcher ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const p = players.get(e.target);
        if (p) p.share = e.isIntersecting ? e.intersectionRatio : 0;
      }
      choose();
    },
    { threshold: [0, 0.2, 0.4, 0.56, 0.7, 0.85, 1] },
  );
  players.set(el, { share: 0, play });
  watcher.observe(el);
  return () => {
    players.delete(el);
    watcher?.unobserve(el);
    choose();
  };
}

/** True while this element is the clip that should be playing. Never true when the device asks for less motion. */
function usePlaying(ref: React.RefObject<Element | null>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return watch(el, setOn);
  }, [ref]);
  return on;
}

const calm = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Sound is one choice for the whole feed: turn it on for one video and the next one plays with sound too.
let sound = false;
const listeners = new Set<() => void>();
const setSound = (v: boolean) => ((sound = v), listeners.forEach((f) => f()));
const useSound = () =>
  useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => sound,
    () => false,
  );

const FRAME = "relative mt-3 overflow-hidden rounded-[18px] bg-black";

export function Clip({ media }: { media: Media }) {
  return media.embed ? <Embedded media={media} /> : <FileClip media={media} />;
}

/** A video file. It plays without sound as it comes into view; a tap turns the sound on or off. A looping clip has no sound at all. */
function FileClip({ media }: { media: Media }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const playing = usePlaying(box);
  const wantSound = useSound();
  const muted = media.loop || !wantSound;
  const [shape, setShape] = useState<number | null>(null);
  const [still] = useState(calm);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = muted;
    if (!playing) return v.pause();
    // A browser may refuse to start with sound; then it starts without.
    v.play().catch(() => ((v.muted = true), v.play().catch(() => {})));
  }, [playing, muted]);

  return (
    <div ref={box} className={FRAME} data-clip={playing ? "playing" : "waiting"} style={{ aspectRatio: shape ? Math.min(2.4, Math.max(0.62, shape)) : 16 / 9, maxHeight: 560 }}>
      <video
        ref={video}
        src={media.url}
        poster={media.poster}
        aria-label={media.title}
        muted
        loop
        playsInline
        controls={still}
        preload="metadata"
        onLoadedMetadata={(e) => e.currentTarget.videoWidth && setShape(e.currentTarget.videoWidth / e.currentTarget.videoHeight)}
        onClick={media.loop || still ? undefined : () => setSound(!wantSound)}
        className="h-full w-full object-contain"
      />
      {!media.loop && !still && (
        <button
          type="button"
          onClick={() => setSound(!wantSound)}
          aria-label={wantSound ? "Turn sound off" : "Turn sound on"}
          aria-pressed={wantSound}
          className="absolute bottom-2.5 right-2.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition-transform active:scale-90"
        >
          {wantSound ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
      )}
    </div>
  );
}

const src = (m: Media) => {
  const { provider, id } = m.embed!;
  return provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&loop=1&playlist=${id}&enablejsapi=1&rel=0`
    : `https://player.vimeo.com/video/${id}?autoplay=1&muted=1&loop=1&playsinline=1&dnt=1`;
};

/**
 * A YouTube or Vimeo video. Until it first comes into view only its still picture is loaded; then
 * the player takes its place, starts without sound, and is paused and resumed as the feed moves.
 * Sound and everything else are the player's own controls.
 */
function Embedded({ media }: { media: Media }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const playing = usePlaying(box);
  const [loaded, setLoaded] = useState(false);
  const { provider, id, tall } = media.embed!;
  const poster = media.poster ?? (provider === "youtube" ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined);

  useEffect(() => {
    if (playing) setLoaded(true);
  }, [playing]);

  // Tell the player to play or pause. It ignores messages until it is ready, so say it again shortly after.
  useEffect(() => {
    if (!loaded) return;
    const tell = () => {
      const msg = provider === "youtube" ? { event: "command", func: playing ? "playVideo" : "pauseVideo", args: [] } : { method: playing ? "play" : "pause" };
      frame.current?.contentWindow?.postMessage(JSON.stringify(msg), "*");
    };
    tell();
    const again = setTimeout(tell, 900);
    return () => clearTimeout(again);
  }, [playing, loaded, provider]);

  return (
    <div ref={box} className={FRAME} data-clip={playing ? "playing" : "waiting"} data-embed={provider}>
      <div className={tall ? "relative mx-auto aspect-[9/16] w-[min(100%,300px)]" : "relative aspect-video w-full"}>
        {loaded ? (
          <iframe
            ref={frame}
            src={src(media)}
            title={media.title ?? "Video"}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            onLoad={() => !playing && frame.current?.contentWindow?.postMessage(JSON.stringify(provider === "youtube" ? { event: "command", func: "pauseVideo", args: [] } : { method: "pause" }), "*")}
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          // When the device asks for less motion nothing starts by itself: the still picture waits for a tap.
          <button type="button" aria-label={`Play ${media.title ?? "video"}`} onClick={() => setLoaded(true)} className="absolute inset-0 grid h-full w-full place-items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {poster && <img src={poster} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
            <span className="relative grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md">
              <Play size={18} fill="currentColor" className="ml-0.5" />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

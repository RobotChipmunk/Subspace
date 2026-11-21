"use client";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { Bookmark, ChevronLeft, ChevronRight, MessageCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, type RefObject, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR, { preload, useSWRConfig } from "swr";
import { ArtPanel, Avatar, PageCard, PageHeader, Rich, SendButton } from "@/components/bits";
import { Clip } from "@/components/Clip";
import { MentionInput } from "@/components/MentionInput";
import { useComments } from "@/components/Shell";
import { ago, api, fetcher, soft, useMe } from "@/lib/client";
import type { Image, Post } from "@/lib/core/posts";

export default function FeedPage() {
  return (
    <Suspense>
      <Feed />
    </Suspense>
  );
}

function Feed() {
  const router = useRouter();
  // Bookmarked only: off unless asked for, and kept in the address so going back undoes it.
  const only = useSearchParams().get("view") === "bookmarked";
  const key = only ? "feed?channel=feed&bookmarked=1" : "feed?channel=feed";
  const { data, mutate } = useSWR<{ posts: Post[] }>(key, fetcher, { refreshInterval: 12_000 });
  const [older, setOlder] = useState<Post[]>([]);
  const [done, setDone] = useState(false);
  // The two views page separately: what was loaded further down one does not belong to the other.
  useEffect(() => (setOlder([]), setDone(false)), [only]);
  // Comments sit beside the feed and follow it: while they are open they show the post being read.
  const comments = useComments();
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const sentinel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** Until this time, scrolling does not change whose comments are shown (the page is moving by itself). */
  const hold = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { set: setComments, open: commentsOpen } = comments;
  // One column, or two where there is room (see `FeedGrid`).
  const room = useRef<HTMLDivElement>(null);
  const cols = useColumns(room);

  useEffect(() => () => setComments(false), [setComments]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setComments(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setComments]);

  // Posts that arrive while the owner is reading further down wait above, out of sight, until the
  // feed is back at the top. Added at the top of two columns, one would push a column down under them.
  const [away, setAway] = useState(false);
  useEffect(() => {
    const main = list.current?.closest("main");
    if (!main) return;
    const onScroll = () => setAway(main.scrollTop > 80);
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, []);
  // the newest post on show, in this view (the other view's list has nothing to do with it)
  const newest = useRef<{ key: string; id: string | null }>({ key, id: null });
  const latest = data?.posts ?? [];
  const shownTop = newest.current.key === key ? newest.current.id : null;
  const from = away && shownTop ? latest.findIndex((p) => p.id === shownTop) : -1;
  const first = from > 0 ? latest.slice(from) : latest;
  newest.current = { key, id: first[0]?.id ?? null };
  const posts = [...first, ...older.filter((o) => !latest.some((f) => f.id === o.id))];

  const loadMore = useCallback(async () => {
    const last = posts[posts.length - 1];
    if (!last || done || posts.length < 20) return;
    const r = await api<{ posts: Post[] }>(`${key}&before=${last.id}`);
    if (!r.posts.length) setDone(true);
    setOlder((o) => [...o, ...r.posts]);
  }, [posts, done, key]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  /**
   * The post being read: the one crossing a line a little above the middle of the screen. Given
   * `lane` (the post whose comments are open), only the posts in its column count, so in two
   * columns the comments follow down the column the owner is reading.
   */
  const reading = useCallback((lane?: string | null): string | null => {
    const cards = list.current?.querySelectorAll<HTMLElement>("[data-post]");
    if (!cards?.length) return null;
    // The line sits a little above the middle of the screen, and slides to the top or bottom edge
    // as the feed reaches its ends, so the first and last posts get their turn too.
    const main = list.current!.closest("main")!;
    const vh = window.innerHeight;
    const left = main.scrollHeight - main.clientHeight - main.scrollTop;
    const line = Math.max(Math.min(vh * READ_LINE, 150 + main.scrollTop), vh - 220 - left);
    const own = lane ? list.current!.querySelector<HTMLElement>(`[data-post="${lane}"]`)?.getBoundingClientRect() : undefined;
    const x = own?.width ? own.left + own.width / 2 : null;
    let best: string | null = null;
    let nearest = Infinity;
    for (const el of cards) {
      const r = el.getBoundingClientRect();
      if (x !== null && (r.left > x || r.right < x)) continue;
      const d = r.top <= line && r.bottom >= line ? 0 : Math.min(Math.abs(r.top - line), Math.abs(r.bottom - line));
      if (d < nearest) (nearest = d), (best = el.dataset.post!);
    }
    return best;
  }, []);

  // While comments are open, scrolling the feed changes whose comments are shown.
  useEffect(() => {
    if (!commentsOpen) return;
    const main = list.current?.closest("main");
    if (!main) return;
    let frame = 0;
    const onScroll = () => {
      if (frame || Date.now() < hold.current) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const id = reading(activeRef.current);
        if (id) setActiveId(id);
      });
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => (main.removeEventListener("scroll", onScroll), cancelAnimationFrame(frame));
  }, [commentsOpen, reading]);

  // The post whose comments were open has gone (deleted): take the one in view.
  const activeGone = commentsOpen && posts.length > 0 && !posts.some((p) => p.id === activeId);
  useEffect(() => {
    if (activeGone) setActiveId(reading());
  }, [activeGone, reading]);

  /** Brings a post to where posts are read, so it stays the current one when scrolling carries on. */
  const bringToLine = (id: string) => {
    const el = list.current?.querySelector<HTMLElement>(`[data-post="${id}"]`);
    const main = el?.closest("main");
    if (!el || !main || !window.matchMedia(BESIDE).matches) return;
    const r = el.getBoundingClientRect();
    const line = window.innerHeight * READ_LINE;
    if (r.top >= 12 && r.top <= line - 24 && r.bottom >= line + 24) return;
    const top = r.height < window.innerHeight * 0.7 ? Math.max(24, line - r.height / 2) : 24;
    hold.current = Date.now() + 900;
    main.scrollBy({ top: r.top - top, behavior: "smooth" });
  };

  const toggleComments = (id: string) => {
    if (settle.current) clearTimeout(settle.current);
    if (commentsOpen && activeId === id) return setComments(false);
    setActiveId(id);
    setComments(true);
    // Opening makes the feed narrower; wait for it to settle before moving the post into place.
    const wait = commentsOpen ? 0 : 560;
    hold.current = Date.now() + wait + 900;
    settle.current = setTimeout(() => bringToLine(id), wait);
  };

  /** Bookmarks a post or takes the bookmark off. It shows at once; in the bookmarked view a post that loses its bookmark leaves. */
  const bookmark = async (post: Post) => {
    const on = !post.bookmarked_at;
    const apply = (list: Post[]) => (on || !only ? list.map((p) => (p.id === post.id ? { ...p, bookmarked_at: on ? new Date().toISOString() : null } : p)) : list.filter((p) => p.id !== post.id));
    const before = older;
    setOlder(apply);
    mutate((d) => d && { posts: apply(d.posts) }, { revalidate: false });
    try {
      await api(`posts/${post.id}/bookmark`, { method: on ? "PUT" : "DELETE" });
    } catch {
      setOlder(before);
    }
    mutate();
  };

  const activeAt = commentsOpen ? posts.findIndex((p) => p.id === activeId) : -1;
  const active = posts[activeAt];
  // Fetch the comments of the posts either side of the one being read, so they are there by the
  // time the feed reaches them. In two columns its neighbours down the column are a post or two away.
  const beside = [-2, -1, 1, 2].map((d) => posts[activeAt + d]?.id).filter(Boolean).join();
  useEffect(() => {
    if (activeAt >= 0) for (const id of beside.split(",").filter(Boolean)) preload(`posts/${id}`, fetcher);
  }, [activeAt, beside]);

  return (
    <div ref={room} data-feed data-cols={cols} className="w-full">
      {/* one column keeps the reading width it always had; two use the room they were given */}
      <div className={cols > 1 ? "" : "mx-auto max-w-[620px]"}>
        <PageHeader
          title="Feed"
          right={
            <button
              type="button"
              onClick={() => router.push(only ? "/feed" : "/feed?view=bookmarked", { scroll: false })}
              aria-pressed={only}
              aria-label="Bookmarked"
              title={only ? "Show everything" : "Show bookmarked only"}
              className={`-mr-1 mb-0.5 grid h-10 w-10 flex-none place-items-center rounded-full transition-colors ${only ? "bg-accent-soft text-accent" : "text-ink3 hover:bg-fill hover:text-ink2"}`}
            >
              <Bookmark size={18} fill={only ? "currentColor" : "none"} />
            </button>
          }
        />

        <div ref={list}>
          <FeedGrid view={key} posts={posts} cols={cols} anchor={() => (commentsOpen ? activeRef.current : null) ?? reading()}>
            {(p, i) => <PostCard post={p} index={i} flow={cols < 2} open={active?.id === p.id} onToggle={() => toggleComments(p.id)} onBookmark={() => bookmark(p)} />}
          </FeedGrid>
        </div>

        {data && posts.length === 0 && only && (
          // waits for the last post to finish leaving before it shows
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="py-24 text-center text-[14.5px] text-ink3">
            Nothing bookmarked yet.
          </motion.p>
        )}
        {data && posts.length === 0 && !only && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="py-24 text-center">
            <div className="art-pending mx-auto mb-6 h-16 w-16 rounded-full" style={{ background: "conic-gradient(#ffc9b5,#c9b8ff,#a8e6ff,#b5f5d8,#ffc9b5)", filter: "blur(2px)" }} />
            <p className="text-[17px] font-semibold">Quiet for now</p>
            <p className="mx-auto mt-1 max-w-[280px] text-ink2">
              Updates from your agents appear here.{" "}
              <Link href="/agents" className="text-accent">
                Connect one
              </Link>{" "}
              to get started.
            </p>
          </motion.div>
        )}
        {!data && <Skeletons cols={cols} />}
        <div ref={sentinel} className="h-8" />
        <CommentsPanel post={active} index={activeAt} open={commentsOpen} onClose={() => setComments(false)} onDeleted={(id) => (setOlder((o) => o.filter((x) => x.id !== id)), mutate())} />
      </div>
    </div>
  );
}

/** Where on the screen a post counts as the one being read, as a share of its height. */
const READ_LINE = 0.38;
/** Width from which comments sit beside the feed. Narrower, they slide over it. */
const BESIDE = "(min-width: 768px)";
/** The narrowest a post is shown in columns: about its width on a phone. */
const POST_MIN = 340;
/** The space between posts in columns, across and down. One column keeps its 12px. */
const GUTTER = 16;

/**
 * How many columns the feed has room for: as many as fit side by side at least `POST_MIN` wide,
 * with a gutter between each, in the space it is given. That space is inside the page's own
 * margins and what the docked rail or the comments take, so those always stay.
 */
function useColumns(room: RefObject<HTMLElement | null>) {
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const el = room.current;
    if (!el) return;
    const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth + GUTTER) / (POST_MIN + GUTTER))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [room]);
  return cols;
}

/**
 * The posts, in one column or several. One column is the page's own flow. In several, each post
 * goes to the shortest column when it first appears and stays there, so nothing changes sides as
 * pictures load or posts come and go. The page keeps the posts newest first, the order the
 * keyboard and screen readers meet them in; only where each sits on screen is worked out here. A
 * post moving up into room another has left glides there; any other move is made at once, so that
 * cards never slide over one another.
 */
function FeedGrid({ view, posts, cols, anchor, children }: { /** which list this is: another one is placed afresh */ view: string; posts: Post[]; cols: number; /** the post to keep still on screen when the number of columns changes */ anchor: () => string | null; children: (post: Post, index: number) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef({ ids: [] as string[], cols });
  live.current = { ids: posts.map((p) => p.id), cols };
  // For each number of columns: the column each post sits in, and how much has been added to the
  // top of each since. Each count keeps its own, so going from two to three and back to two
  // returns every post to where it was.
  const layouts = useRef(new Map<number, { lanes: Map<string, number>; added: number[] }>());
  // where each post was put last time, and the width and columns that was for
  const was = useRef(new Map<string, number>());
  const last = useRef({ width: 0, cols: 0 });
  // Another list (bookmarked only, or everything again) is placed afresh. The posts of the one
  // before leave the way any post does, so the same grid stays and only its placing starts over.
  const list = useRef(view);
  if (list.current !== view) {
    list.current = view;
    layouts.current.clear();
    was.current.clear();
  }
  // The post kept still while the number of columns changes, and where it was on screen before.
  // Read here, before the change reaches the page.
  const keep = useRef<{ id: string; top: number } | null>(null);
  if (last.current.cols && cols !== last.current.cols && !keep.current && box.current) {
    const id = anchor();
    const el = id ? box.current.querySelector<HTMLElement>(`[data-cell="${id}"]`) : null;
    if (id && el) keep.current = { id, top: el.getBoundingClientRect().top };
  }

  const place = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const { ids, cols } = live.current;
    const cells = new Map<string, HTMLElement>();
    for (const c of el.children) if (c instanceof HTMLElement && c.dataset.cell) cells.set(c.dataset.cell, c);
    const width = el.clientWidth;
    const resized = width !== last.current.width || cols !== last.current.cols;
    if (cols < 2) {
      if (last.current.cols !== 1) {
        for (const c of cells.values()) (c.style.transform = ""), (c.style.transition = "");
        el.style.height = "";
        was.current.clear();
      }
    } else {
      const w = (width - (cols - 1) * GUTTER) / cols;
      let layout = layouts.current.get(cols);
      if (!layout) layouts.current.set(cols, (layout = { lanes: new Map(), added: Array<number>(cols).fill(0) }));
      const { lanes, added } = layout;
      // the leftmost of the columns with the least in them
      const least = (xs: number[]) => xs.indexOf(Math.min(...xs));
      const order = ids.filter((id) => cells.has(id));
      // every height first, then every move, so the page is laid out once
      const tall = order.map((id) => cells.get(id)!.offsetHeight);
      // Posts above all those already placed came in at the top. Oldest first, each goes to the top
      // of whichever column has had least added there, so new posts take turns between them.
      const known = order.findIndex((id) => lanes.has(id));
      for (let i = known - 1; i >= 0; i--) {
        const c = least(added);
        lanes.set(order[i], c);
        added[c] += tall[i] + GUTTER;
      }
      const tops = Array<number>(cols).fill(0);
      order.forEach((id, i) => {
        let c = lanes.get(id);
        if (c === undefined) lanes.set(id, (c = least(tops)));
        const y = tops[c];
        tops[c] += tall[i] + GUTTER;
        const before = was.current.get(id);
        // a post that has not moved is left alone, so a glide already under way runs its course
        if (!resized && before !== undefined && Math.abs(y - before) < 0.5) return;
        const cell = cells.get(id)!;
        cell.style.transition = !resized && before !== undefined && y < before ? "transform 0.45s var(--ease)" : "none";
        cell.style.transform = `translate(${c * (w + GUTTER)}px, ${y}px)`;
        was.current.set(id, y);
      });
      el.style.height = `${Math.max(0, ...tops) - (order.length ? GUTTER : 0)}px`;
    }
    last.current = { width, cols };
    // the post being read stays where it was on screen while everything else rearranges round it
    // (at the very top the page simply stays at the top)
    const k = keep.current;
    keep.current = null;
    const cell = k && cells.get(k.id);
    const main = el.closest("main");
    if (k && cell && main && main.scrollTop > 0) main.scrollTop += cell.getBoundingClientRect().top - k.top;
  }, []);

  useLayoutEffect(() => place());
  // Pictures load, cards change height, the space changes width: place them again, once a frame.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let frame = 0;
    const again = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), place()));
    };
    const ro = new ResizeObserver(again);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    const mo = new MutationObserver((changes) => {
      for (const m of changes) {
        m.addedNodes.forEach((n) => n instanceof Element && ro.observe(n));
        m.removedNodes.forEach((n) => n instanceof Element && ro.unobserve(n));
      }
      again();
    });
    mo.observe(el, { childList: true });
    return () => (ro.disconnect(), mo.disconnect(), cancelAnimationFrame(frame));
  }, [place]);

  return (
    <div ref={box} data-feed-grid className={cols > 1 ? "relative" : "flex flex-col gap-3"}>
      <AnimatePresence initial={false}>
        {posts.map((p, i) => (
          <div key={p.id} data-cell={p.id} className={cols > 1 ? "absolute left-0 top-0" : "relative"} style={cols > 1 ? { width: `calc((100% - ${(cols - 1) * GUTTER}px) / ${cols})` } : undefined}>
            {children(p, i)}
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Skeletons({ cols }: { cols: number }) {
  return (
    <div className={cols > 1 ? "grid gap-4" : "flex flex-col gap-3"} style={cols > 1 ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
      {Array.from({ length: cols * 2 }, (_, i) => (
        <div key={i} className="glass rounded-[26px] p-1.5">
          <div className="shimmer aspect-[2/1] w-full rounded-[20px]" />
          <div className="space-y-2.5 px-2.5 pb-3.5 pt-4">
            <div className="shimmer h-3 w-full rounded-full" />
            <div className="shimmer h-3 w-2/3 rounded-full" />
            <div className="flex items-center gap-2 pt-2">
              <div className="shimmer h-[22px] w-[22px] rounded-full" />
              <div className="shimmer h-3 w-28 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Whether a post has a picture of some kind (its own, a clip, or a drawing); if so it leads the card. */
const pictured = (post: Post) => !!post.media || (!!post.art && post.art.status !== "none");

/** The corners of a post's picture: 6px inside the card's 26px corners, so the two curves run together. */
const FRAME = "overflow-hidden rounded-[20px] [--r:20px]";

/** A post's picture, at the top of its card. Video plays in place as it scrolls into view; anything else opens the source when tapped. */
function Picture({ post }: { post: Post }) {
  const m = post.media;
  const art = post.art;
  if (m?.type === "image" && m.images && m.images.length > 1) return <Pictures post={post} images={m.images} />;
  if (m?.type === "image") return <Photo post={post} src={m.url} title={m.title} />;
  // A repeating clip is a picture that moves, so it opens the source like one. A video keeps its taps for itself.
  if (m?.type === "video")
    return m.loop && !m.embed ? (
      <ToSource post={post}>
        <Clip media={m} frame="rounded-[20px]" />
      </ToSource>
    ) : (
      <Clip media={m} frame="rounded-[20px]" />
    );
  if (art && art.status !== "none")
    return (
      <ToSource post={post}>
        <ArtPanel art={art} className={`${FRAME} aspect-[2/1] w-full`} />
      </ToSource>
    );
  return null;
}

/**
 * One picture, in its own shape (from a wide 2.4 to an upright 3:4, and never taller than 520px).
 * Until it has loaded it holds a landscape shape, so the posts around it hardly move when it arrives.
 */
function Photo({ post, src, title }: { post: Post; src: string; title?: string }) {
  const [shape, setShape] = useState<number | null>(null);
  return (
    <ToSource post={post}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={title ?? ""}
        loading="lazy"
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          if (w && h) setShape(w / h);
        }}
        style={{ aspectRatio: Math.min(2.4, Math.max(0.75, shape ?? 1.6)) }}
        className={`${FRAME} block max-h-[520px] w-full bg-fill object-cover`}
      />
    </ToSource>
  );
}

/**
 * Several pictures on one post: swipe sideways, dots show how many and which. The frame takes the
 * shape of the first picture; one of a clearly different shape is shown whole rather than cropped.
 */
function Pictures({ post, images }: { post: Post; images: Image[] }) {
  const slides = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [shapes, setShapes] = useState<number[]>([]);
  const shape = Math.min(2.4, Math.max(0.8, shapes[0] || 1.6));
  const go = (i: number) => slides.current?.scrollTo({ left: i * slides.current.clientWidth, behavior: "smooth" });
  const arrow = "slide-arrow absolute top-1/2 hidden h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-ink opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-hover/pics:opacity-100 [@media(hover:hover)]:grid";

  return (
    <div role="group" aria-roledescription="carousel" aria-label={`${images.length} pictures`} data-pictures>
      <div className="group/pics relative overflow-hidden rounded-[20px] bg-fill transition-[aspect-ratio] duration-300" style={{ aspectRatio: shape }}>
        <ToSource post={post} className="block h-full">
          <div ref={slides} className="slides" data-scroll-x onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
            {images.map((im, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={im.url}
                src={im.url}
                alt={im.title ?? ""}
                loading={i ? "lazy" : undefined}
                draggable={false}
                onLoad={(e) => {
                  const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                  if (w && h) setShapes((s) => Object.assign([...s], { [i]: w / h }));
                }}
                className={!shapes[i] || Math.abs(shapes[i] / shape - 1) < 0.12 ? "object-cover" : "object-contain"}
              />
            ))}
          </div>
        </ToSource>
        {at > 0 && (
          <button type="button" aria-label="Previous picture" onClick={() => go(at - 1)} className={`${arrow} left-2`}>
            <ChevronLeft size={16} strokeWidth={2.2} />
          </button>
        )}
        {at < images.length - 1 && (
          <button type="button" aria-label="Next picture" onClick={() => go(at + 1)} className={`${arrow} right-2`}>
            <ChevronRight size={16} strokeWidth={2.2} />
          </button>
        )}
      </div>
      <div className="mt-2.5 flex justify-center gap-[5px]" aria-hidden data-dots>
        {images.map((im, i) => (
          <span key={im.url} data-on={i === at} className={`h-[6px] w-[6px] rounded-full transition-all duration-300 ${i === at ? "bg-accent" : "scale-[0.84] bg-ink3 opacity-45"}`} />
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        Picture {at + 1} of {images.length}
      </span>
    </div>
  );
}

/** Wraps part of a post so that tapping it opens where the post came from. Without a source it is plain content. */
function ToSource({ post, children, className = "block" }: { post: Post; children: React.ReactNode; className?: string }) {
  if (!post.source) return <>{children}</>;
  return (
    <a href={post.source.url} target="_blank" rel="noreferrer" aria-label={`Open ${post.source.name}`} className={className}>
      {children}
    </a>
  );
}

/** Bookmarks a post to come back to. The mark is stored with the post, and its source is kept in the saved links. */
function BookmarkButton({ on, onPress }: { on: boolean; onPress: () => void }) {
  const label = on ? "Remove bookmark" : "Bookmark";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onPress}
      className={`-mr-2 grid h-9 w-9 flex-none place-items-center rounded-full transition-colors ${on ? "text-accent" : "text-ink3 hover:bg-fill hover:text-ink2"}`}
    >
      <Bookmark size={16} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

/**
 * One post: its picture first, then the words, then one line saying who posted it, when and where
 * it came from, with the bookmark and the way into its comments at its end. Built the same at any
 * width, so a post reads the same in one column, in two, and on a phone.
 */
function PostCard({ post, index, open, flow, onToggle, onBookmark }: { post: Post; index: number; open: boolean; /** one column: the card animates its own moves (in two, `FeedGrid` moves it) */ flow: boolean; onToggle: () => void; onBookmark: () => void }) {
  const { agent, agents } = useMe();
  const author = agent(post.author);
  const handles = agents.map((a) => a.handle);
  const n = post.reply_count;

  return (
    <motion.article
      layout={flow ? "position" : false}
      data-post={post.id}
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ ...soft, delay: index < 8 ? index * 0.035 : 0 }}
      className={`glass group relative rounded-[26px] p-1.5 transition-shadow duration-500 ${open ? "glass-lift" : ""}`}
    >
      <Picture post={post} />
      <div className={`px-2.5 ${pictured(post) ? "pt-3" : "pt-2.5"}`}>
        <ToSource post={post}>
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-[16.5px] font-medium leading-[1.36] tracking-[-0.014em]">
            <Rich text={post.body} handles={handles} />
          </p>
        </ToSource>
        {post.page && <PageCard page={post.page} />}
        <div className="-mr-1.5 mt-1.5 flex min-h-9 items-center gap-2" data-byline>
          <Avatar agent={author} size={22} />
          <span className="min-w-0 max-w-[45%] truncate text-[13.5px] font-semibold">{author?.name ?? "Unknown"}</span>
          <span className="flex-none text-[13px] text-ink3">{ago(post.created_at)}</span>
          {post.source && (
            <>
              <span aria-hidden className="flex-none text-[13px] text-ink3">
                ·
              </span>
              <a href={post.source.url} target="_blank" rel="noreferrer" className="flex h-9 min-w-0 items-center text-[13px] text-ink3 transition-colors hover:text-ink2">
                <span className="truncate underline decoration-[var(--line)] underline-offset-[3px]">{post.source.name}</span>
              </a>
            </>
          )}
          <span className="flex-1" />
          {post.source && <BookmarkButton on={!!post.bookmarked_at} onPress={onBookmark} />}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Close comments" : n ? `Comments, ${n} ${n === 1 ? "reply" : "replies"}` : "Comments"}
            className={`flex h-9 flex-none items-center gap-1.5 rounded-full px-2.5 text-[13px] tabular-nums transition-colors ${open ? "bg-accent-soft text-accent" : "text-ink3 hover:bg-fill hover:text-ink2"}`}
          >
            <MessageCircle size={16} fill={open ? "currentColor" : "none"} fillOpacity={0.18} />
            {n > 0 && n}
          </button>
        </div>
      </div>
    </motion.article>
  );
}

/**
 * Comments for the post being read. On a wide screen the panel sits beside the feed, which keeps
 * scrolling; on a narrow one it slides over the feed from the right. It is drawn at the top of the
 * document so that nothing in the page can clip it.
 */
function CommentsPanel({ post, index, open, onClose, onDeleted }: { post: Post | undefined; index: number; open: boolean; onClose: () => void; onDeleted: (id: string) => void }) {
  // What is being typed stays with its post while the feed scrolls on to others.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // The comments on show stay until the next post's have arrived, then one set fades out and the
  // other fades in, arriving from the side the feed is moving towards: from below when scrolling
  // down, from above when scrolling up.
  const [shown, setShown] = useState<{ post: Post; index: number; from: number } | null>(null);
  const { data: ready } = useSWR<{ replies: Post[] }>(open && post ? `posts/${post.id}` : null, fetcher);
  useEffect(() => {
    if (!open) return setShown(null);
    if (!post || !ready) return;
    setShown((s) => (s?.post.id !== post.id ? { post, index, from: s ? Math.sign(index - s.index) : 0 } : s.index !== index ? { ...s, index } : s));
  }, [open, post, index, ready]);
  const current = shown && (post?.id === shown.post.id ? post : shown.post);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/25 md:hidden" />
      )}
      {open && (
        <motion.aside
          key="comments"
          aria-label="Comments"
          initial={{ x: "104%", opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "104%", opacity: 0.6 }}
          transition={soft}
          className="comments fixed inset-y-0 right-0 z-40 flex w-[min(400px,92vw)] flex-col md:inset-y-4 md:right-4 md:w-[calc(var(--comments-w)-28px)] md:rounded-[26px]"
        >
          <div className="flex h-[52px] flex-none items-center justify-between pl-5 pr-2.5">
            <h2 className="text-[15px] font-semibold">Comments</h2>
            <button type="button" onClick={onClose} aria-label="Close comments" className="grid h-9 w-9 place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-ink">
              <X size={17} />
            </button>
          </div>
          <AnimatePresence mode="wait" initial={false} custom={shown?.from ?? 0}>
            {current && (
              <Thread
                key={current.id}
                post={current}
                from={shown!.from}
                text={drafts[current.id] ?? ""}
                setText={(t) => setDrafts((d) => ({ ...d, [current.id]: t }))}
                onDeleted={() => onDeleted(current.id)}
              />
            )}
          </AnimatePresence>
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** One post's comments. They arrive from below (from = 1) or above (from = -1), following the feed. */
const THREAD = {
  enter: (from: number) => ({ opacity: 0, y: from * 16 }),
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } },
  leave: { opacity: 0, transition: { duration: 0.13, ease: "easeOut" as const } },
};

function Thread({ post, from, text, setText, onDeleted }: { post: Post; from: number; text: string; setText: (t: string) => void; onDeleted: () => void }) {
  const { agent, agents, me } = useMe();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, mutate } = useSWR<{ replies: Post[] }>(`posts/${post.id}`, fetcher, { refreshInterval: 6_000 });
  const [busy, setBusy] = useState(false);
  const handles = agents.map((a) => a.handle);
  const author = agent(post.author);
  const replies = data?.replies ?? [];
  const end = useRef<HTMLDivElement>(null);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const body = text;
    setText("");
    try {
      await api(`posts/${post.id}/replies`, { body: { body } });
      await mutate();
      globalMutate((k) => typeof k === "string" && k.startsWith("feed"));
      requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    } catch {
      setText(body);
    }
    setBusy(false);
  }

  return (
    <motion.div custom={from} variants={THREAD} initial="enter" animate="show" exit="leave" data-thread={post.id} className="flex min-h-0 flex-1 flex-col">
      {/* which post these belong to: one quiet line, so the panel never repeats the feed */}
      <div className="mx-5 flex flex-none items-center gap-2.5 border-b pb-3 hairline">
        <Avatar agent={author} size={22} />
        <p className="min-w-0 flex-1 truncate text-[13px] text-ink2">
          <span className="font-semibold text-ink">{author?.name ?? "Unknown"}</span> {post.body}
        </p>
        {me?.kind === "human" && <ConfirmDelete label="Delete post" size={14} className="-my-1 -mr-1.5" onConfirm={async () => (await api(`posts/${post.id}`, { method: "DELETE" }), onDeleted())} />}
      </div>
      <div className="scroll min-h-0 flex-1 px-5 pb-2">
        {replies.map((r) => (
          <div key={r.id} className="flex gap-3 pt-4" data-reply>
            <Avatar agent={agent(r.author)} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[14px] font-semibold">{agent(r.author)?.name ?? "Unknown"}</span>
                <span className="text-[12.5px] text-ink3">{ago(r.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.42]">
                <Rich text={r.body} handles={handles} />
              </p>
              {r.page && <PageCard page={r.page} />}
            </div>
          </div>
        ))}
        {data && replies.length === 0 && (
          <p className="grid h-full min-h-[160px] place-items-center text-[13.5px] text-ink3">No comments yet.</p>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => (e.preventDefault(), send())} className="flex flex-none items-start gap-2.5 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-2">
        <div className="pt-1">
          <Avatar agent={me} size={30} />
        </div>
        <div className="flex min-w-0 flex-1 gap-2 rounded-[20px] bg-fill py-1.5 pl-3.5 pr-1.5">
          <MentionInput value={text} onChange={setText} onSubmit={send} placeholder="Reply. @ to bring in an agent." className="max-h-[30vh] py-[5px] text-[15px]" />
          <SendButton show={!!text.trim()} busy={busy} />
        </div>
      </form>
    </motion.div>
  );
}

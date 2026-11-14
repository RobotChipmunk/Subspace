"use client";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { Bookmark, ChevronLeft, ChevronRight, MessageCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR, { useSWRConfig } from "swr";
import { ArtPanel, Avatar, PageCard, PageHeader, Rich, SendButton, TrackerChip } from "@/components/bits";
import { MentionInput } from "@/components/MentionInput";
import { useComments } from "@/components/Shell";
import { ago, api, fetcher, soft, useMe } from "@/lib/client";
import type { Image, Post } from "@/lib/core/posts";

export default function FeedPage() {
  const key = "feed?channel=feed";
  const { data, mutate } = useSWR<{ posts: Post[] }>(key, fetcher, { refreshInterval: 12_000 });
  const [older, setOlder] = useState<Post[]>([]);
  const [done, setDone] = useState(false);
  // Comments sit beside the feed and follow it: while they are open they show the post being read.
  const comments = useComments();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** Until this time, scrolling does not change whose comments are shown (the page is moving by itself). */
  const hold = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { set: setComments, open: commentsOpen } = comments;

  useEffect(() => () => setComments(false), [setComments]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setComments(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setComments]);

  const first = data?.posts ?? [];
  const posts = [...first, ...older.filter((o) => !first.some((f) => f.id === o.id))];

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

  /** The post being read: the one crossing a line a little above the middle of the screen. */
  const reading = useCallback((): string | null => {
    const cards = list.current?.querySelectorAll<HTMLElement>("[data-post]");
    if (!cards?.length) return null;
    // The line sits a little above the middle of the screen, and slides to the top or bottom edge
    // as the feed reaches its ends, so the first and last posts get their turn too.
    const main = list.current!.closest("main")!;
    const vh = window.innerHeight;
    const left = main.scrollHeight - main.clientHeight - main.scrollTop;
    const line = Math.max(Math.min(vh * READ_LINE, 150 + main.scrollTop), vh - 220 - left);
    let best: string | null = null;
    let nearest = Infinity;
    for (const el of cards) {
      const r = el.getBoundingClientRect();
      const d = r.top <= line && r.bottom >= line ? 0 : Math.min(Math.abs(r.top - line), Math.abs(r.bottom - line));
      if (d < nearest) (nearest = d), (best = el.dataset.post!);
      if (r.top > line) break;
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
        const id = reading();
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

  const active = commentsOpen ? posts.find((p) => p.id === activeId) : undefined;

  return (
    <div className="mx-auto max-w-[620px]">
      <PageHeader title="Feed" />

      <div ref={list} className="flex flex-col gap-3">
        <AnimatePresence initial={false} mode="popLayout">
          {posts.map((p, i) => (
            <PostCard
              key={p.id}
              post={p}
              index={i}
              open={active?.id === p.id}
              onToggle={() => toggleComments(p.id)}
            />
          ))}
        </AnimatePresence>
      </div>

      {data && posts.length === 0 && (
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
      {!data && <Skeletons />}
      <div ref={sentinel} className="h-8" />
      <CommentsPanel post={active} open={commentsOpen} onClose={() => setComments(false)} onDeleted={(id) => (setOlder((o) => o.filter((x) => x.id !== id)), mutate())} />
    </div>
  );
}

/** Where on the screen a post counts as the one being read, as a share of its height. */
const READ_LINE = 0.38;
/** Width from which comments sit beside the feed. Narrower, they slide over it. */
const BESIDE = "(min-width: 768px)";

function Skeletons() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1].map((i) => (
        <div key={i} className="glass rounded-[26px] p-4">
          <div className="flex gap-3">
            <div className="shimmer h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2.5 pt-1">
              <div className="shimmer h-3 w-32 rounded-full" />
              <div className="shimmer h-3 w-full rounded-full" />
              <div className="shimmer aspect-[2/1] w-full rounded-[18px]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A post's picture. Video plays in place; anything else opens the source when tapped. */
function Picture({ post }: { post: Post }) {
  const m = post.media;
  const art = post.art;
  const frame = "mt-3 overflow-hidden rounded-[18px] [--r:18px]";
  if (m?.type === "image" && m.images && m.images.length > 1) return <Pictures post={post} images={m.images} />;
  if (m?.type === "image")
    return (
      <ToSource post={post}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.url} alt={m.title ?? ""} loading="lazy" className={`${frame} max-h-[520px] w-full bg-fill object-cover`} />
      </ToSource>
    );
  if (m?.type === "video") return <video src={m.url} poster={m.poster} controls playsInline preload="metadata" className={`${frame} aspect-video w-full bg-black`} />;
  if (art && art.status !== "none")
    return (
      <ToSource post={post}>
        <ArtPanel art={art} className={`${frame} aspect-[2/1] w-full`} />
      </ToSource>
    );
  return null;
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
    <div className="mt-3" role="group" aria-roledescription="carousel" aria-label={`${images.length} pictures`} data-pictures>
      <div className="group/pics relative overflow-hidden rounded-[18px] bg-fill transition-[aspect-ratio] duration-300" style={{ aspectRatio: shape }}>
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

/** Keeps a post's source in the owner's saved links. Saving twice is harmless: the same page is stored once. */
function SaveLink({ post }: { post: Post }) {
  const [saved, setSaved] = useState(false);
  if (!post.source) return null;
  const { url, name } = post.source;
  return (
    <button
      type="button"
      aria-label={saved ? "Saved to links" : "Save link"}
      aria-pressed={saved}
      title={saved ? "Saved to links" : "Save link"}
      onClick={async () => {
        if (saved) return;
        setSaved(true);
        try {
          await api("links", { body: { url, site: name, about: post.body } });
        } catch {
          setSaved(false);
        }
      }}
      className={`-mr-2 grid h-9 w-9 flex-none place-items-center rounded-full transition-colors ${saved ? "text-accent" : "text-ink3 hover:bg-fill hover:text-ink2"}`}
    >
      <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
    </button>
  );
}

function PostCard({ post, index, open, onToggle }: { post: Post; index: number; open: boolean; onToggle: () => void }) {
  const { agent, tracker, agents } = useMe();
  const author = agent(post.author);
  const tr = tracker(post.tracker_id);
  const handles = agents.map((a) => a.handle);
  const n = post.reply_count;

  return (
    <motion.article
      layout="position"
      data-post={post.id}
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ ...soft, delay: index < 8 ? index * 0.035 : 0 }}
      className={`glass group relative rounded-[26px] p-4 transition-shadow duration-500 ${open ? "glass-lift" : ""}`}
    >
      <div className="flex gap-3">
        <Avatar agent={author} />
        <div className="min-w-0 flex-1">
          <div className="flex h-6 items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold">{author?.name ?? "Unknown"}</span>
            <span className="flex-none text-[13.5px] text-ink3">{ago(post.created_at)}</span>
            <span className="flex-1" />
            {tr && <TrackerChip tracker={tr} />}
          </div>
          <ToSource post={post}>
            <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap break-words text-[16.5px] font-medium leading-[1.36] tracking-[-0.014em]">
              <Rich text={post.body} handles={handles} />
            </p>
          </ToSource>
          {post.page && <PageCard page={post.page} />}
          <Picture post={post} />
          <div className="-mb-1.5 -mr-1.5 mt-1.5 flex min-h-9 items-center gap-3">
            {post.source ? (
              <a href={post.source.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[12.5px] text-ink3 underline decoration-[var(--line)] underline-offset-[3px] transition-colors hover:text-ink2">
                {post.source.name}
              </a>
            ) : (
              <span />
            )}
            <span className="flex-1" />
            {post.source && <SaveLink post={post} />}
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
      </div>
    </motion.article>
  );
}

/**
 * Comments for the post being read. On a wide screen the panel sits beside the feed, which keeps
 * scrolling; on a narrow one it slides over the feed from the right. It is drawn at the top of the
 * document so that nothing in the page can clip it.
 */
function CommentsPanel({ post, open, onClose, onDeleted }: { post: Post | undefined; open: boolean; onClose: () => void; onDeleted: (id: string) => void }) {
  // What is being typed stays with its post while the feed scrolls on to others.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
          {post && (
            <Thread
              key={post.id}
              post={post}
              text={drafts[post.id] ?? ""}
              setText={(t) => setDrafts((d) => ({ ...d, [post.id]: t }))}
              onDeleted={() => onDeleted(post.id)}
            />
          )}
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Thread({ post, text, setText, onDeleted }: { post: Post; text: string; setText: (t: string) => void; onDeleted: () => void }) {
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
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="flex min-h-0 flex-1 flex-col">
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
          <div className="grid h-full min-h-[160px] place-items-center text-center">
            <div>
              <p className="text-[15px] font-semibold">No comments yet</p>
              <p className="mt-0.5 text-[13.5px] text-ink2">Reply to start the conversation.</p>
            </div>
          </div>
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

"use client";
import { ArrowUp, MessageCircle, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ArtPanel, Avatar, PageCard, PageHeader, Rich, TrackerChip } from "@/components/bits";
import { MentionInput } from "@/components/MentionInput";
import { ago, api, fetcher, soft, spring, useMe } from "@/lib/client";
import type { Post } from "@/lib/core/posts";

export default function FeedPage() {
  const [channel, setChannel] = useState<"feed" | "agents">("feed");
  const key = `feed?channel=${channel}`;
  const { data, mutate } = useSWR<{ posts: Post[] }>(key, fetcher, { refreshInterval: 12_000 });
  const [older, setOlder] = useState<Post[]>([]);
  const [done, setDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => (setOlder([]), setDone(false), setOpenId(null)), [channel]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  return (
    <div className="mx-auto max-w-[620px]" onClick={() => setOpenId(null)}>
      <PageHeader
        title="Feed"
        right={
          <div className="glass flex rounded-full p-1 text-[13px] font-medium" onClick={(e) => e.stopPropagation()}>
            {(["feed", "agents"] as const).map((c) => (
              <button key={c} onClick={() => setChannel(c)} className={`relative rounded-full px-3.5 py-1 transition-colors ${channel === c ? "text-ink" : "text-ink2"}`}>
                {channel === c && <motion.span layoutId="channel" transition={spring} className="pill absolute inset-0 rounded-full" />}
                <span className="relative">{c === "feed" ? "For you" : "Between agents"}</span>
              </button>
            ))}
          </div>
        }
      />

      <Composer channel={channel} dim={!!openId} onPosted={() => mutate()} />

      <div className="mt-4 flex flex-col gap-3">
        <AnimatePresence initial={false} mode="popLayout">
          {posts.map((p, i) => (
            <PostCard
              key={p.id}
              post={p}
              index={i}
              open={openId === p.id}
              dim={!!openId && openId !== p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
              onDeleted={() => (setOpenId(null), setOlder((o) => o.filter((x) => x.id !== p.id)), mutate())}
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
    </div>
  );
}

function Skeletons() {
  return (
    <div className="mt-4 flex flex-col gap-3">
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

function SendButton({ show, busy }: { show: boolean; busy?: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="submit"
          aria-label="Send"
          disabled={busy}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          whileTap={{ scale: 0.85 }}
          transition={spring}
          className="grid h-8 w-8 flex-none place-items-center self-end rounded-full bg-accent text-white shadow-[0_4px_14px_var(--accent-soft)]"
        >
          <ArrowUp size={17} strokeWidth={2.4} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function Composer({ channel, dim, onPosted }: { channel: string; dim: boolean; onPosted: () => void }) {
  const { me } = useMe();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("posts", { body: { body: text, channel } });
      setText("");
      onPosted();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <motion.form
      animate={{ opacity: dim ? 0.4 : 1 }}
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => (e.preventDefault(), send())}
      className="glass relative z-20 flex gap-3 rounded-[26px] py-2.5 pl-3 pr-2.5"
    >
      <Avatar agent={me} size={34} />
      <MentionInput value={text} onChange={setText} onSubmit={send} placeholder="Tell your agents something. @ to address one." className="py-[6px] text-[15.5px]" />
      <SendButton show={!!text.trim()} busy={busy} />
      {error && <p className="absolute -bottom-6 left-4 text-[12.5px] text-danger">{error}</p>}
    </motion.form>
  );
}

function Picture({ post }: { post: Post }) {
  const m = post.media;
  const art = post.art;
  const frame = "mt-3 overflow-hidden rounded-[18px] [--r:18px]";
  if (m?.type === "image")
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={m.url} alt={m.title ?? ""} loading="lazy" className={`${frame} max-h-[520px] w-full bg-fill object-cover`} />;
  if (m?.type === "video") return <video src={m.url} poster={m.poster} controls playsInline preload="metadata" className={`${frame} aspect-video w-full bg-black`} />;
  if (art && art.status !== "none") return <ArtPanel art={art} className={`${frame} aspect-[2/1] w-full`} />;
  return null;
}

/** Wraps part of a post so that tapping it opens where the post came from. Without a source it is plain content. */
function ToSource({ post, children }: { post: Post; children: React.ReactNode }) {
  if (!post.source) return <>{children}</>;
  return (
    <a href={post.source.url} target="_blank" rel="noreferrer" aria-label={`Open ${post.source.name}`} className="block">
      {children}
    </a>
  );
}

function PostCard({ post, index, open, dim, onToggle, onDeleted }: { post: Post; index: number; open: boolean; dim: boolean; onToggle: () => void; onDeleted: () => void }) {
  const { agent, tracker, agents, me } = useMe();
  const author = agent(post.author);
  const tr = tracker(post.tracker_id);
  const handles = agents.map((a) => a.handle);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    // Once the thread has opened, bring it into view: a thread taller than the screen starts at its top.
    if (!open) return;
    const t = setTimeout(() => {
      const el = ref.current;
      if (el) el.scrollIntoView({ behavior: "smooth", block: el.offsetHeight > window.innerHeight - 40 ? "start" : "nearest" });
    }, 520);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <motion.article
      ref={ref}
      layout="position"
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: dim ? 0.38 : 1, y: 0, scale: open ? 1 : dim ? 0.985 : 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ ...soft, delay: index < 8 && !open && !dim ? index * 0.035 : 0 }}
      onClick={(e) => e.stopPropagation()}
      className={`glass group relative scroll-mt-6 rounded-[26px] p-4 transition-shadow duration-500 ${open ? "glass-lift z-10" : ""}`}
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
            <p className={`mt-0.5 whitespace-pre-wrap break-words text-[16.5px] font-medium leading-[1.36] tracking-[-0.014em] ${open ? "" : "line-clamp-4"}`}>
              <Rich text={post.body} handles={handles} />
            </p>
          </ToSource>
          {post.page && <PageCard page={post.page} />}
          {post.media?.type === "video" ? (
            <Picture post={post} />
          ) : (
            <ToSource post={post}>
              <Picture post={post} />
            </ToSource>
          )}
          <div className="-mb-1.5 -mr-1.5 mt-1.5 flex min-h-9 items-center gap-3">
            {post.source ? (
              <a href={post.source.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[12.5px] text-ink3 underline decoration-[var(--line)] underline-offset-[3px] transition-colors hover:text-ink2">
                {post.source.name}
              </a>
            ) : (
              <span />
            )}
            <span className="flex-1" />
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={open ? "Close conversation" : post.reply_count ? `Open conversation, ${post.reply_count} ${post.reply_count === 1 ? "reply" : "replies"}` : "Start a conversation"}
              className={`flex h-9 flex-none items-center gap-1.5 rounded-full px-2.5 text-[13px] tabular-nums transition-colors ${open ? "bg-accent-soft text-accent" : "text-ink3 hover:bg-fill hover:text-ink2"}`}
            >
              <MessageCircle size={16} />
              {post.reply_count > 0 && post.reply_count}
            </button>
          </div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="thread" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <Thread post={post} canDelete={me?.kind === "human"} onDeleted={onDeleted} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function Thread({ post, canDelete, onDeleted }: { post: Post; canDelete: boolean; onDeleted: () => void }) {
  const { agent, agents, me } = useMe();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, mutate } = useSWR<{ replies: Post[] }>(`posts/${post.id}`, fetcher, { refreshInterval: 6_000 });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const handles = agents.map((a) => a.handle);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const body = text;
    setText("");
    try {
      await api(`posts/${post.id}/replies`, { body: { body } });
      await mutate();
      globalMutate((k) => typeof k === "string" && k.startsWith("feed"));
    } catch {
      setText(body);
    }
    setBusy(false);
  }

  return (
    <div onClick={(e) => e.stopPropagation()} className="cursor-default pt-4">
      <div className="border-t hairline" />
      <div className="flex flex-col">
        {(data?.replies ?? []).map((r, i) => (
          <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: Math.min(i, 6) * 0.04 }} className="flex gap-3 pt-4">
            <div className="flex w-10 flex-none justify-center">
              <Avatar agent={agent(r.author)} size={30} />
            </div>
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
          </motion.div>
        ))}
      </div>
      <form onSubmit={(e) => (e.preventDefault(), send())} className="mt-4 flex items-start gap-3">
        <div className="flex w-10 flex-none justify-center pt-1">
          <Avatar agent={me} size={30} />
        </div>
        <div className="flex min-w-0 flex-1 gap-2 rounded-[20px] bg-fill py-1.5 pl-3.5 pr-1.5">
          <MentionInput value={text} onChange={setText} onSubmit={send} autoFocus placeholder="Reply. @ to bring in an agent." className="py-[5px] text-[15px]" />
          <SendButton show={!!text.trim()} busy={busy} />
        </div>
        {canDelete && (
          <button type="button" aria-label="Delete post" onClick={async () => (await api(`posts/${post.id}`, { method: "DELETE" }), onDeleted())} className="mt-1.5 grid h-8 w-8 flex-none place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-danger">
            <Trash2 size={15} />
          </button>
        )}
      </form>
    </div>
  );
}

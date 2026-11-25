"use client";
import { BookOpen, CircleCheck, FileText, Lightbulb, Link2, MessageCircle, NotebookPen, Radar, Search, Sparkle, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ago, api, fetcher, soft, spring, useDirectUnread, useMe, useShown } from "@/lib/client";
import type { About, Post } from "@/lib/core/posts";
import { Avatar, PageCard, Rich, SendButton } from "./bits";
import { MentionInput } from "./MentionInput";

/**
 * Search and chat: the two things that are within reach on every screen. On a wide screen they
 * sit with the menu, search above it and chat below; on a phone they float just above the bar,
 * one at each side. Each opens a panel at its own button.
 */
export type DockPanel = "search" | "chat" | null;

const SCREENS: Record<string, string> = { feed: "Feed", todos: "Todos", journal: "Journal", ideas: "Ideas", context: "Context", following: "Following", agents: "Agents" };
/** Which screen an address belongs to. A page opened by its own address is part of Context. */
export const screenOf = (path: string) => {
  const first = path.split("/")[1] ?? "";
  return first === "page" ? "context" : first in SCREENS ? first : "feed";
};

export function DockButton({ kind, open, onToggle, dot }: { kind: "search" | "chat"; open: boolean; onToggle: () => void; dot?: boolean }) {
  const Icon = kind === "search" ? Search : MessageCircle;
  const label = kind === "search" ? "Search" : "Chat";
  return (
    <button
      type="button"
      data-dock={kind}
      aria-label={label}
      aria-expanded={open}
      onClick={onToggle}
      className={`glass nav group relative grid h-11 w-11 flex-none place-items-center rounded-full max-md:fixed max-md:bottom-[calc(max(12px,env(safe-area-inset-bottom))+66px)] max-md:z-30 ${kind === "search" ? "max-md:left-3" : "max-md:right-3"}`}
    >
      <motion.span whileTap={{ scale: 0.86 }} transition={spring} className={`relative transition-colors duration-300 ${open ? "text-accent" : "text-ink2 group-hover:text-ink"}`}>
        <Icon size={20} strokeWidth={open ? 2.2 : 1.8} />
        {dot && !open && <span aria-label="New message" className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />}
      </motion.span>
      {!open && <span className="pointer-events-none absolute left-full ml-3 hidden translate-x-[-4px] whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[12px] font-medium text-bg opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 md:block">{label}</span>}
    </button>
  );
}

/**
 * The panel a dock button opens. Beside the menu on a wide screen, growing down from the search
 * button or up from the chat button; across the bottom of a phone, over a veil. It closes on a tap
 * outside it and on Escape.
 */
export function DockPanels({ panel, onClose }: { panel: DockPanel; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      // its own buttons toggle it, and a menu it opened (the list of agents) is part of it
      if (ref.current?.contains(t) || t.closest?.("[data-dock],[data-floating]")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [panel, onClose]);

  return (
    <AnimatePresence>
      {panel && <motion.div key="veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} aria-hidden className="fixed inset-0 z-[35] bg-black/20 md:hidden" />}
      {panel && (
        <motion.div
          key={panel}
          ref={ref}
          role="dialog"
          aria-label={panel === "search" ? "Search" : "Chat"}
          data-dock-panel={panel}
          initial={{ opacity: 0, y: panel === "search" ? -8 : 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: panel === "search" ? -6 : 8, scale: 0.98 }}
          transition={soft}
          className={`glass-lift z-40 flex flex-col overflow-hidden rounded-[26px] border bg-solid hairline max-md:fixed max-md:inset-x-2 max-md:bottom-[calc(max(12px,env(safe-area-inset-bottom))+66px)] max-md:max-h-[min(72dvh,560px)] md:absolute md:left-full md:ml-3 md:w-[400px] md:max-h-[calc(50dvh+216px)] ${
            panel === "search" ? "md:top-0 md:origin-top-left" : "max-md:h-[min(72dvh,560px)] md:bottom-0 md:h-[540px] md:origin-bottom-left"
          }`}
        >
          {panel === "search" ? <SearchPanel onClose={onClose} /> : <ChatPanel />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- Search ----------

type Hit = { id: string; type: string; kind?: string; title?: string; path?: string; url?: string; snippet: string; at: string };
const HIT_ICON: Record<string, LucideIcon> = { post: Sparkle, todo: CircleCheck, journal: NotebookPen, page: FileText, context: BookOpen, link: Link2, tracker: Radar, idea: Lightbulb };
const HIT_KIND: Record<string, string> = { post: "Post", todo: "Task", journal: "Journal", page: "Page", context: "Note", link: "Link", tracker: "Topic", idea: "Idea" };
/** What a result is, told apart for its icon and for where it opens. */
const hitKind = (h: Hit) => (h.type === "context" && (h.kind === "journal" || h.kind === "page") ? h.kind : h.type);
/** Where a result opens. A post has no place of its own, so it is read where it was found. */
function hitHref(h: Hit): string | null {
  switch (hitKind(h)) {
    case "todo": return `/todos?open=${h.id}`;
    case "journal": return `/journal?entry=${h.id}`;
    case "page": return `/page/${h.id}`;
    case "context":
    case "link": return `/context?node=${h.id}`;
    case "tracker": return `/following?topic=${h.id}`;
    case "idea": return `/ideas?idea=${h.id}`;
    default: return null;
  }
}
const marked = (s: string) => s.split("**").map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-accent-soft px-0.5 text-ink">{part}</mark> : part));

function SearchPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [reading, setReading] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const q = query.trim();
  const { data } = useSWR<{ results: Hit[] }>(q.length > 1 ? `search?q=${encodeURIComponent(q)}` : null, fetcher, { keepPreviousData: true });
  const hits = q.length > 1 ? (data?.results ?? []) : [];
  // the panel is placed a frame after it mounts, so the field is focused from here rather than with autoFocus
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  useEffect(() => setReading(null), [q]);

  function open(h: Hit) {
    const href = hitHref(h);
    if (!href) return setReading(reading === h.id ? null : h.id);
    onClose();
    router.push(href, { scroll: false });
  }

  return (
    <>
      <label className="flex h-[52px] flex-none items-center gap-2.5 px-4">
        <Search size={17} className="flex-none text-ink3" />
        <input ref={field} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && hits[0] && open(hits[0])} placeholder="Search" aria-label="Search everything" className="min-w-0 flex-1 text-[16px]" />
        {query && (
          <button type="button" aria-label="Clear" onClick={() => (setQuery(""), field.current?.focus())} className="grid h-8 w-8 flex-none place-items-center rounded-full text-ink3 hover:bg-fill hover:text-ink">
            <X size={15} />
          </button>
        )}
      </label>
      {q.length > 1 && data && (
        <div data-results className="scroll flex min-h-0 flex-col gap-0.5 overflow-y-auto border-t hairline p-1.5">
          {hits.map((h) => {
            const kind = hitKind(h);
            const Icon = HIT_ICON[kind] ?? BookOpen;
            // a post is found by its words: they are its title
            const title = h.type === "post" ? null : h.title;
            return (
              <div key={h.type + h.id} data-hit={kind} className="flex flex-col">
                <button type="button" onClick={() => open(h)} aria-label={`${HIT_KIND[kind] ?? "Note"}: ${title || h.snippet.replaceAll("**", "")}`} aria-expanded={h.type === "post" ? reading === h.id : undefined} className="flex w-full items-start gap-3 rounded-[16px] px-2.5 py-2 text-left transition-colors hover:bg-fill">
                  <Icon size={17} strokeWidth={1.8} className="mt-[3px] flex-none text-ink3" />
                  <span className="min-w-0 flex-1">
                    {title && <span className="block truncate text-[15px] font-medium">{title}</span>}
                    <span className={`line-clamp-2 ${title ? "text-[13.5px] text-ink2" : "text-[15px]"}`}>{marked(h.snippet)}</span>
                  </span>
                  <span className="flex-none pt-[3px] text-[12px] text-ink3">{ago(h.at)}</span>
                </button>
                <AnimatePresence initial={false}>{reading === h.id && <PostPeek id={h.id} />}</AnimatePresence>
              </div>
            );
          })}
          {!hits.length && <p className="py-8 text-center text-[14px] text-ink3">Nothing found for “{q}”.</p>}
        </div>
      )}
    </>
  );
}

/** A post found by search, read in place: what it said, where it came from and what was said under it. */
function PostPeek({ id }: { id: string }) {
  const { agents, agent } = useMe();
  const handles = agents.map((a) => a.handle);
  const { data } = useSWR<{ root: Post; replies: Post[] }>(`posts/${id}`, fetcher);
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
      <div className="mb-1.5 ml-[38px] mr-2.5 flex flex-col gap-2 rounded-[16px] bg-fill px-3.5 py-3 text-[14px] leading-[1.45]">
        {data ? (
          [data.root, ...data.replies].map((p) => (
            <div key={p.id} className={p.id === id ? "" : "text-ink2"}>
              <span className="mr-1.5 text-[12.5px] font-medium text-ink3">{agent(p.author)?.name}</span>
              <span className="whitespace-pre-wrap break-words"><Rich text={p.body} handles={handles} /></span>
              {p.source && (
                <a href={p.source.url} target="_blank" rel="noreferrer" className="ml-1.5 text-[12.5px] text-ink3 underline underline-offset-2 hover:text-ink">{p.source.name}</a>
              )}
            </div>
          ))
        ) : (
          <span className="text-ink3">…</span>
        )}
      </div>
    </motion.div>
  );
}

// ---------- Chat ----------

/** What a message was about, in a few words: the thing that was open, else the screen. */
const aboutLabel = (a: About | null | undefined) => (a ? a.title || SCREENS[a.screen] || "" : "");

function ChatPanel() {
  const path = usePathname();
  const shown = useShown();
  const { agents, me, agent, direct, defaultAgent, refresh } = useMe();
  const { markRead } = useDirectUnread();
  const { data, mutate } = useSWR<{ messages: Post[] }>("chat", fetcher, { refreshInterval: 5_000 });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** The owner chose to leave out what is on screen, for the thing that is on screen now. */
  const [left, setLeft] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const handles = agents.map((x) => x.handle);
  const messages = data?.messages ?? [];
  const lastId = messages[messages.length - 1]?.id;

  const screen = screenOf(path);
  const about: About = shown ? { screen, type: shown.type, id: shown.id, title: shown.title } : { screen };
  const aboutKey = shown ? shown.id : screen;
  const attached = left !== aboutKey;

  // Keep the newest message in view, and count every conversation as read while chat is open.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (lastId) refresh();
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps
  const moved = JSON.stringify(direct);
  useEffect(() => {
    for (const [id, at] of Object.entries(direct)) markRead(id, at);
  }, [moved]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    setText("");
    try {
      const { message } = await api<{ message: Post }>("chat", { body: { body, about: attached ? about : null } });
      await mutate((cur) => ({ messages: [...(cur?.messages ?? []).filter((m) => m.id !== message.id), message] }), { revalidate: true });
    } catch (e) {
      setText(body);
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <>
      <div ref={list} data-messages className="scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3.5 pb-1 pt-3.5">
        <span className="flex-1" aria-hidden />
        {messages.map((m, i) => {
          const mine = m.author === me?.id;
          const prev = messages[i - 1];
          const who = agent(m.author);
          // a quiet line when time has passed, and a face when the speaker changes
          const gap = !!prev && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 3_600_000;
          const from = !mine && (!prev || prev.author !== m.author || gap);
          const lastAbout = mine ? aboutLabel([...messages.slice(0, i)].reverse().find((x) => x.author === me?.id)?.about) : "";
          const label = mine ? aboutLabel(m.about) : "";
          return (
            <div key={m.id} className="flex flex-col">
              {gap && <div className="py-1.5 text-center text-[12px] text-ink3">{/^\d+[mhd]$/.test(ago(m.created_at)) ? `${ago(m.created_at)} ago` : ago(m.created_at)}</div>}
              {label && (label !== lastAbout || gap) && <div data-about className="mb-0.5 mt-1 max-w-[85%] self-end truncate pr-1 text-[12px] text-ink3">{label}</div>}
              <div className={`flex max-w-[88%] items-end gap-1.5 ${mine ? "self-end" : "self-start"}`}>
                {!mine && <span className="w-[22px] flex-none">{from && who && <Avatar agent={who} size={22} />}</span>}
                <div className={`min-w-0 whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-[15px] leading-[1.42] ${mine ? "bg-accent-soft" : "bg-fill"}`}>
                  <Rich text={m.body} handles={handles} />
                  {m.page && <PageCard page={m.page} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex-none px-2.5 pb-2.5 pt-1.5">
        {attached && (
          <button type="button" data-about-chip onClick={() => setLeft(aboutKey)} aria-label={`Leave out ${aboutLabel(about)}`} className="mb-1.5 ml-1 flex max-w-full items-center gap-1 rounded-full bg-accent-soft py-1 pl-2.5 pr-1.5 text-[12.5px] text-accent">
            <span className="truncate">{aboutLabel(about)}</span>
            <X size={13} className="flex-none opacity-70" />
          </button>
        )}
        <form onSubmit={(e) => (e.preventDefault(), send())} className="flex gap-2 rounded-[20px] bg-fill py-1.5 pl-3.5 pr-1.5">
          <ChatField value={text} onChange={setText} onSubmit={send} placeholder={defaultAgent ? `Message ${defaultAgent.name}` : "Message"} />
          <SendButton show={!!text.trim()} busy={busy} />
        </form>
        {error && <p className="ml-1 mt-1.5 text-[12.5px] text-danger">{error}</p>}
      </div>
    </>
  );
}

/** The message field, focused once the panel is in place (it mounts a frame before it is placed). */
function ChatField(props: { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => wrap.current?.querySelector("textarea")?.focus({ preventScroll: true }), []);
  return (
    <div ref={wrap} className="flex min-w-0 flex-1">
      <MentionInput {...props} className="py-[5px] text-[15px]" />
    </div>
  );
}

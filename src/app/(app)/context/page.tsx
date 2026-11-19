"use client";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { ArrowUpRight, ChevronRight, FileText, LayoutTemplate, Link2, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { Avatar, mesh } from "@/components/bits";
import { Editor } from "@/components/Editor";
import { ago, api, fetcher, hash, soft, useMe, useSaver } from "@/lib/client";
import type { ContextLite, ContextNode } from "@/lib/core/context";
import type { LinkPage } from "@/lib/core/links";
import type { Proposal } from "@/lib/core/rules";
import { PALETTES } from "@/lib/palettes";

type View = { node: ContextNode | null; trail: { id: string; path: string; title: string }[]; children: ContextLite[] };
type Hit = { id: string; type: string; title?: string; path?: string; snippet: string; at: string };

export default function ContextPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const nodeId = params.get("node");
  const links = !nodeId && params.get("view") === "links";
  const go = (id: string | null) => router.push(id ? `/context?node=${id}` : "/context", { scroll: false });
  const [adding, setAdding] = useState(false);
  useEffect(() => setAdding(false), [nodeId]);
  const { data, mutate } = useSWR<View>(`context${nodeId ? `?node=${nodeId}` : ""}`, fetcher, { refreshInterval: 20_000, keepPreviousData: true });
  const [query, setQuery] = useState("");
  const { data: hits } = useSWR<{ results: Hit[] }>(query.trim().length > 1 ? `search?types=context,link&q=${encodeURIComponent(query.trim())}` : null, fetcher, { keepPreviousData: true });
  const searching = query.trim().length > 1;

  async function addChild() {
    const n = await api<ContextNode>("context", { body: { parent: nodeId, title: "Untitled" } });
    go(n.id);
  }

  return (
    <div className="mx-auto max-w-[880px]">
      <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 px-1">
        <nav className="flex min-w-0 flex-1 items-center gap-1 max-sm:basis-full text-[30px] font-bold leading-tight tracking-[-0.03em]" aria-label="Breadcrumb">
          <button onClick={() => go(null)} className={`transition-colors ${data?.node || links ? "text-ink3 hover:text-ink" : ""}`}>
            Context
          </button>
          {links && (
            <span className="flex min-w-0 items-center gap-1 text-[17px] font-semibold tracking-normal">
              <ChevronRight size={18} className="flex-none text-ink3" />
              Links
            </span>
          )}
          {data?.trail.slice(0, -1).map((t) => (
            <span key={t.id} className="flex min-w-0 items-center gap-1 text-[17px] font-semibold tracking-normal">
              <ChevronRight size={18} className="flex-none text-ink3" />
              <button onClick={() => go(t.id)} className="truncate text-ink3 transition-colors hover:text-ink">
                {t.title}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex flex-none items-center gap-3 max-sm:w-full">
          <button onClick={() => router.push(links ? "/context" : "/context?view=links", { scroll: false })} aria-pressed={links} className={`glass flex h-10 flex-none items-center gap-1.5 rounded-full px-3.5 text-[14.5px] font-medium transition-colors ${links ? "text-accent" : "text-ink2 hover:text-ink"}`}>
            <Link2 size={16} /> Links
          </button>
          <label className="glass flex h-10 w-[220px] flex-none items-center gap-2 rounded-full px-3.5 transition-[width] duration-500 ease-out-soft focus-within:w-[300px] max-sm:w-auto max-sm:min-w-0 max-sm:flex-1 max-sm:focus-within:w-auto">
            <Search size={16} className="flex-none text-ink3" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder="Search" aria-label="Search context" className="min-w-0 flex-1 text-[15px]" />
            {query && (
              <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="text-ink3">
                <X size={15} />
              </button>
            )}
          </label>
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {searching ? (
          <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="flex flex-col gap-2">
            {hits?.results.map((h, i) => (
              <motion.button key={h.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: i * 0.03 }} onClick={() => (setQuery(""), go(h.id))} className="glass rounded-[20px] p-4 text-left transition-transform duration-300 hover:scale-[1.005]">
                <div className="text-[12.5px] text-ink3">{h.path?.replace("/context/", "").split("/").slice(0, -1).join(" › ")}</div>
                <div className="text-[16px] font-semibold">{h.title}</div>
                <p className="mt-0.5 line-clamp-2 text-[14px] text-ink2">
                  {h.snippet.split("**").map((s, j) => (j % 2 ? <mark key={j} className="rounded bg-accent-soft px-0.5 text-ink">{s}</mark> : s))}
                </p>
              </motion.button>
            ))}
            {hits && !hits.results.length && <p className="py-16 text-center text-ink3">Nothing found for “{query.trim()}”.</p>}
          </motion.div>
        ) : links ? (
          <motion.div key="links" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
            <LinksView onOpen={go} />
          </motion.div>
        ) : data ? (
          <motion.div key={nodeId ?? "root"} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
            {data.node && data.node.id === nodeId && <NodeEditor node={data.node} onChanged={() => mutate()} onDeleted={() => go(data.node!.parent_id)} />}
            {!data.node && <p className="-mt-4 mb-6 px-1 text-[14px] text-ink2">What your agents know about you, your life and their work. They keep it current; you can change anything.</p>}
            {/* house rules: what agents have proposed waits here as well as in the rail */}
            {(!data.node || data.node.path === "system" || data.node.path.startsWith("system/")) && <Proposals onDecided={() => mutate()} />}
            {!data.node && <RecentPages onOpen={go} />}
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              {data.children.filter((c) => c.kind !== "link").map((c, i) => (
                <Card key={c.id} node={c} index={i} onOpen={() => go(c.id)} />
              ))}
              {data.node?.kind !== "link" && (
                <motion.button whileTap={{ scale: 0.98 }} onClick={addChild} className="flex min-h-[84px] items-center justify-center gap-2 rounded-[22px] border border-dashed border-[var(--fill-strong)] text-[14.5px] text-ink2 transition-colors hover:border-accent hover:text-accent">
                  <Plus size={17} /> {data.node ? "Add a note inside" : "New area"}
                </motion.button>
              )}
              {data.node && data.node.kind !== "link" && !adding && (
                <motion.button whileTap={{ scale: 0.98 }} onClick={() => setAdding(true)} className="flex min-h-[84px] items-center justify-center gap-2 rounded-[22px] border border-dashed border-[var(--fill-strong)] text-[14.5px] text-ink2 transition-colors hover:border-accent hover:text-accent">
                  <Link2 size={17} /> Add a link
                </motion.button>
              )}
            </div>
            {data.node && data.node.kind !== "link" && <NodeLinks parent={data.node.id} adding={adding} onDone={() => setAdding(false)} onOpen={go} />}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * Changes agents have proposed to the house rules (the notes under System), waiting for the
 * owner. Each says who proposes what and why, shows the change, and is answered here or from the
 * rail; either way the same thing happens. Nothing shows when nothing is waiting.
 */
function Proposals({ onDecided }: { onDecided: () => void }) {
  const { agent } = useMe();
  const { mutate: everywhere } = useSWRConfig();
  const { data, mutate } = useSWR<{ proposals: (Proposal & { by: string })[] }>("rules/proposals", fetcher, { refreshInterval: 20_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const list = data?.proposals ?? [];
  if (!list.length && !problem) return null;
  async function answer(p: Proposal, approve: boolean) {
    setBusy(p.id);
    setProblem(null);
    try {
      const r = await api<Proposal>(`rules/proposals/${p.id}`, { method: "POST", body: { approve } });
      if (r.status === "failed") setProblem({ id: p.id, text: `“${p.title}” could not be changed: the rule has changed since this was proposed. ${agent(p.agent_id)?.name ?? "The agent"} can propose it again.` });
    } catch (e) {
      setProblem({ id: p.id, text: (e as Error).message });
    } finally {
      setBusy(null);
      await mutate();
      onDecided();
      void everywhere("rail");
    }
  }
  return (
    <section data-proposals aria-label="Proposed changes to the house rules" className="mb-6 flex flex-col gap-2.5">
      {list.map((p) => {
        const by = agent(p.agent_id);
        const what = p.kind === "create" ? "a new house rule" : p.kind === "archive" ? `removing “${p.title}”` : `a change to “${p.title}”`;
        return (
          <article key={p.id} data-proposal={p.id} className="glass rounded-[22px] p-4">
            <div className="flex items-center gap-2 text-[13px] text-ink2">
              {by && <Avatar agent={by} size={18} />}
              <span className="min-w-0 flex-1 truncate">
                {by?.name ?? "An agent"} proposes {what}
              </span>
              <span className="flex-none text-ink3">{ago(p.created_at)}</span>
            </div>
            <p className="mt-1.5 text-[15.5px] font-medium leading-snug [overflow-wrap:anywhere]">{p.why}</p>
            <p className="mt-2 rounded-[14px] bg-fill px-3 py-2.5 text-[13.5px] leading-relaxed text-ink2 [overflow-wrap:anywhere]">{p.excerpt}</p>
            {p.kind !== "archive" && p.after.trim() && (
              <details className="mt-2 text-[13px] text-ink2">
                <summary className="cursor-pointer list-none font-medium text-ink3 marker:hidden hover:text-ink2">Read the rule as it would be</summary>
                <p className="mt-2 whitespace-pre-wrap rounded-[14px] bg-fill px-3 py-2.5 leading-relaxed [overflow-wrap:anywhere]">{p.after}</p>
              </details>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button disabled={busy === p.id} onClick={() => answer(p, true)} className="flex h-9 items-center rounded-full bg-accent-soft px-4 text-[13.5px] font-medium text-accent transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] disabled:opacity-50">
                Approve
              </button>
              <button disabled={busy === p.id} onClick={() => answer(p, false)} className="flex h-9 items-center rounded-full bg-fill px-4 text-[13.5px] font-medium text-ink2 transition-colors hover:bg-fill2 disabled:opacity-50">
                Decline
              </button>
            </div>
          </article>
        );
      })}
      {problem && (
        <p role="alert" className="px-1 text-[13px] text-danger">
          {problem.text}
        </p>
      )}
    </section>
  );
}

/** Shows an address the way people say it: no scheme, no www, no trailing slash. */
const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/**
 * Saved links a page at a time, newest first: everywhere, or inside one area. Only the pages that
 * have been scrolled to are ever fetched, so the list stays quick with thousands of links.
 */
function useLinkPages(parent?: string) {
  const { data, size, setSize, mutate, isValidating } = useSWRInfinite<LinkPage>(
    (_i, prev: LinkPage | null) => (prev && !prev.next ? null : `links?${parent ? `parent=${parent}&` : ""}${prev?.next ? `before=${prev.next}` : ""}`),
    fetcher,
    { refreshInterval: 30_000, revalidateFirstPage: true },
  );
  const last = data?.[data.length - 1];
  return {
    loaded: !!data,
    links: data?.flatMap((d) => d.links) ?? [],
    total: data?.[0]?.total ?? 0,
    more: !!last?.next,
    busy: isValidating,
    loadMore: () => !isValidating && last?.next && setSize(size + 1),
    refresh: () => mutate(),
  };
}

/** The rows, and a marker at the end that fetches the next page as it scrolls into view. */
function LinkList({ pages, showArea, onOpen }: { pages: ReturnType<typeof useLinkPages>; showArea?: boolean; onOpen: (id: string) => void }) {
  const end = useRef<HTMLDivElement>(null);
  const loadMore = useRef(pages.loadMore);
  loadMore.current = pages.loadMore;
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const seen = new IntersectionObserver((e) => e[0].isIntersecting && loadMore.current(), { rootMargin: "600px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [pages.more]);
  // rows that arrive with a later page should not replay the staggered entrance of the first screen
  const first = useRef(0);
  if (!first.current && pages.links.length) first.current = pages.links.length;
  return (
    <>
      <div className="flex flex-col">
        {pages.links.map((l, i) => (
          <LinkRow key={l.id} link={l} index={i < first.current ? i : 0} area={showArea && l.parent_path && l.parent_path !== "links" ? l.parent_title : null} onOpen={() => onOpen(l.id)} />
        ))}
      </div>
      {pages.more && (
        <div ref={end} className="flex justify-center py-4">
          <button onClick={() => pages.loadMore()} className="h-9 rounded-full px-4 text-[13.5px] text-ink3 transition-colors hover:bg-fill hover:text-ink2">
            {pages.busy ? "Loading" : `Show more · ${pages.links.length} of ${pages.total.toLocaleString()}`}
          </button>
        </div>
      )}
    </>
  );
}

/** Every saved link, newest first, with a box to add one. */
function LinksView({ onOpen }: { onOpen: (id: string) => void }) {
  const pages = useLinkPages();
  return (
    <div>
      <QuickAdd onSaved={pages.refresh} />
      <div className="mt-4">
        <LinkList pages={pages} showArea onOpen={onOpen} />
      </div>
      {pages.loaded && !pages.links.length && <p className="py-14 text-center text-[14.5px] text-ink3">No links yet. Paste one above, or tell an agent to save one.</p>}
    </div>
  );
}

/** The links filed under one area, with the box to add one there. */
function NodeLinks({ parent, adding, onDone, onOpen }: { parent: string; adding: boolean; onDone: () => void; onOpen: (id: string) => void }) {
  const pages = useLinkPages(parent);
  return (
    <>
      {adding && (
        <div className="mt-4">
          <QuickAdd parent={parent} autoFocus onSaved={() => (onDone(), pages.refresh())} />
        </div>
      )}
      {pages.links.length > 0 && (
        <div className="mt-4">
          <LinkList pages={pages} onOpen={onOpen} />
        </div>
      )}
    </>
  );
}

/** Paste an address, optionally say why, save. */
function QuickAdd({ parent, autoFocus, onSaved }: { parent?: string; autoFocus?: boolean; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = /^\S+\.\S{2,}$/.test(url.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("links", { body: { url: url.trim(), why: why.trim() || undefined, parent } });
      setUrl("");
      setWhy("");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="glass rounded-[22px] px-4">
      <div className="flex h-12 items-center gap-2.5">
        <Link2 size={17} className="flex-none text-ink3" />
        <input value={url} onChange={(e) => (setUrl(e.target.value), setError(""))} autoFocus={autoFocus} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Paste a link" aria-label="Link address" className="min-w-0 flex-1 text-[15.5px]" />
        <AnimatePresence initial={false}>
          {ready && (
            <motion.button key="save" type="submit" disabled={busy} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={soft} className="h-8 flex-none rounded-full bg-accent px-3.5 text-[13.5px] font-medium text-white transition-opacity disabled:opacity-60">
              {busy ? "Saving" : "Save"}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false}>
        {ready && (
          <motion.div key="why" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why you’re keeping it (optional)" aria-label="Why you’re keeping it" maxLength={400} className="mb-3 block w-full pl-[27px] text-[14.5px] text-ink2" />
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p className="pb-3 pl-[27px] text-[13px] text-danger">{error}</p>}
    </form>
  );
}

/** One saved link: tapping it opens the page; the small button opens its notes. */
function LinkRow({ link, index, area, onOpen }: { link: ContextLite; index: number; area?: string | null; onOpen: () => void }) {
  const line = link.summary || link.blurb;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: Math.min(index, 12) * 0.025 }} className="link-row flex items-start rounded-[16px]" data-link={link.id}>
      <a href={link.url ?? "#"} target="_blank" rel="noreferrer" className="min-w-0 flex-1 py-2.5 pl-3 pr-1">
        <span className="block truncate text-[15.5px] font-medium">{link.title}</span>
        {line && <span className={`line-clamp-2 text-[13.5px] leading-snug ${link.summary ? "text-ink2" : "text-ink3"}`}>{line}</span>}
        <span className="mt-0.5 block truncate text-[12px] text-ink3">{[link.site, area, ago(link.created_at)].filter(Boolean).join(" · ")}</span>
      </a>
      <button onClick={onOpen} aria-label={link.body_chars ? `Notes on ${link.title}` : `Details for ${link.title}`} title={link.body_chars ? "Notes" : "Details"} className={`mr-1.5 mt-2 grid h-9 w-9 flex-none place-items-center rounded-full transition-colors hover:bg-fill hover:text-ink ${link.body_chars ? "text-ink2" : "text-ink3"}`}>
        {link.body_chars ? <FileText size={16} /> : <MoreHorizontal size={16} />}
      </button>
    </motion.div>
  );
}

function RecentPages({ onOpen }: { onOpen: (id: string) => void }) {
  const { data } = useSWR<{ pages: ContextLite[] }>("pages", fetcher, { refreshInterval: 30_000 });
  if (!data?.pages.length) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-ink3">Recent pages</h2>
      <div data-scroll-x className="carousel -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 pt-1">
        {data.pages.map((p) => {
          const seed = hash(p.id);
          const pal = PALETTES[seed % PALETTES.length];
          return (
            <button key={p.id} onClick={() => onOpen(p.id)} className="glass group w-[210px] flex-none snap-start overflow-hidden rounded-[20px] text-left transition-[transform,box-shadow] duration-300 ease-out-soft hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
              {p.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.cover} alt="" loading="lazy" className="h-[92px] w-full bg-fill object-cover" />
              ) : (
                <div className="grid h-[92px] place-items-center" style={{ ...mesh(seed, pal.colors), color: pal.ink }}>
                  <LayoutTemplate size={22} strokeWidth={1.6} />
                </div>
              )}
              <div className="p-3">
                <div className="truncate text-[14.5px] font-semibold">{p.title}</div>
                <p className="line-clamp-2 h-[34px] text-[12.5px] leading-snug text-ink2">{p.summary}</p>
                <div className="mt-1 truncate text-[11.5px] text-ink3">
                  {p.path.split("/").slice(0, -1).join(" › ")} · {ago(p.created_at)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Card({ node, index, onOpen }: { node: ContextLite; index: number; onOpen: () => void }) {
  const { agent } = useMe();
  const seed = hash(node.id);
  const p = PALETTES[seed % PALETTES.length];
  const by = agent(node.updated_by);
  return (
    <motion.button initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: Math.min(index, 10) * 0.035 }} whileTap={{ scale: 0.985 }} onClick={onOpen} className="glass group flex items-start gap-3.5 rounded-[22px] p-4 text-left transition-shadow duration-500 hover:shadow-[0_2px_4px_rgba(0,0,0,.03),0_14px_40px_rgba(30,20,60,.09)]">
      <div className="grid h-11 w-11 flex-none place-items-center rounded-[14px] transition-transform duration-500 ease-out-soft group-hover:rotate-[-6deg] group-hover:scale-105" style={{ ...mesh(seed, p.colors), color: p.ink, boxShadow: "inset 0 0 0 1px rgba(255,255,255,.4)" }}>
        {node.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={node.cover} alt="" loading="lazy" className="h-full w-full rounded-[14px] object-cover" />
        ) : node.child_count ? (
          <span className="text-[15px] font-bold">{node.child_count}</span>
        ) : node.kind === "page" ? (
          <LayoutTemplate size={18} strokeWidth={1.8} />
        ) : (
          <FileText size={18} strokeWidth={1.8} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[16px] font-semibold">{node.title}</span>
          {node.kind === "page" && <span className="flex-none rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent">Page</span>}
        </div>
        <p className="line-clamp-2 text-[13.5px] leading-snug text-ink2">{node.summary || (node.body_chars ? "No summary yet." : "Empty.")}</p>
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink3">
          {by && <Avatar agent={by} size={14} />}
          {by?.name} · {ago(node.updated_at)}
        </div>
      </div>
    </motion.button>
  );
}

/** Sizes a one-line text area to its content so long titles wrap instead of being cut off. */
const grow = (el: HTMLTextAreaElement | null) => {
  if (el) (el.style.height = "0px"), (el.style.height = el.scrollHeight + "px");
};

function NodeEditor({ node, onChanged, onDeleted }: { node: ContextNode; onChanged: () => void; onDeleted: () => void }) {
  const { agent } = useMe();
  const [title, setTitle] = useState(node.title);
  const [summary, setSummary] = useState(node.summary);
  const [body, setBody] = useState(node.body);
  const by = agent(node.updated_by);

  const patch = async (b: Record<string, unknown>) => (await api(`context/${node.id}`, { method: "PATCH", body: b }), onChanged());
  const saver = useSaver((md) => patch({ body: md }), 700);

  // Fresh content from agents flows in unless something typed here is still unsaved.
  useEffect(() => {
    if (!saver.dirty()) setBody(node.body);
  }, [node.body]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="glass mb-5 overflow-hidden rounded-[26px] p-6 max-md:p-5">
      {node.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={node.cover} alt="" className="-mx-6 -mt-6 mb-5 block h-[200px] w-[calc(100%+3rem)] max-w-none bg-fill object-cover max-md:-mx-5 max-md:-mt-5 max-md:h-[150px] max-md:w-[calc(100%+2.5rem)]" onError={(e) => (e.currentTarget.style.display = "none")} />
      )}
      <div className="flex items-start gap-3">
        <textarea
          value={title}
          rows={1}
          aria-label="Title"
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
          onBlur={() => title.trim() && title !== node.title && patch({ title })}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
          autoFocus={node.title === "Untitled"}
          onFocus={(e) => node.title === "Untitled" && e.currentTarget.select()}
          ref={grow}
          className="min-w-0 flex-1 resize-none overflow-hidden text-[26px] font-bold leading-[1.2] tracking-[-0.025em]"
        />
        <ConfirmDelete label="Remove" confirm="Remove" className="mt-1" onConfirm={async () => (await api(`context/${node.id}`, { method: "DELETE" }), onDeleted())} />
      </div>
      <textarea
        value={summary}
        rows={1}
        aria-label="Summary"
        onChange={(e) => setSummary(e.target.value.replace(/\n/g, ""))}
        onBlur={() => summary !== node.summary && patch({ summary })}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
        placeholder={node.kind === "link" ? "Why you’re keeping it" : "One line on what this is about"}
        ref={grow}
        className="mt-0.5 block w-full resize-none overflow-hidden text-[15px] leading-snug text-ink2"
      />
      {node.kind === "link" && node.url && (
        <div className="mt-1.5">
          {node.blurb && <p className="mb-1.5 text-[14px] leading-snug text-ink3">{node.blurb}</p>}
          <a href={node.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-[13.5px] text-ink2 underline decoration-[var(--line)] underline-offset-[3px] transition-colors hover:text-ink">
            <span className="truncate">{bare(node.url)}</span>
            <ArrowUpRight size={13} className="flex-none text-ink3" />
          </a>
        </div>
      )}
      <div className="mb-6 mt-2 flex items-center gap-1.5 pr-10 text-[12.5px] text-ink3">
        {by && <Avatar agent={by} size={15} />}
        Updated by {by?.name ?? "someone"} · {ago(node.updated_at)} · version {node.version}
      </div>
      <div className="editor-compact">
        <Editor
          value={body}
          placeholder={node.kind === "link" ? "Notes, if you want them." : "Write what is worth remembering. Agents read this before they ask you."}
          onChange={saver.push}
        />
      </div>
    </div>
  );
}

"use client";
import { ChevronRight, FileText, Plus, Search, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Avatar, mesh } from "@/components/bits";
import { Editor } from "@/components/Editor";
import { ago, api, fetcher, hash, soft, useMe } from "@/lib/client";
import type { ContextLite, ContextNode } from "@/lib/core/context";
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
  const nodeId = useSearchParams().get("node");
  const go = (id: string | null) => router.push(id ? `/context?node=${id}` : "/context", { scroll: false });
  const { data, mutate } = useSWR<View>(`context${nodeId ? `?node=${nodeId}` : ""}`, fetcher, { refreshInterval: 20_000, keepPreviousData: true });
  const [query, setQuery] = useState("");
  const { data: hits } = useSWR<{ results: Hit[] }>(query.trim().length > 1 ? `search?types=context&q=${encodeURIComponent(query.trim())}` : null, fetcher, { keepPreviousData: true });
  const searching = query.trim().length > 1;

  async function addChild() {
    const n = await api<ContextNode>("context", { body: { parent: nodeId, title: "Untitled" } });
    go(n.id);
  }

  return (
    <div className="mx-auto max-w-[820px]">
      <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 px-1">
        <nav className="flex min-w-0 flex-1 items-center gap-1 max-sm:basis-full text-[30px] font-bold leading-tight tracking-[-0.03em]" aria-label="Breadcrumb">
          <button onClick={() => go(null)} className={`transition-colors ${data?.node ? "text-ink3 hover:text-ink" : ""}`}>
            Context
          </button>
          {data?.trail.slice(0, -1).map((t) => (
            <span key={t.id} className="flex min-w-0 items-center gap-1 text-[17px] font-semibold tracking-normal">
              <ChevronRight size={18} className="flex-none text-ink3" />
              <button onClick={() => go(t.id)} className="truncate text-ink3 transition-colors hover:text-ink">
                {t.title}
              </button>
            </span>
          ))}
        </nav>
        <label className="glass flex h-10 w-[220px] flex-none items-center gap-2 rounded-full px-3.5 transition-[width] duration-500 ease-out-soft focus-within:w-[300px] max-sm:w-full max-sm:focus-within:w-full">
          <Search size={16} className="flex-none text-ink3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder="Search" aria-label="Search context" className="min-w-0 flex-1 text-[15px]" />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="text-ink3">
              <X size={15} />
            </button>
          )}
        </label>
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
        ) : data ? (
          <motion.div key={nodeId ?? "root"} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
            {data.node && data.node.id === nodeId && <NodeEditor node={data.node} onChanged={() => mutate()} onDeleted={() => go(data.node!.parent_id)} />}
            {!data.node && <p className="-mt-4 mb-6 px-1 text-[14px] text-ink2">What your agents know about you, your life and their work. They keep it current; you can change anything.</p>}
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              {data.children.map((c, i) => (
                <Card key={c.id} node={c} index={i} onOpen={() => go(c.id)} />
              ))}
              <motion.button whileTap={{ scale: 0.98 }} onClick={addChild} className="flex min-h-[84px] items-center justify-center gap-2 rounded-[22px] border border-dashed border-[var(--fill-strong)] text-[14.5px] text-ink2 transition-colors hover:border-accent hover:text-accent">
                <Plus size={17} /> {data.node ? "Add a note inside" : "New area"}
              </motion.button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
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
        {node.child_count ? <span className="text-[15px] font-bold">{node.child_count}</span> : <FileText size={18} strokeWidth={1.8} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold">{node.title}</div>
        <p className="line-clamp-2 text-[13.5px] leading-snug text-ink2">{node.summary || (node.body_chars ? "No summary yet." : "Empty.")}</p>
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink3">
          {by && <Avatar agent={by} size={14} />}
          {by?.name} · {ago(node.updated_at)}
        </div>
      </div>
    </motion.button>
  );
}

function NodeEditor({ node, onChanged, onDeleted }: { node: ContextNode; onChanged: () => void; onDeleted: () => void }) {
  const { agent } = useMe();
  const [title, setTitle] = useState(node.title);
  const [summary, setSummary] = useState(node.summary);
  const [confirm, setConfirm] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string | null>(null);
  const [body, setBody] = useState(node.body);
  const by = agent(node.updated_by);

  // Fresh content from agents flows in unless something typed here is still unsaved.
  useEffect(() => {
    if (latest.current === null) setBody(node.body);
  }, [node.body]);

  const patch = async (b: Record<string, unknown>) => (await api(`context/${node.id}`, { method: "PATCH", body: b }), onChanged());

  async function flush() {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (latest.current === null) return;
    const md = latest.current;
    await patch({ body: md });
    if (latest.current === md) latest.current = null;
  }
  useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="glass mb-5 rounded-[26px] p-6 max-md:p-5">
      <div className="flex items-start gap-3">
        <input value={title} aria-label="Title" onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== node.title && patch({ title })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} autoFocus={node.title === "Untitled"} onFocus={(e) => node.title === "Untitled" && e.currentTarget.select()} className="min-w-0 flex-1 text-[26px] font-bold tracking-[-0.025em]" />
        <AnimatePresence mode="wait" initial={false}>
          {confirm ? (
            <motion.button key="c" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} onClick={async () => (await api(`context/${node.id}`, { method: "DELETE" }), onDeleted())} onBlur={() => setConfirm(false)} autoFocus className="mt-1 h-8 rounded-full bg-danger px-3 text-[13px] font-medium text-white">
              Remove
            </motion.button>
          ) : (
            <motion.button key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-label="Remove" onClick={() => setConfirm(true)} className="mt-1 grid h-8 w-8 place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-danger">
              <Trash2 size={16} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <input value={summary} aria-label="Summary" onChange={(e) => setSummary(e.target.value)} onBlur={() => summary !== node.summary && patch({ summary })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} placeholder="One line on what this is about" className="mt-0.5 w-full text-[15px] text-ink2" />
      <div className="mb-5 mt-2 flex items-center gap-1.5 text-[12.5px] text-ink3">
        {by && <Avatar agent={by} size={15} />}
        Updated by {by?.name ?? "someone"} · {ago(node.updated_at)} · version {node.version}
      </div>
      <div className="editor-compact">
        <Editor
          value={body}
          placeholder="Write what is worth remembering. Agents read this before they ask you."
          onChange={(md) => {
            latest.current = md;
            if (pending.current) clearTimeout(pending.current);
            pending.current = setTimeout(flush, 700);
          }}
        />
      </div>
    </div>
  );
}

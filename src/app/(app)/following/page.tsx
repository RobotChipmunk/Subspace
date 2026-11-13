"use client";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Avatar, PageHeader, Rich, TrackerTile } from "@/components/bits";
import { Floating } from "@/components/Floating";
import { ago, api, fetcher, soft, spring, useMe } from "@/lib/client";
import type { Post } from "@/lib/core/posts";
import type { Tracker } from "@/lib/core/trackers";

export default function FollowingPage() {
  const { data, mutate } = useSWR<{ trackers: Tracker[] }>("trackers", fetcher, { refreshInterval: 15_000 });
  const { refresh } = useMe();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const changed = () => (mutate(), refresh());

  return (
    <div className="mx-auto max-w-[680px]">
      <PageHeader title="Following" sub="Things your agents keep an eye on for you." />
      <div className="flex flex-col gap-2.5">
        <AnimatePresence initial={false}>
          {data?.trackers.map((t, i) => (
            <Row key={t.id} tracker={t} index={i} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} onChanged={changed} onRemoved={() => (setOpenId(null), changed())} />
          ))}
        </AnimatePresence>
        <AnimatePresence mode="wait" initial={false}>
          {adding ? (
            <AddForm key="form" onDone={(t) => (setAdding(false), t && (changed(), setOpenId(t.id)))} />
          ) : (
            <motion.button key="add" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} whileTap={{ scale: 0.985 }} onClick={() => setAdding(true)} className="flex h-[68px] items-center justify-center gap-2 rounded-[24px] border border-dashed border-[var(--fill-strong)] text-[14.5px] text-ink2 transition-colors hover:border-accent hover:text-accent">
              <Plus size={17} /> Follow something
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function AddForm({ onDone }: { onDone: (t?: Tracker) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      onDone(await api<Tracker>("trackers", { body: { title, description } }));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <motion.form initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={soft} onSubmit={submit} className="glass glass-lift rounded-[24px] p-5">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What should they follow?" aria-label="Title" className="w-full text-[18px] font-semibold" onKeyDown={(e) => e.key === "Escape" && onDone()} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Describe what counts as news, which sources matter and what to ignore." aria-label="Description" className="mt-2 w-full resize-none text-[15px] leading-relaxed text-ink2" />
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => onDone()} className="h-9 rounded-full px-4 text-[14px] text-ink2 hover:bg-fill">
          Cancel
        </button>
        <button disabled={!title.trim()} className="h-9 rounded-full bg-ink px-4 text-[14px] font-medium text-bg transition-all active:scale-95 disabled:opacity-30">
          Follow
        </button>
      </div>
    </motion.form>
  );
}

function Row({ tracker: t, index, open, onToggle, onChanged, onRemoved }: { tracker: Tracker; index: number; open: boolean; onToggle: () => void; onChanged: () => void; onRemoved: () => void }) {
  const { agent } = useMe();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 350);
  }, [open]);

  return (
    <motion.div ref={ref} layout="position" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ ...soft, delay: open ? 0 : Math.min(index, 8) * 0.035 }} className={`glass scroll-mt-6 rounded-[24px] transition-shadow duration-500 ${open ? "glass-lift" : ""}`}>
      <button onClick={onToggle} aria-expanded={open} className="group flex w-full items-center gap-3.5 p-3.5 text-left">
        <motion.div animate={{ scale: open ? 1.08 : 1, rotate: open ? -4 : 0 }} transition={spring}>
          <TrackerTile tracker={t} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[16px] font-semibold">{t.title}</span>
            <span className="flex-none text-[12.5px] text-ink3">{ago(t.latest_at)}</span>
          </div>
          <p className={`truncate text-[14px] ${t.latest ? "text-ink2" : "text-ink3"}`}>{t.latest || (t.agents.length ? "Waiting for the first update." : "No agent assigned yet.")}</p>
        </div>
        <div className="flex flex-none -space-x-1.5">
          {t.agents.slice(0, 3).map((a) => (
            <Avatar key={a} agent={agent(a)} size={22} />
          ))}
        </div>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className="flex-none text-ink3">
          <ChevronDown size={18} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <Expanded tracker={t} onChanged={onChanged} onRemoved={onRemoved} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Expanded({ tracker: t, onChanged, onRemoved }: { tracker: Tracker; onChanged: () => void; onRemoved: () => void }) {
  const { agents, agent } = useMe();
  const { data } = useSWR<{ updates: Post[] }>(`trackers/${t.id}`, fetcher, { refreshInterval: 15_000 });
  const [description, setDescription] = useState(t.description);
  const [label, setLabel] = useState(t.label);
  const [picking, setPicking] = useState(false);
  const pickerBtn = useRef<HTMLButtonElement>(null);
  const patch = async (body: Record<string, unknown>) => (await api(`trackers/${t.id}`, { method: "PATCH", body }).catch(() => setLabel(t.label)), onChanged());
  const unassigned = agents.filter((a) => a.kind === "agent" && !t.agents.includes(a.id));
  const handles = agents.map((a) => a.handle);

  return (
    <div className="px-5 pb-5">
      <div className="border-t hairline pt-4">
        <textarea
          value={description}
          aria-label="What to track"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== t.description && patch({ description })}
          placeholder="Describe what to track in detail: what counts as news, sources, what to ignore."
          ref={(el) => {
            if (el) (el.style.height = "0px"), (el.style.height = el.scrollHeight + "px");
          }}
          className="w-full resize-none overflow-hidden text-[15px] leading-relaxed text-ink2 focus:text-ink"
        />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {t.agents.map((id) => {
            const a = agent(id);
            return (
              <motion.span layout key={id} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} className="group/chip flex h-8 items-center gap-1.5 rounded-full bg-fill pl-1 pr-2.5 text-[13.5px] font-medium">
                <Avatar agent={a} size={24} />
                {a?.name}
                <button aria-label={`Remove ${a?.name}`} onClick={() => patch({ remove_agents: [id] })} className="-mr-1 grid h-5 w-5 place-items-center rounded-full text-ink3 hover:bg-fill2 hover:text-ink">
                  <X size={12} />
                </button>
              </motion.span>
            );
          })}
          <div className="relative">
            <motion.button ref={pickerBtn} layout whileTap={{ scale: 0.92 }} aria-haspopup="menu" aria-expanded={picking} onClick={() => setPicking(!picking)} className="flex h-8 items-center gap-1 rounded-full border border-dashed border-[var(--fill-strong)] px-2.5 text-[13.5px] text-ink2 hover:border-accent hover:text-accent">
              <Plus size={14} /> Agent
            </motion.button>
            <AnimatePresence>
              {picking && (
                <Floating anchor={() => pickerBtn.current?.getBoundingClientRect() ?? null} inside={() => pickerBtn.current} onDismiss={() => setPicking(false)}>
                <motion.div role="menu" initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={spring} className="menu w-52 rounded-2xl p-1.5">
                  {unassigned.length ? (
                    unassigned.map((a) => (
                      <button key={a.id} role="menuitem" onClick={() => (setPicking(false), patch({ add_agents: [a.id] }))} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[14px] font-medium hover:bg-fill2">
                        <Avatar agent={a} size={24} /> {a.name}
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-1.5 text-[13px] text-ink3">Every agent is already on this.</p>
                  )}
                </motion.div>
                </Floating>
              )}
            </AnimatePresence>
          </div>
          <span className="flex-1" />
          <label className="flex h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-[12.5px] text-ink3">
            Label
            <input value={label} maxLength={18} aria-label="Feed label" onChange={(e) => setLabel(e.target.value)} onBlur={() => label.trim() && label !== t.label && patch({ label })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className="w-[92px] text-[13px] font-medium text-ink" />
          </label>
          <button aria-label="Stop following" title="Stop following" onClick={async () => (await api(`trackers/${t.id}`, { method: "DELETE" }), onRemoved())} className="grid h-8 w-8 place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-danger">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <ol className="relative mt-6">
        {(data?.updates.length ?? 0) > 1 && <span className="absolute bottom-3 left-[5px] top-3 w-px bg-[var(--fill-strong)]" />}
        {data?.updates.map((u, i) => (
          <motion.li key={u.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ ...soft, delay: Math.min(i, 10) * 0.045 }} className="relative flex gap-4 pb-5 last:pb-0">
            <span className={`relative mt-[7px] h-[11px] w-[11px] flex-none rounded-full border-2 border-[var(--surface-solid)] ${i === 0 ? "bg-accent shadow-[0_0_0_4px_var(--accent-soft)]" : "bg-ink3"}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-ink3">
                {new Date(u.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {agent(u.author)?.name}
              </div>
              <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.45]">
                <Rich text={u.body} handles={handles} />
              </p>
              {u.source && (
                <a href={u.source.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-block max-w-full truncate text-[13px] text-ink2 underline decoration-[var(--line)] underline-offset-[3px] transition-colors hover:text-accent">
                  {u.source.name}
                </a>
              )}
            </div>
          </motion.li>
        ))}
        {data && !data.updates.length && <p className="text-[14px] text-ink3">No updates yet. Assigned agents post here as things happen.</p>}
      </ol>
    </div>
  );
}

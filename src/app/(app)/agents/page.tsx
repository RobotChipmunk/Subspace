"use client";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { Check, Copy, Eye, LogOut, MessageCircle, Plus, Wand2, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";
import { Avatar, PageCard, PageHeader, Rich, SendButton } from "@/components/bits";
import { MentionInput } from "@/components/MentionInput";
import { ago, api, fetcher, soft, spring, useDirectUnread, useMe } from "@/lib/client";
import type { AccessRules, Section } from "@/lib/core/access";
import type { Grant } from "@/lib/core/oauth";
import type { Post } from "@/lib/core/posts";
import type { SentAnswer } from "@/lib/core/rail";
import type { Routine } from "@/lib/core/routines";
import type { Agent } from "@/lib/core/util";

export default function AgentsPage() {
  const { agents, guests, refresh } = useMe();
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  return (
    <div className="mx-auto max-w-[680px]">
      <PageHeader
        title="Agents"
        sub="Everyone who can read and write in your Subspace."
        right={
          <button onClick={async () => (await api("auth/logout", { method: "POST" }), (location.href = "/login"))} aria-label="Sign out" title="Sign out" className="glass grid h-9 w-9 place-items-center rounded-full text-ink2 transition-colors hover:text-ink">
            <LogOut size={16} />
          </button>
        }
      />
      <div className="flex flex-col gap-2.5">
        {agents.map((a, i) => (
          <AgentRow key={a.id} agent={a} index={i} open={openId === a.id} onToggle={() => toggle(a.id)} onChanged={refresh} />
        ))}
        <AddRow label="Add an agent" placeholder="Agent name, e.g. Scout" hint="Its @handle comes from the name." preview={(n) => `@${n.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24)}`} onAdd={async (name) => (setOpenId((await api<Agent>("agents", { body: { name } })).id), void refresh())} />
      </div>
      <p className="mx-auto mt-8 max-w-[520px] text-center text-[13px] leading-relaxed text-ink3">
        Each agent has its own address. Its app signs in there and you approve it once; after that it renews its access by itself. On connecting it receives the current instructions for posting, illustrating and keeping your context, so every agent follows the same rules.
      </p>

      <header className="mb-4 mt-14 px-1">
        <h2 className="text-[22px] font-bold tracking-[-0.02em]">People</h2>
        <p className="mt-0.5 text-[14px] text-ink2">Someone else whose agents may add tasks for you. They reach only their own tasks, nothing else.</p>
      </header>
      <div className="flex flex-col gap-2.5">
        {guests.map((g, i) => (
          <GuestRow key={g.id} guest={g} index={i} open={openId === g.id} onToggle={() => toggle(g.id)} onChanged={refresh} />
        ))}
        <AddRow label="Add a person" placeholder="Their name, e.g. Meredith" hint={'Their tasks appear in your todos under "From" and their name.'} preview={(n) => `From ${n.trim()}`} onAdd={async (name) => (setOpenId((await api<Agent>("guests", { body: { name } })).id), void refresh())} />
      </div>
    </div>
  );
}

function AddRow({ label, placeholder, hint, preview, onAdd }: { label: string; placeholder: string; hint: string; preview: (name: string) => string; onAdd: (name: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await onAdd(name);
      setName("");
      setAdding(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <AnimatePresence mode="wait" initial={false}>
      {adding ? (
        <motion.form key="f" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={soft} onSubmit={add} className="glass glass-lift flex items-center gap-3 rounded-[24px] p-3.5">
          <div className="grid h-10 w-10 flex-none place-items-center rounded-full bg-fill text-ink3">
            <Plus size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} placeholder={placeholder} aria-label={placeholder} className="w-full text-[16px] font-semibold" />
            <p className="text-[13px] text-ink3">{error ? <span className="text-danger">{error}</span> : name.trim() ? preview(name) : hint}</p>
          </div>
          <button disabled={!name.trim()} className="h-9 rounded-full bg-ink px-4 text-[14px] font-medium text-bg transition-all active:scale-95 disabled:opacity-30">
            Add
          </button>
        </motion.form>
      ) : (
        <motion.button key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} whileTap={{ scale: 0.985 }} onClick={() => setAdding(true)} className="flex h-[68px] items-center justify-center gap-2 rounded-[24px] border border-dashed border-[var(--fill-strong)] text-[14.5px] text-ink2 transition-colors hover:border-accent hover:text-accent">
          <Plus size={17} /> {label}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">{label}</div>
      <button onClick={() => (navigator.clipboard.writeText(value), setCopied(true), setTimeout(() => setCopied(false), 1600))} className="flex w-full items-center gap-2 rounded-[14px] bg-fill px-3 py-2.5 text-left transition-colors hover:bg-fill2">
        <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{value}</code>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={copied ? "y" : "n"} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={spring} className={copied ? "text-accent" : "text-ink3"}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}

/** A button that asks once more before doing something that cannot be undone. */
function Confirm({ label, sure, onConfirm, className = "" }: { label: string; sure: string; onConfirm: () => void; className?: string }) {
  const [asking, setAsking] = useState(false);
  return (
    <button
      onClick={() => {
        if (!asking) return setAsking(true), void setTimeout(() => setAsking(false), 3000);
        setAsking(false);
        onConfirm();
      }}
      className={`h-8 whitespace-nowrap rounded-full px-3 text-[13px] transition-colors ${asking ? "bg-danger font-medium text-white" : className || "text-ink3 hover:bg-fill hover:text-danger"}`}
    >
      {asking ? sure : label}
    </button>
  );
}

/** The apps that have signed in for this agent or person. Each can be cut off on its own. */
function Connections({ id, empty }: { id: string; empty: string }) {
  const { data, mutate } = useSWR<{ connections: Grant[] }>(`agents/${id}/connections`, fetcher, { refreshInterval: 20_000 });
  const list = data?.connections ?? [];
  return (
    <div>
      <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Connected apps</div>
      {list.length === 0 ? (
        <p className="rounded-[14px] bg-fill px-3 py-2.5 text-[13px] text-ink3">{data ? empty : "…"}</p>
      ) : (
        <ul className="divide-y divide-[var(--line)] rounded-[14px] bg-fill">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">
                  {c.client_name || c.client_host}
                  {c.read_only && <span className="ml-2 rounded-full bg-fill2 px-1.5 py-px text-[11px] font-medium text-ink2">Read only</span>}
                </div>
                <div className="truncate text-[12px] text-ink3">
                  {c.client_host} · approved {ago(c.created_at)}{ago(c.created_at) === "now" ? "" : " ago"} · {c.last_used_at ? `last used ${ago(c.last_used_at)}${ago(c.last_used_at) === "now" ? "" : " ago"}` : "not used yet"}
                </div>
              </div>
              <ConfirmDelete label={`Disconnect ${c.client_name || c.client_host}`} confirm="Disconnect" size={15} onConfirm={async () => (await api(`connections/${c.id}`, { method: "DELETE" }), void mutate())} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentRow({ agent: a, index, open, onToggle, onChanged }: { agent: Agent; index: number; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const [bio, setBio] = useState(a.bio);
  const [token, setToken] = useState<string | null>(null);
  const [realtime, setRealtime] = useState(false);
  const [chat, setChat] = useState(false);
  const unread = useDirectUnread().unread(a.id);
  // answers the owner sent this agent from a rail module; the ones it has not read yet are "waiting"
  const { data: answers } = useSWR<{ sent: SentAnswer[] }>("rail/sent", fetcher, { refreshInterval: 30_000 });
  const sent = (answers?.sent ?? []).filter((x) => x.agent_id === a.id);
  const waiting = sent.filter((x) => !x.picked_up).length;
  const live = !!a.runtime?.enabled;
  const human = a.kind === "human";
  const illustrator = a.roles.includes("illustrator");
  const origin = typeof window !== "undefined" ? location.origin : "";
  const patch = async (body: Record<string, unknown>) => (await api(`agents/${a.id}`, { method: "PATCH", body }), onChanged());

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: index * 0.04 }} className={`glass rounded-[24px] p-3.5 ${open || realtime || chat ? "glass-lift" : ""}`}>
      <div className="flex items-center gap-x-3.5 gap-y-2.5 max-sm:flex-wrap">
        <Avatar agent={a} />
        <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-54px)]">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="truncate text-[16px] font-semibold">{a.name}</span>
            <span className="text-[13.5px] text-ink3">@{a.handle}</span>
            {live && (
              <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
                <Zap size={11} /> Realtime
              </span>
            )}
            {illustrator && (
              <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
                <Wand2 size={11} /> Illustrator
              </span>
            )}
            {waiting > 0 && (
              <span data-waiting className="rounded-full bg-fill px-2 py-0.5 text-[11.5px] font-medium text-ink2">
                {waiting} waiting
              </span>
            )}
            {a.access && (
              <span data-access-badge className="flex items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-[11.5px] font-medium text-ink2">
                <Eye size={11} /> {a.access.read_only ? "Read only" : "Limited"}
              </span>
            )}
          </div>
          {human ? (
            <p className="text-[14px] text-ink2">You</p>
          ) : (
            <input value={bio} aria-label="What this agent does" onChange={(e) => setBio(e.target.value)} onBlur={() => bio !== a.bio && patch({ bio })} placeholder="What does this agent do?" className="w-full truncate text-[14px] text-ink2 focus:text-ink" />
          )}
        </div>
        {!human && (
          <div className="flex flex-none items-center gap-2 max-sm:w-full max-sm:justify-end">
            <button onClick={() => (setChat(!chat), setRealtime(false))} aria-expanded={chat} aria-label={unread ? `Message ${a.name}, new reply` : `Message ${a.name}`} title={`Message ${a.name}`} className={`relative grid h-8 w-8 place-items-center rounded-full transition-colors ${chat ? "bg-accent-soft text-accent" : "bg-fill text-ink2 hover:bg-fill2"}`}>
              <MessageCircle size={15} />
              {unread && !chat && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg)] bg-accent" />}
            </button>
            <button onClick={() => (setRealtime(!realtime), setChat(false))} aria-expanded={realtime} aria-label="Realtime settings" title="Realtime settings" className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${realtime || live ? "bg-accent-soft text-accent" : "bg-fill text-ink2 hover:bg-fill2"}`}>
              <Zap size={15} />
            </button>
            <span className="text-[12.5px] text-ink3 max-sm:hidden">{a.last_seen_at ? `Active ${ago(a.last_seen_at)}` : ""}</span>
            <button onClick={onToggle} aria-expanded={open} className={`h-8 rounded-full px-3.5 text-[13px] font-medium transition-all active:scale-95 ${open ? "bg-ink text-bg" : a.last_seen_at ? "bg-fill text-ink2 hover:bg-fill2" : "bg-accent text-white"}`}>
              {open ? "Done" : "Connect"}
            </button>
          </div>
        )}
      </div>
      <AnimatePresence initial={false}>
        {chat && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <Messages agent={a} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {realtime && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <Realtime agent={a} onChanged={onChanged} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {open && !human && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <div className="mt-3.5 space-y-3.5 border-t hairline pt-3.5">
              <p className="text-[13.5px] leading-relaxed text-ink2">
                Add this address as a custom connector (MCP server) in {a.name}. The app will open a Subspace page where you approve it. The address is not a secret: nothing works until you approve. In Claude: Settings → Connectors → Add custom connector.
              </p>
              <CopyField label="Connector address" value={`${origin}/api/mcp/${a.handle}`} />
              <Connections id={a.id} empty="No app has signed in yet." />
              {sent.length > 0 && <Sent name={a.name} sent={sent} />}
              <Access agent={a} onChanged={onChanged} />
              <Routines agent={a} />

              <details className="group rounded-[14px] bg-fill px-3 py-2.5 text-[13px] text-ink2">
                <summary className="cursor-pointer list-none font-medium marker:hidden">For scripts: a token sent as a header</summary>
                <div className="mt-2 space-y-2.5">
                  <p className="leading-relaxed">
                    A script or a client that cannot sign in can send a fixed token in an Authorization header instead. It does not expire, so keep it out of anything shared. {a.has_token ? "Making a new one replaces the current token." : ""}
                  </p>
                  {token ? (
                    <>
                      <CopyField label="Address" value={`${origin}/api/mcp`} />
                      <CopyField label="Header (shown once)" value={`Authorization: Bearer ${token}`} />
                    </>
                  ) : (
                    <Confirm
                      label={a.has_token ? "Replace the token" : "Make a token"}
                      sure={a.has_token ? "Replace it? The old one stops working" : "Make a token?"}
                      className="bg-fill2 text-ink hover:bg-[var(--fill-strong)]"
                      onConfirm={async () => (setToken((await api<{ token: string }>(`agents/${a.id}/token`, { method: "POST" })).token), onChanged())}
                    />
                  )}
                </div>
              </details>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 [&_button]:whitespace-nowrap">
                {!illustrator ? (
                  <button onClick={() => patch({ illustrator: true })} className="text-[13px] text-ink2 hover:text-accent">
                    Make {a.name} the illustrator
                  </button>
                ) : (
                  <span />
                )}
                {a.id !== "a_claude" && <ConfirmDelete label="Remove agent" confirm="Remove and disconnect" size={15} onConfirm={() => patch({ archived: true })} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// the same list as SECTIONS in core/access.ts, which cannot be imported here: it reaches the database
const SECTIONS: Section[] = ["feed", "todos", "journal", "following", "pages", "links", "rail", "ideas"];
const SECTION_LABEL: Record<Section, string> = { feed: "Feed", todos: "Todos", journal: "Journal", following: "Following", pages: "Pages", links: "Links", rail: "Now", ideas: "Ideas" };
/** Top levels of context that are a part of the app, and so are chosen under "The app", not "Context". */
const APP_OWNED = ["journal", "links"];

/** One thing an agent can be allowed to see: a quiet chip, lit while it is allowed. */
function Allow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="checkbox" aria-checked={on} onClick={() => onChange(!on)} className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${on ? "bg-accent-soft text-accent" : "bg-fill2 text-ink3 hover:text-ink2"}`}>
      {on && <Check size={13} />}
      {label}
    </button>
  );
}

/**
 * What this agent may see and do, whatever app it connects from: whether it only looks, which
 * parts of the app it sees, and which top-level sections of context. Each change is saved as it
 * is made. An agent left with everything on and able to write has no limits at all.
 */
function Access({ agent: a, onChanged }: { agent: Agent; onChanged: () => void }) {
  const { data } = useSWR<{ children: { path: string; title: string }[] }>("context", fetcher);
  const tops = (data?.children ?? []).filter((c) => !APP_OWNED.includes(c.path));
  const rules = a.access ?? null;
  const [error, setError] = useState("");
  const readOnly = !!rules?.read_only;
  const sections: Section[] = rules?.sections ?? [...SECTIONS];
  const context: string[] = rules?.context ?? tops.map((t) => t.path);

  async function save(next: { read_only: boolean; sections: Section[]; context: string[] }) {
    setError("");
    const everything = !next.read_only && next.sections.length === SECTIONS.length && tops.every((t) => next.context.includes(t.path));
    // limits name what is allowed, so a section of context added later starts out hidden from a limited agent
    const access: AccessRules | null = everything ? null : { read_only: next.read_only, sections: next.sections, context: next.context };
    try {
      await api(`agents/${a.id}`, { method: "PATCH", body: { access } });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const flip = <T,>(list: T[], item: T, on: boolean) => (on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item));

  return (
    <div data-access>
      <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Access</div>
      <div className="space-y-3 rounded-[14px] bg-fill px-3 py-3">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-ink2">
            <span className="font-medium text-ink">Read only.</span> {a.name} can look, but never post, add or change anything, from any app it connects with.
          </p>
          <Switch on={readOnly} label="Read only" onChange={(v) => save({ read_only: v, sections, context })} />
        </div>
        <div>
          <div className="mb-1.5 text-[12.5px] text-ink3">The app</div>
          <div role="group" aria-label="Parts of the app it can see" className="flex flex-wrap gap-1.5">
            {SECTIONS.map((k) => (
              <Allow key={k} label={SECTION_LABEL[k]} on={sections.includes(k)} onChange={(v) => save({ read_only: readOnly, sections: flip(sections, k, v), context })} />
            ))}
          </div>
        </div>
        {tops.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12.5px] text-ink3">Context</div>
            <div role="group" aria-label="Sections of context it can see" className="flex flex-wrap gap-1.5">
              {tops.map((t) => (
                <Allow key={t.path} label={t.title} on={context.includes(t.path)} onChange={(v) => save({ read_only: readOnly, sections, context: flip(context, t.path, v) })} />
              ))}
            </div>
          </div>
        )}
        <p className="text-[12.5px] leading-relaxed text-ink3">
          {rules ? `What is off does not exist for ${a.name}: it is absent from its map, its searches and what it is told has changed.` : `${a.name} sees and can change everything, as agents do unless you limit them here.`}
        </p>
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
      </div>
    </div>
  );
}

/**
 * What the owner has answered this agent from the rail, newest first: the button they tapped, on
 * which module, and whether the agent has picked it up. It is a record, not a control: nothing
 * here can be tapped.
 */
function Sent({ name, sent }: { name: string; sent: SentAnswer[] }) {
  return (
    <div data-sent>
      <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Your answers</div>
      <ul className="divide-y divide-[var(--line)] rounded-[14px] bg-fill">
        {sent.slice(0, 6).map((x) => (
          <li key={x.id} className="px-3 py-2">
            <div className="text-[13.5px] [overflow-wrap:anywhere]">
              <span className="font-medium">“{x.label}”</span> <span className="text-ink2">on {x.title}</span>
            </div>
            <div className="text-[12.5px] text-ink3">
              {ago(x.at)}
              {ago(x.at) === "now" ? "" : " ago"} · {x.picked_up ? `${name} has picked it up` : `waiting for ${name}`}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** When a routine next comes due, or how its last round went, in a few words. */
function routineLine(r: Routine, mine: boolean, doer?: Agent) {
  const every = r.every === "weekly" ? "Weekly" : "Daily";
  if (!r.agent_id) return `${every}. Nobody does this yet.`;
  if (!mine) return `${every}. Done by ${doer?.name ?? "another agent"}.`;
  const next = r.next_at ? new Date(r.next_at) : null;
  const when = next ? (next.getTime() <= Date.now() + 60_000 ? "due now" : `next ${next.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`) : "";
  return [every, when].filter(Boolean).join(" · ");
}

/**
 * The duties that come round on a schedule, and whether this agent does each. A routine has one
 * agent: turning it on here takes it from whoever had it. When one is due the agent is pinged
 * with a job, and what it reported last time shows beneath.
 */
function Routines({ agent: a }: { agent: Agent }) {
  const { agent } = useMe();
  const { data, mutate } = useSWR<{ routines: Routine[] }>("routines", fetcher, { refreshInterval: 60_000 });
  const [error, setError] = useState("");
  const list = data?.routines ?? [];
  if (!list.length) return null;
  const readOnly = !!a.access?.read_only;
  async function give(key: string, on: boolean) {
    setError("");
    try {
      await api(`routines/${key}`, { method: "PATCH", body: { agent: on ? a.id : null } });
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div data-routines>
      <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Routines</div>
      <ul className="divide-y divide-[var(--line)] rounded-[14px] bg-fill">
        {list.map((r) => {
          const mine = r.agent_id === a.id;
          return (
            <li key={r.key} data-routine={r.key} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{r.title}</div>
                <p className="text-[13px] leading-snug text-ink2">{r.about}</p>
                <p className="mt-0.5 text-[12.5px] text-ink3">{routineLine(r, mine, agent(r.agent_id))}</p>
                {mine && r.last_note && r.last_done_at && (
                  <p className="mt-0.5 text-[12.5px] leading-snug text-ink3 [overflow-wrap:anywhere]">
                    Last time, {ago(r.last_done_at)}{ago(r.last_done_at) === "now" ? "" : " ago"}: {r.last_note}
                  </p>
                )}
              </div>
              {!readOnly && <Switch on={mine} label={`${a.name} does the ${r.title.toLowerCase()}`} onChange={(v) => give(r.key, v)} />}
            </li>
          );
        })}
      </ul>
      {readOnly && <p className="mt-1.5 text-[12.5px] text-ink3">A read-only agent cannot do routines.</p>}
      {error && <p className="mt-1.5 text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

function GuestRow({ guest: g, index, open, onToggle, onChanged }: { guest: Agent; index: number; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const [pass, setPass] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? location.origin : "";
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: index * 0.04 }} className={`glass rounded-[24px] p-3.5 ${open ? "glass-lift" : ""}`}>
      <div className="flex items-center gap-x-3.5 gap-y-2.5 max-sm:flex-wrap">
        <Avatar agent={g} />
        <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-54px)]">
          <div className="truncate text-[16px] font-semibold">{g.name}</div>
          <p className="truncate text-[14px] text-ink2">Adds tasks for you. Sees only the tasks marked From {g.name}.</p>
        </div>
        <div className="flex flex-none items-center gap-2 max-sm:w-full max-sm:justify-end">
          <span className="text-[12.5px] text-ink3 max-sm:hidden">{g.last_seen_at ? `Active ${ago(g.last_seen_at)}` : ""}</span>
          <button onClick={onToggle} aria-expanded={open} className={`h-8 rounded-full px-3.5 text-[13px] font-medium transition-all active:scale-95 ${open ? "bg-ink text-bg" : g.has_passcode ? "bg-fill text-ink2 hover:bg-fill2" : "bg-accent text-white"}`}>
            {open ? "Done" : "Connect"}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <div className="mt-3.5 space-y-3.5 border-t hairline pt-3.5">
              <p className="text-[13.5px] leading-relaxed text-ink2">
                Send {g.name} two things: this address, to add as a custom connector (MCP server) in their own agents, and the passcode. When an agent connects, a Subspace page asks {g.name} for the passcode. Through this address an agent can add tasks for you and see, edit and delete the tasks marked From {g.name}, with their notes, status and day. It cannot reach anything else.
              </p>
              <CopyField label={`${g.name}'s connector address`} value={`${origin}/api/mcp/guest/${g.handle}`} />
              <div>
                {pass ? (
                  <>
                    <CopyField label="Passcode (shown once)" value={pass} />
                    <p className="mt-1.5 text-[12.5px] text-ink3">Give it to {g.name} privately. It is asked for each time one of their agents connects.</p>
                  </>
                ) : (
                  <div className="flex items-center gap-2 rounded-[14px] bg-fill py-1.5 pl-3 pr-1.5">
                    <span className="min-w-0 flex-1 text-[13px] text-ink2">{g.has_passcode ? "A passcode is set. It cannot be shown again." : "No passcode yet. Nothing can connect until there is one."}</span>
                    {g.has_passcode ? (
                      <Confirm label="New passcode" sure="Replace the passcode?" className="bg-fill2 text-ink hover:bg-[var(--fill-strong)]" onConfirm={async () => (setPass((await api<{ passcode: string }>(`guests/${g.id}/passcode`, { method: "POST" })).passcode), onChanged())} />
                    ) : (
                      <button onClick={async () => (setPass((await api<{ passcode: string }>(`guests/${g.id}/passcode`, { method: "POST" })).passcode), onChanged())} className="h-8 rounded-full bg-accent px-3.5 text-[13px] font-medium text-white">
                        Make a passcode
                      </button>
                    )}
                  </div>
                )}
              </div>
              <Connections id={g.id} empty={`None of ${g.name}'s agents has signed in yet.`} />
              <div className="flex justify-end pt-1">
                <ConfirmDelete label={`Remove ${g.name}`} confirm="Remove and disconnect" size={15} onConfirm={async () => (await api(`guests/${g.id}`, { method: "DELETE" }), onChanged())} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** A private conversation with one agent: ask it for something that belongs to nothing else in the app. */
function Messages({ agent: a }: { agent: Agent }) {
  const { agents, me, direct, refresh } = useMe();
  const { markRead } = useDirectUnread();
  const { data, mutate } = useSWR<{ messages: Post[] }>(`agents/${a.id}/messages`, fetcher, { refreshInterval: 5_000 });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const handles = agents.map((x) => x.handle);
  const messages = data?.messages ?? [];
  const lastId = messages[messages.length - 1]?.id;

  // Keep the newest message in view, and count the conversation as read while it is open.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (lastId) refresh();
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps
  const moved = direct[a.id];
  useEffect(() => {
    if (moved) markRead(a.id, moved);
  }, [moved, a.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    setText("");
    try {
      const sent = await api<Post>(`agents/${a.id}/messages`, { body: { body } });
      await mutate((cur) => ({ messages: [...(cur?.messages ?? []).filter((m) => m.id !== sent.id), sent] }), { revalidate: true });
    } catch (e) {
      setText(body);
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="mt-3.5 border-t hairline pt-3.5">
      {messages.length > 0 ? (
        <div ref={list} data-messages className="scroll -mr-2 flex max-h-[380px] flex-col gap-1.5 overflow-y-auto pb-1 pr-2">
          {messages.map((m, i) => {
            const mine = m.author === me?.id;
            const prev = messages[i - 1];
            // A new request starts a new conversation; show when, as a quiet divider.
            const gap = !prev || (!m.parent_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 3_600_000);
            return (
              <div key={m.id} className="flex flex-col">
                {gap && <div className="py-1.5 text-center text-[12px] text-ink3">{ago(m.created_at) === "now" ? "Now" : /^\d+[mhd]$/.test(ago(m.created_at)) ? `${ago(m.created_at)} ago` : ago(m.created_at)}</div>}
                <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-[15px] leading-[1.42] ${mine ? "self-end bg-accent-soft" : "self-start bg-fill"}`}>
                  <Rich text={m.body} handles={handles} />
                  {m.page && <PageCard page={m.page} />}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        data && <p className="pb-1 text-[13.5px] leading-relaxed text-ink2">Ask {a.name} for something directly. Its answer appears here, not in the feed.</p>
      )}
      <form onSubmit={(e) => (e.preventDefault(), send())} className="mt-2.5 flex gap-2 rounded-[20px] bg-fill py-1.5 pl-3.5 pr-1.5">
        <MentionInput value={text} onChange={setText} onSubmit={send} placeholder={`Message ${a.name}`} className="py-[5px] text-[15px]" />
        <SendButton show={!!text.trim()} busy={busy} />
      </form>
      {error && <p className="mt-1.5 text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

type Options = { models: { id: string; name: string; note: string }[]; efforts: string[]; contexts: number[]; env_key: boolean };
const EFFORT_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra", max: "Max" };
const contextLabel = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1000}K`);

function Segmented<T extends string | number>({ label, value, options, onChange, hint }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: string }) {
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">{label}</span>
        {hint && <span className="truncate text-[12.5px] text-ink3">{hint}</span>}
      </div>
      <div role="radiogroup" aria-label={label} className="flex rounded-[14px] bg-fill p-1">
        {options.map((o) => (
          <button key={String(o.value)} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)} className={`relative h-8 min-w-0 flex-1 rounded-[10px] px-1 text-[13px] font-medium transition-colors ${o.value === value ? "text-ink" : "text-ink2 hover:text-ink"}`}>
            {o.value === value && <motion.span layoutId={id} transition={spring} className="pill absolute inset-0 rounded-[10px]" />}
            <span className="relative block truncate">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-[26px] w-[44px] flex-none rounded-full transition-colors duration-300 ${on ? "bg-accent" : "bg-fill2"}`}>
      <motion.span layout transition={spring} className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] ${on ? "right-[3px]" : "left-[3px]"}`} />
    </button>
  );
}

function Realtime({ agent: a, onChanged }: { agent: Agent; onChanged: () => void }) {
  const { data: opt } = useSWR<Options>("runtime/options", fetcher);
  const rt = a.runtime ?? { enabled: false, model: "claude-opus-5-5", effort: "medium", context: 200_000, web: true, key_hint: null, last_run: null };
  const [key, setKey] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [error, setError] = useState("");
  const hasKey = !!rt.key_hint || !!opt?.env_key;

  async function save(body: Record<string, unknown>) {
    setError("");
    try {
      await api(`agents/${a.id}/runtime`, { method: "PATCH", body });
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  const run = rt.last_run;
  const model = opt?.models.find((m) => m.id === rt.model);

  return (
    <div className="mt-3.5 space-y-4 border-t hairline pt-3.5">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-ink2">
          Run {a.name} inside Subspace on your Anthropic API key, so it answers within moments of being mentioned. Usage is billed to that key.
        </p>
        <Switch on={rt.enabled} label="Realtime" onChange={(v) => save({ enabled: v })} />
      </div>

      <div>
        <div className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">API key</div>
        {rt.key_hint && !editingKey ? (
          <div className="flex items-center gap-2 rounded-[14px] bg-fill py-1.5 pl-3 pr-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">sk-ant-{rt.key_hint}</code>
            <button onClick={() => setEditingKey(true)} className="h-7 rounded-full px-3 text-[13px] text-ink2 hover:bg-fill2">
              Replace
            </button>
            <button onClick={() => save({ api_key: "" })} className="h-7 rounded-full px-3 text-[13px] text-ink3 hover:bg-fill2 hover:text-danger">
              Remove
            </button>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await save({ api_key: key, ...(rt.key_hint ? {} : { enabled: true }) })) (setKey(""), setEditingKey(false));
            }}
            className="flex items-center gap-2 rounded-[14px] bg-fill py-1.5 pl-3 pr-1.5"
          >
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={opt?.env_key ? "Using the key set on the server. Paste one to override." : "sk-ant-…"} aria-label="Anthropic API key" className="min-w-0 flex-1 font-mono text-[12.5px]" />
            {editingKey && (
              <button type="button" onClick={() => (setEditingKey(false), setKey(""))} className="h-7 rounded-full px-3 text-[13px] text-ink3 hover:bg-fill2">
                Cancel
              </button>
            )}
            <button disabled={!key.trim()} className="h-7 rounded-full bg-ink px-3 text-[13px] font-medium text-bg transition-all active:scale-95 disabled:opacity-30">
              Save
            </button>
          </form>
        )}
        <p className="mt-1.5 text-[12.5px] text-ink3">{error ? <span className="text-danger">{error}</span> : "Stored encrypted. It is never shown again or sent anywhere except Anthropic."}</p>
      </div>

      <motion.div animate={{ opacity: hasKey ? 1 : 0.45 }} className={`space-y-4 ${hasKey ? "" : "pointer-events-none"}`}>
        <Segmented label="Model" hint={model?.note} value={rt.model} onChange={(v) => save({ model: v })} options={(opt?.models ?? []).map((m) => ({ value: m.id, label: m.name }))} />
        <Segmented label="Effort" hint="Higher thinks longer and costs more" value={rt.effort} onChange={(v) => save({ effort: v })} options={(opt?.efforts ?? []).map((e) => ({ value: e, label: EFFORT_LABEL[e] ?? e }))} />
        <Segmented label="Context window" hint="How much one run may hold" value={rt.context} onChange={(v) => save({ context: v })} options={(opt?.contexts ?? []).map((c) => ({ value: c, label: contextLabel(c) }))} />
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">Web access</div>
            <div className="text-[12.5px] text-ink3">Let it search and read the web while it works.</div>
          </div>
          <Switch on={rt.web} label="Web access" onChange={(v) => save({ web: v })} />
        </div>
      </motion.div>

      {run && (
        <p className={`rounded-[14px] px-3 py-2 text-[12.5px] ${run.status === "ok" ? "bg-fill text-ink2" : "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger"}`}>
          {run.status === "ok" ? (ago(run.at) === "now" ? "Last ran just now" : `Last ran ${ago(run.at)} ago`) : (run.detail ?? "The last run failed.")}
          {run.status === "ok" && ` · ${run.steps} ${run.steps === 1 ? "step" : "steps"} · ${Math.round(((run.input_tokens ?? 0) + (run.output_tokens ?? 0)) / 1000)}K tokens`}
          {run.status !== "ok" && ` · ${ago(run.at)}`}
        </p>
      )}
    </div>
  );
}

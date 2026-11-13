"use client";
import { Check, Copy, LogOut, Plus, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Avatar, PageHeader } from "@/components/bits";
import { ago, api, soft, spring, useMe } from "@/lib/client";
import type { Agent } from "@/lib/core/util";

export default function AgentsPage() {
  const { agents, refresh } = useMe();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const a = await api<Agent>("agents", { body: { name } });
      const { token } = await api<{ token: string }>(`agents/${a.id}/token`, { method: "POST" });
      setFresh({ id: a.id, token });
      setName("");
      setAdding(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
          <AgentRow key={a.id} agent={a} index={i} token={fresh?.id === a.id ? fresh.token : null} onToken={(token) => setFresh(token ? { id: a.id, token } : null)} onChanged={refresh} />
        ))}
        <AnimatePresence mode="wait" initial={false}>
          {adding ? (
            <motion.form key="f" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={soft} onSubmit={add} className="glass glass-lift flex items-center gap-3 rounded-[24px] p-3.5">
              <div className="grid h-10 w-10 flex-none place-items-center rounded-full bg-fill text-ink3">
                <Plus size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} placeholder="Agent name, e.g. Scout" aria-label="Agent name" className="w-full text-[16px] font-semibold" />
                <p className="text-[13px] text-ink3">{error ? <span className="text-danger">{error}</span> : name.trim() ? `@${name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24)}` : "Its @handle comes from the name."}</p>
              </div>
              <button disabled={!name.trim()} className="h-9 rounded-full bg-ink px-4 text-[14px] font-medium text-bg transition-all active:scale-95 disabled:opacity-30">
                Add
              </button>
            </motion.form>
          ) : (
            <motion.button key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} whileTap={{ scale: 0.985 }} onClick={() => setAdding(true)} className="flex h-[68px] items-center justify-center gap-2 rounded-[24px] border border-dashed border-[var(--fill-strong)] text-[14.5px] text-ink2 transition-colors hover:border-accent hover:text-accent">
              <Plus size={17} /> Add an agent
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <p className="mx-auto mt-8 max-w-[520px] text-center text-[13px] leading-relaxed text-ink3">
        Each agent connects over MCP with its own private address. On connecting it receives the current instructions for posting, illustrating and keeping your context, so every agent follows the same rules.
      </p>
    </div>
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

function AgentRow({ agent: a, index, token, onToken, onChanged }: { agent: Agent; index: number; token: string | null; onToken: (t: string | null) => void; onChanged: () => void }) {
  const [bio, setBio] = useState(a.bio);
  const [confirm, setConfirm] = useState(false);
  const human = a.kind === "human";
  const illustrator = a.roles.includes("illustrator");
  const origin = typeof window !== "undefined" ? location.origin : "";
  const patch = async (body: Record<string, unknown>) => (await api(`agents/${a.id}`, { method: "PATCH", body }), onChanged());

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: index * 0.04 }} className={`glass rounded-[24px] p-3.5 ${token ? "glass-lift" : ""}`}>
      <div className="flex items-center gap-3.5">
        <Avatar agent={a} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[16px] font-semibold">{a.name}</span>
            <span className="text-[13.5px] text-ink3">@{a.handle}</span>
            {illustrator && (
              <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
                <Wand2 size={11} /> Illustrator
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
          <div className="flex flex-none items-center gap-2">
            <span className="text-[12.5px] text-ink3 max-sm:hidden">{a.last_seen_at ? `Active ${ago(a.last_seen_at)}` : a.has_token ? "Not seen yet" : ""}</span>
            <button
              onClick={async () => {
                if (a.has_token && !confirm) return setConfirm(true), void setTimeout(() => setConfirm(false), 3000);
                setConfirm(false);
                onToken((await api<{ token: string }>(`agents/${a.id}/token`, { method: "POST" })).token);
                onChanged();
              }}
              className={`h-8 rounded-full px-3.5 text-[13px] font-medium transition-all active:scale-95 ${confirm ? "bg-danger text-white" : a.has_token ? "bg-fill text-ink2 hover:bg-fill2" : "bg-accent text-white"}`}
            >
              {confirm ? "Replace address?" : a.has_token ? "New address" : "Connect"}
            </button>
          </div>
        )}
      </div>
      <AnimatePresence initial={false}>
        {token && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <div className="mt-3.5 space-y-3 border-t hairline pt-3.5">
              <p className="text-[13.5px] leading-relaxed text-ink2">
                Add this as a custom connector (MCP server) in {a.name}. It is shown once and works like a password, so keep it private. In Claude: Settings → Connectors → Add custom connector.
              </p>
              <CopyField label="Connector address" value={`${origin}/api/mcp/${token}`} />
              <CopyField label="Or, for clients that send a header" value={`${origin}/api/mcp  ·  Authorization: Bearer ${token}`} />
              <div className="flex items-center justify-between pt-1">
                {!illustrator ? (
                  <button onClick={() => patch({ illustrator: true })} className="text-[13px] text-ink2 hover:text-accent">
                    Make {a.name} the illustrator
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  {a.id !== "a_claude" && (
                    <button onClick={() => (onToken(null), patch({ archived: true }))} className="h-8 rounded-full px-3 text-[13px] text-ink3 hover:bg-fill hover:text-danger">
                      Remove agent
                    </button>
                  )}
                  <button onClick={() => onToken(null)} className="h-8 rounded-full bg-ink px-3.5 text-[13px] font-medium text-bg">
                    Done
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

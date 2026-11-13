"use client";
import { Check, Copy, LogOut, Plus, Wand2, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import useSWR from "swr";
import { Avatar, PageHeader } from "@/components/bits";
import { ago, api, fetcher, soft, spring, useMe } from "@/lib/client";
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
  const [realtime, setRealtime] = useState(false);
  const live = !!a.runtime?.enabled;
  const human = a.kind === "human";
  const illustrator = a.roles.includes("illustrator");
  const origin = typeof window !== "undefined" ? location.origin : "";
  const patch = async (body: Record<string, unknown>) => (await api(`agents/${a.id}`, { method: "PATCH", body }), onChanged());

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: index * 0.04 }} className={`glass rounded-[24px] p-3.5 ${token || realtime ? "glass-lift" : ""}`}>
      <div className="flex items-center gap-3.5">
        <Avatar agent={a} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
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
          </div>
          {human ? (
            <p className="text-[14px] text-ink2">You</p>
          ) : (
            <input value={bio} aria-label="What this agent does" onChange={(e) => setBio(e.target.value)} onBlur={() => bio !== a.bio && patch({ bio })} placeholder="What does this agent do?" className="w-full truncate text-[14px] text-ink2 focus:text-ink" />
          )}
        </div>
        {!human && (
          <div className="flex flex-none items-center gap-2">
            <button onClick={() => setRealtime(!realtime)} aria-expanded={realtime} aria-label="Realtime settings" title="Realtime settings" className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${realtime || live ? "bg-accent-soft text-accent" : "bg-fill text-ink2 hover:bg-fill2"}`}>
              <Zap size={15} />
            </button>
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
        {realtime && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <Realtime agent={a} onChanged={onChanged} />
          </motion.div>
        )}
      </AnimatePresence>
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

type Options = { models: { id: string; name: string; note: string }[]; efforts: string[]; contexts: number[]; env_key: boolean };
const EFFORT_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
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

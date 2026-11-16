/**
 * The built-in runtime: an agent that runs inside Subspace on an Anthropic API key, so it answers
 * within moments of being mentioned instead of waiting for an outside client to check in.
 *
 * A run is one short-lived conversation. Nothing is remembered between runs except what the agent
 * writes into Subspace, which is the point: the system is the memory.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { q, q1 } from "../db";
import { CORE } from "../mcp/guide";
import { TOOLS } from "../mcp/tools";
import { finishRun, logged, refused, startRun, type CallCtx } from "./audit";
import { briefing, changes } from "./discover";
import { sharingInstructions } from "./guests";
import { agentById, ApiError, bad, notFound, type Agent } from "./util";

export const MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5", note: "Strong all-rounder" },
  { id: "claude-fable-5-2", name: "Fable 5.2", note: "Most capable" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", note: "Fast" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5", note: "Fastest, lowest cost" },
] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const CONTEXTS = [200_000, 500_000, 1_000_000] as const;

type Stored = {
  enabled: boolean;
  model: string;
  effort: (typeof EFFORTS)[number];
  context: number;
  web: boolean;
  key_enc?: string;
  key_hint?: string | null;
  last_run?: unknown;
};

const DEFAULTS: Stored = { enabled: false, model: "claude-opus-5-5", effort: "medium", context: 200_000, web: true, key_hint: null };

// ---------- Key storage ----------

function cipherKey(): Buffer {
  const secret = process.env.SUBSPACE_SECRET || process.env.SUBSPACE_PASSWORD || "subspace";
  return createHash("sha256").update("subspace-agent-key:" + secret).digest();
}

function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

function unseal(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
    const d = createDecipheriv("aes-256-gcm", cipherKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null; // sealed under a different secret (the sign-in password changed)
  }
}

/**
 * A key for small pieces of the app's own work (sorting a journal entry into themes): the server's
 * own key, or failing that one the owner saved for a built-in agent. Null when there is none.
 */
export async function appApiKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const rows = await q<{ runtime: Partial<Stored> | null }>("SELECT runtime FROM agents WHERE NOT archived AND runtime->>'key_enc' IS NOT NULL ORDER BY (runtime->>'enabled')::boolean DESC NULLS LAST, id");
  for (const r of rows) {
    const key = r.runtime?.key_enc ? unseal(r.runtime.key_enc) : null;
    if (key) return key;
  }
  return null;
}

async function load(agentId: string): Promise<Stored> {
  const r = await q1<{ runtime: Partial<Stored> | null }>("SELECT runtime FROM agents WHERE id = $1", [agentId]);
  return { ...DEFAULTS, ...(r?.runtime ?? {}) };
}

export async function configureRuntime(
  agentId: string,
  patch: { enabled?: boolean; model?: string; effort?: string; context?: number; web?: boolean; api_key?: string },
) {
  const a = await agentById(agentId);
  if (!a || a.kind !== "agent") throw notFound("No such agent");
  const cur = await load(agentId);
  if (patch.model !== undefined) {
    if (!MODELS.some((m) => m.id === patch.model)) throw bad("Unknown model.");
    cur.model = patch.model;
  }
  if (patch.effort !== undefined) {
    if (!EFFORTS.includes(patch.effort as Stored["effort"])) throw bad("Unknown effort level.");
    cur.effort = patch.effort as Stored["effort"];
  }
  if (patch.context !== undefined) {
    if (!CONTEXTS.includes(patch.context as (typeof CONTEXTS)[number])) throw bad("Unknown context size.");
    cur.context = patch.context;
  }
  if (patch.web !== undefined) cur.web = !!patch.web;
  if (patch.api_key !== undefined) {
    const key = patch.api_key.trim();
    if (key && !/^sk-ant-[\w-]{20,}$/.test(key)) throw bad("That does not look like an Anthropic API key. It should start with sk-ant-.");
    if (key) {
      cur.key_enc = seal(key);
      cur.key_hint = "…" + key.slice(-4);
      cur.last_run = null;
    } else {
      delete cur.key_enc;
      cur.key_hint = null;
      cur.enabled = false;
    }
  }
  if (patch.enabled !== undefined) {
    if (patch.enabled && !cur.key_enc && !process.env.ANTHROPIC_API_KEY) throw bad("Add an API key first.");
    cur.enabled = patch.enabled;
  }
  await q("UPDATE agents SET runtime = $2 WHERE id = $1", [agentId, JSON.stringify(cur)]);
  return (await agentById(agentId))!;
}

// ---------- Running ----------

const SOFT_DEADLINE_MS = 240_000;
const MAX_STEPS = 30;



const RUN_RULES = `HOW YOU ARE RUNNING
You run inside Subspace as a background job that was started because something needs you. Nobody reads the text you write in this conversation; the only things that reach the owner or other agents are the tools you call. So act through tools, and end the run by simply stopping.

Each run starts fresh. Anything worth keeping between runs must be written into Subspace (a reply, a todo note, a context node).

In a run:
1. The first message already contains your briefing and the changes waiting for you. Do not call briefing or changes again at the start.
2. Handle every item addressed to you: answer mentions in their thread, do the work you were asked for and write the result where it was asked (todo notes for a todo, the thread for a post). A reply in a thread you are part of is addressed to you even when it does not name you. When the item lists agents_in_thread and the owner named nobody, call claim on it first and act only if it is yours.
3. If you are the illustrator, draw every open job. Read guide("illustration") or guide("icons") once before your first drawing in a run. When you post yourself, include art.svg in the post instead of art.prompt.
4. Before stopping, call changes once more. If something new is addressed to you, handle it too.

When the work is finding, comparing, researching or planning, present the result as a page with blocks, not as plain paragraphs: read guide("pages") once, then write it into the notes of the todo or make a page and link it from your reply. When you come across something time-bound the owner will need today or soon (a booking, a delivery, a deadline), put it in the rail with rail_set.

Be decisive. If a request is clear enough to act on, act; ask a question only when a wrong guess would waste the owner's time. Do real work rather than describing what you could do. When you use the web, cite the specific places you relied on.`;

function toolList(model: string, web: boolean): Anthropic.Beta.BetaToolUnion[] {
  const tools: Anthropic.Beta.BetaToolUnion[] = TOOLS.filter((t) => t.name !== "briefing").map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    eager_input_streaming: true,
  }));
  if (web) {
    // The newer web tools filter results themselves; Haiku 5.5 takes the basic search tool.
    if (model === "claude-haiku-5-5") tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 6 });
    else tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 8 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 });
  }
  return tools;
}

/** With eager input streaming the API no longer validates tool input, so check it before running. */
function checkInput(name: string, input: unknown): string | null {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return `Unknown tool ${name}.`;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Tool input was not a JSON object.";
  const missing = (tool.inputSchema.required ?? []).filter((k) => (input as Record<string, unknown>)[k] === undefined);
  return missing.length ? `Missing required field: ${missing.join(", ")}.` : null;
}

type RunResult = { status: "ok" | "error" | "refused" | "limit"; detail?: string; steps: number; input_tokens: number; output_tokens: number; model: string };

async function converse(agent: Agent, cfg: Stored, apiKey: string, reason: string, deadline: number, run: { id: string; said: string[] }): Promise<RunResult> {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const out: RunResult = { status: "ok", steps: 0, input_tokens: 0, output_tokens: 0, model: cfg.model };

  // What the run is handed at the start is recorded like any call, so the record shows what it was shown.
  const ctx = (name: string): CallCtx => ({ via: "runtime", runId: run.id, client: "subspace", readOnly: !!TOOLS.find((t) => t.name === name)?.readOnly });
  const brief = await logged(agent, "briefing", { by: "run start" }, ctx("briefing"), () => briefing(agent));
  const waiting = await logged(agent, "changes", { limit: 60, by: "run start" }, ctx("changes"), () => changes(agent, { limit: 60 }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `You were woken because: ${reason}\n\nBriefing:\n${JSON.stringify(brief)}\n\nChanges waiting for you (your cursor has moved past these):\n${JSON.stringify(waiting)}`,
    },
  ];
  const tools = toolList(cfg.model, cfg.web);
  // A declined request is re-run on a fallback model in the same call. Haiku has no server-side fallback.
  const fallback = cfg.model !== "claude-haiku-5-5";
  let jsonRetries = 0;

  const sharing = await sharingInstructions();
  while (out.steps < MAX_STEPS) {
    if (Date.now() > deadline) return { ...out, status: "limit", detail: "Ran out of time; it will pick up the rest on the next wake." };
    out.steps++;

    const stream = client.beta.messages.stream({
      model: cfg.model,
      max_tokens: 32_000,
      system: [{ type: "text", text: `You are @${agent.handle} (${agent.name}).\n\n${CORE}${sharing ? `\n\n${sharing}` : ""}\n\n${RUN_RULES}`, cache_control: { type: "ephemeral" } }],
      output_config: { effort: cfg.effort },
      tools,
      messages,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Only an unparseable tool input is retried here; API errors go to the caller.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }

    const u = message.usage;
    const prompt = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    out.input_tokens += prompt;
    out.output_tokens += u.output_tokens;
    out.model = message.model;
    // the model's own words in this step: nobody is shown them, but they explain what it did
    for (const b of message.content) if (b.type === "text" && b.text.trim()) run.said.push(b.text.trim());

    if (message.stop_reason === "refusal") return { ...out, status: "refused", detail: "The model declined this request." };
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!calls.length) return out;
    if (message.stop_reason === "max_tokens") return { ...out, status: "error", detail: "A reply was cut off before it finished." };

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const problem = checkInput(call.name, call.input);
      if (problem) {
        await refused(agent, call.name, call.input, ctx(call.name), problem);
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: problem });
        continue;
      }
      try {
        const value = await logged(agent, call.name, call.input, ctx(call.name), () => TOOLS.find((t) => t.name === call.name)!.run(agent, call.input as Record<string, unknown>));
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(value) });
      } catch (e) {
        if (!(e instanceof ApiError)) console.error("runtime tool error", call.name, e);
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: e instanceof Error ? e.message : "Tool failed." });
      }
    }
    messages.push({ role: "user", content: results });

    // The chosen context size is a ceiling on how much one run may carry.
    if (prompt > cfg.context * 0.9) return { ...out, status: "limit", detail: "Reached the context limit for one run; it will continue on the next wake." };
  }
  return { ...out, status: "limit", detail: "Reached the step limit for one run." };
}

function explain(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check it and save it again.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key is not allowed to use the selected model.";
  if (err instanceof Anthropic.NotFoundError) return "The selected model is not available to this API key.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic. It will try again on the next wake.";
  if (err instanceof Anthropic.BadRequestError) return `Anthropic rejected the request: ${err.message}`.slice(0, 300);
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach Anthropic.";
  if (err instanceof Anthropic.APIError) return `Anthropic error ${err.status ?? ""}. It will try again on the next wake.`;
  return err instanceof Error ? err.message.slice(0, 300) : "Something went wrong.";
}

const lockKey = (h: string) => `run:${h}`;
const pendingKey = (h: string) => `runpending:${h}`;
const LOCK_STALE_MS = 6 * 60_000;

/** Which of these handles run inside Subspace. */
export async function builtInHandles(handles: string[]): Promise<string[]> {
  if (!handles.length) return [];
  const rows = await q<{ handle: string }>("SELECT handle FROM agents WHERE handle = ANY($1) AND NOT archived AND runtime->>'enabled' = 'true'", [handles]);
  return rows.map((r) => r.handle);
}

/**
 * Runs the agent now, unless it is already running, in which case the running job is told to take
 * one more look before it stops. Safe to call for every event.
 */
export async function runBuiltIn(handle: string, reason: string, startedAt = Date.now()): Promise<void> {
  const agent = await q1<{ id: string }>("SELECT id FROM agents WHERE handle = $1 AND NOT archived", [handle]);
  if (!agent) return;
  const cfg = await load(agent.id);
  if (!cfg.enabled) return;

  const now = Date.now();
  const claimed = await q1(
    `INSERT INTO settings (key, value) VALUES ($1, to_jsonb($2::bigint))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE (settings.value #>> '{}')::bigint < $3 RETURNING key`,
    [lockKey(handle), now, now - LOCK_STALE_MS],
  );
  if (!claimed) {
    await q("INSERT INTO settings (key, value) VALUES ($1, 'true') ON CONFLICT (key) DO NOTHING", [pendingKey(handle)]);
    return;
  }

  const deadline = startedAt + SOFT_DEADLINE_MS;
  let again = false;
  try {
    do {
      await q("DELETE FROM settings WHERE key = $1", [pendingKey(handle)]);
      const apiKey = (cfg.key_enc && unseal(cfg.key_enc)) || process.env.ANTHROPIC_API_KEY;
      let result: RunResult;
      const me = (await agentById(agent.id))!;
      const run = { id: await startRun(me, reason, cfg), said: [] as string[] };
      if (!apiKey) result = { status: "error", detail: "The saved API key can no longer be read (the sign-in password changed). Save the key again.", steps: 0, input_tokens: 0, output_tokens: 0, model: cfg.model };
      else {
        try {
          result = await converse(me, cfg, apiKey, reason, deadline, run);
        } catch (err) {
          console.error("runtime run failed", handle, err);
          result = { status: "error", detail: explain(err), steps: 0, input_tokens: 0, output_tokens: 0, model: cfg.model };
        }
      }
      await finishRun(run.id, result, run.said.join("\n\n"));
      await q("UPDATE agents SET runtime = jsonb_set(COALESCE(runtime, '{}'), '{last_run}', $2::jsonb), last_seen_at = now() WHERE id = $1", [
        agent.id,
        JSON.stringify({ at: new Date().toISOString(), ...result }),
      ]);
      // Something arrived while it worked: go round again if there is time and the last run was healthy.
      again = result.status === "ok" && !!(await q1("SELECT 1 FROM settings WHERE key = $1", [pendingKey(handle)])) && Date.now() < deadline - 60_000;
      reason = "more arrived while you were working";
    } while (again);
  } finally {
    await q("DELETE FROM settings WHERE key = $1", [lockKey(handle)]);
  }
}

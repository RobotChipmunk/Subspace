import { q, q1 } from "../db";
import { newId, type Agent } from "./util";

/**
 * The record of what agents do here. `events` already says what changed; this says what was asked:
 * every tool call an agent makes (through MCP or from a run inside Subspace) with its arguments,
 * how it ended, how long it took and what it was shown; and every run or wake-up of an agent with
 * why it started and how it finished.
 *
 * It exists to be read afterwards, by `npm run agent-log` or plain SQL (see README, "What agents
 * did"): to find errors, to see what agents look up and how (paths walked, searches made, searches
 * that found nothing, what they open again and again), and to check what they missed (a mention
 * they were shown and never answered, a part of the workspace nobody reads).
 *
 * Writing the record must never break the work it records, so every write here swallows its own
 * failure.
 */

export type CallCtx = {
  /** How the call arrived: an outside app over MCP, or a run inside Subspace. */
  via: "mcp" | "runtime";
  /** The run it belongs to, for calls made inside Subspace. */
  runId?: string;
  /** The app that made it (the name it signed in with), or "token" for a static token. */
  client?: string;
  grantId?: string;
  /** Whether the tool only reads. */
  readOnly?: boolean;
};

const KEEP_DAYS = 180;
const ID = /\b[a-z]_0[0-9a-z]{11,15}\b/g;
const idsIn = (text: string, max = 300) => [...new Set(text.match(ID) ?? [])].slice(0, max);

/** Arguments as they were sent, with long text cut short (a page body, an uploaded file) so a row stays small. */
function trim(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > 1500 ? `${v.slice(0, 1500)}…(+${v.length - 1500} chars)` : v;
  if (Array.isArray(v)) return depth > 5 ? "[…]" : v.slice(0, 60).map((x) => trim(x, depth + 1));
  if (v && typeof v === "object") return depth > 5 ? "{…}" : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, depth + 1)]));
  return v;
}

/** How many things a result listed, when it is a listing. */
function countOf(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  let n: number | null = null;
  for (const k of ["results", "items", "changes", "children", "todos", "jobs", "links"]) {
    const list = Array.isArray(o[k]) ? (o[k] as unknown[]) : Array.isArray((o[k] as { items?: unknown[] } | undefined)?.items) ? (o[k] as { items: unknown[] }).items : null;
    if (list) n = (n ?? 0) + list.length;
  }
  return n;
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: string };

async function record(agent: Agent, tool: string, args: unknown, ctx: CallCtx, ms: number, out: Outcome) {
  try {
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    const argText = JSON.stringify(args ?? {});
    const resultText = out.ok ? (JSON.stringify(out.value) ?? "") : "";
    await q(
      `INSERT INTO agent_calls (agent_id, via, run_id, client, grant_id, tool, kind, args, ok, error, ms, query, path, refs, seen, result_count, result_chars, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        agent.id, ctx.via, ctx.runId ?? null, ctx.client ?? null, ctx.grantId ?? null, tool, ctx.readOnly ? "read" : "write",
        JSON.stringify(trim(args ?? {})), out.ok, out.ok ? null : out.error.slice(0, 2000), Math.round(ms),
        typeof a.query === "string" ? a.query.slice(0, 500) : null,
        typeof a.path === "string" ? a.path.slice(0, 500) : tool === "explore" ? "/" : null,
        // what the call named (ids and context paths in its arguments), and what it was shown (ids in the result)
        [...idsIn(argText), ...(argText.match(/\/context\/[\w\-/]+/g) ?? [])].slice(0, 100),
        idsIn(resultText),
        out.ok ? countOf(out.value) : null,
        resultText.length,
        resultText.slice(0, 4000),
      ],
    );
    // old rows go, a few at a time, as new ones arrive
    if (Math.random() < 0.01) {
      await q(`DELETE FROM agent_calls WHERE ts < now() - interval '${KEEP_DAYS} days'`);
      await q(`DELETE FROM agent_runs WHERE started_at < now() - interval '${KEEP_DAYS} days'`);
    }
  } catch (e) {
    console.error("audit: could not record a call", tool, (e as Error).message);
  }
}

/** Runs one piece of an agent's work and records it, whichever way it ends. The result or the error passes through untouched. */
export async function logged<T>(agent: Agent, tool: string, args: unknown, ctx: CallCtx, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    const value = await fn();
    await record(agent, tool, args, ctx, performance.now() - t0, { ok: true, value });
    return value;
  } catch (e) {
    await record(agent, tool, args, ctx, performance.now() - t0, { ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Something that was refused before it could run (an unknown tool, input that was not an object). */
export const refused = (agent: Agent, tool: string, args: unknown, ctx: CallCtx, error: string) => record(agent, tool, args, ctx, 0, { ok: false, error });

// ---------- Runs and wake-ups ----------

/** A run inside Subspace begins. Returns its id, which every call it makes carries. */
export async function startRun(agent: Agent, reason: string, cfg: { model: string; effort: string }): Promise<string> {
  const id = newId("r");
  try {
    await q("INSERT INTO agent_runs (id, agent_id, via, reason, model, effort) VALUES ($1,$2,'runtime',$3,$4,$5)", [id, agent.id, reason.slice(0, 600), cfg.model, cfg.effort]);
  } catch (e) {
    console.error("audit: could not record a run", (e as Error).message);
  }
  return id;
}

export async function finishRun(id: string, r: { status: string; detail?: string; steps: number; input_tokens: number; output_tokens: number; model: string }, said: string) {
  try {
    await q(
      `UPDATE agent_runs SET finished_at = now(), status = $2, detail = $3, steps = $4, input_tokens = $5, output_tokens = $6, model = $7, said = $8,
              calls = (SELECT count(*)::int FROM agent_calls WHERE run_id = $1), errors = (SELECT count(*)::int FROM agent_calls WHERE run_id = $1 AND NOT ok)
       WHERE id = $1`,
      [id, r.status, r.detail ?? null, r.steps, r.input_tokens, r.output_tokens, r.model, said.slice(-6000)],
    );
  } catch (e) {
    console.error("audit: could not close a run", (e as Error).message);
  }
}

/** An outside agent was called on its wake hook (or the call failed). What it then does arrives as MCP calls. */
export async function recordWake(handle: string, reason: string, ok: boolean, detail?: string) {
  try {
    const agent = await q1<{ id: string }>("SELECT id FROM agents WHERE handle = $1", [handle]);
    if (!agent) return;
    await q("INSERT INTO agent_runs (id, agent_id, via, reason, status, detail, finished_at) VALUES ($1,$2,'wake',$3,$4,$5, now())", [newId("r"), agent.id, reason.slice(0, 600), ok ? "ok" : "error", detail?.slice(0, 600) ?? null]);
  } catch (e) {
    console.error("audit: could not record a wake", (e as Error).message);
  }
}

import { q, q1 } from "../db";
import { recordWake } from "./audit";

/**
 * Waking agents. An agent that is not always running can be given a wake hook: a URL Subspace
 * calls when something is addressed to it. For Claude this is the API trigger of a Claude Code
 * scheduled task, which starts a session on the owner's subscription.
 *
 * Configure per agent handle with two environment variables, e.g. for @claude:
 *   SUBSPACE_WAKE_CLAUDE_URL    the task's fire URL
 *   SUBSPACE_WAKE_CLAUDE_TOKEN  its bearer token
 */
const MIN_GAP_MS = 125_000; // stays under the limit of 30 fires per hour per task

function hook(handle: string) {
  const key = handle.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const url = process.env[`SUBSPACE_WAKE_${key}_URL`];
  const token = process.env[`SUBSPACE_WAKE_${key}_TOKEN`];
  const ok = url && (/^https:\/\//.test(url) || (process.env.NODE_ENV !== "production" && /^http:\/\/localhost/.test(url)));
  return ok && token ? { url: url!, token } : null;
}

export function wakeConfigured(handle: string) {
  return !!hook(handle);
}

async function fire(handle: string, reason: string) {
  const h = hook(handle);
  if (!h) return;
  // One wake covers everything waiting: the agent reads all of it with changes(). Claim the slot
  // atomically so simultaneous events fire once.
  const now = Date.now();
  const claimed = await q1(
    `INSERT INTO settings (key, value) VALUES ($1, to_jsonb($2::bigint))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE (settings.value #>> '{}')::bigint < $3
     RETURNING key`,
    [`wake:${handle}`, now, now - MIN_GAP_MS],
  );
  if (!claimed) return;
  try {
    const res = await fetch(h.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${h.token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: `Subspace has something for @${handle}: ${reason}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      console.error("wake failed", handle, res.status, body);
      await recordWake(handle, reason, false, `The wake hook answered ${res.status}: ${body}`);
      await q("DELETE FROM settings WHERE key = $1", [`wake:${handle}`]); // let the next event try again
    }
    else await recordWake(handle, reason, true);
  } catch (e) {
    console.error("wake failed", handle, e);
    await recordWake(handle, reason, false, e instanceof Error ? e.message : "The wake hook could not be reached.");
    await q("DELETE FROM settings WHERE key = $1", [`wake:${handle}`]);
  }
}

/**
 * Called for every logged event. Wakes mentioned agents and the assignee of a new job: agents that
 * run inside Subspace start working at once; others are called on their wake hook if they have one.
 */
export function wakeFor(e: { actor: string; type: string; summary: string; mentions?: string[]; data?: Record<string, unknown> }) {
  const mayTarget = (e.mentions?.length ?? 0) > 0 || e.type === "job.created";
  if (!mayTarget) return;
  const startedAt = Date.now();
  const run = async () => {
    const targets = new Set(e.mentions ?? []);
    if (e.type === "job.created" && typeof e.data?.assigned_to === "string") {
      const a = await q1<{ handle: string }>("SELECT handle FROM agents WHERE id = $1", [e.data.assigned_to]);
      if (a) targets.add(a.handle);
    }
    const self = await q1<{ handle: string }>("SELECT handle FROM agents WHERE id = $1", [e.actor]);
    if (self) targets.delete(self.handle);
    if (!targets.size) return;
    const reason = `${e.type} — ${e.summary}`.slice(0, 300);
    const { builtInHandles, runBuiltIn } = await import("./runtime");
    const builtIn = await builtInHandles([...targets]);
    await Promise.all([...targets].map((h) => (builtIn.includes(h) ? runBuiltIn(h, reason, startedAt) : wakeConfigured(h) ? fire(h, reason) : null)));
  };
  // Finish after the response is sent when running inside a request; otherwise run detached.
  import("next/server")
    .then(({ after }) => after(run))
    .catch(() => run().catch((err) => console.error("wake error", err)));
}

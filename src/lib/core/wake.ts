import { q, q1 } from "../db";

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
      console.error("wake failed", handle, res.status, (await res.text()).slice(0, 300));
      await q("DELETE FROM settings WHERE key = $1", [`wake:${handle}`]); // let the next event try again
    }
  } catch (e) {
    console.error("wake failed", handle, e);
    await q("DELETE FROM settings WHERE key = $1", [`wake:${handle}`]);
  }
}

/** Called for every logged event. Wakes mentioned agents and the assignee of a new job. */
export function wakeFor(e: { actor: string; type: string; summary: string; mentions?: string[]; data?: Record<string, unknown> }) {
  const run = async () => {
    const targets = new Set(e.mentions ?? []);
    if (e.type === "job.created" && typeof e.data?.assigned_to === "string") {
      const a = await q1<{ handle: string }>("SELECT handle FROM agents WHERE id = $1", [e.data.assigned_to]);
      if (a) targets.add(a.handle);
    }
    const self = await q1<{ handle: string }>("SELECT handle FROM agents WHERE id = $1", [e.actor]);
    if (self) targets.delete(self.handle);
    await Promise.all([...targets].filter(wakeConfigured).map((h) => fire(h, `${e.type} — ${e.summary}`.slice(0, 300))));
  };
  if (!Object.keys(process.env).some((k) => k.startsWith("SUBSPACE_WAKE_"))) return;
  // Finish after the response is sent when running inside a request; otherwise run detached.
  import("next/server")
    .then(({ after }) => after(run))
    .catch(() => run().catch((err) => console.error("wake error", err)));
}

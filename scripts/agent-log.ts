/**
 * Reads back what agents did (agent_calls, agent_runs; see src/lib/core/audit.ts) and prints a report:
 *
 *   npm run agent-log                      the last 7 days, every agent
 *   npm run agent-log -- --days 30         a longer window
 *   npm run agent-log -- --agent claude    one agent
 *   npm run agent-log -- --errors          every failed call in the window, with its arguments
 *   npm run agent-log -- --run r_0abc…     one run inside Subspace, call by call
 *   npm run agent-log -- --json            the same figures as JSON, for another tool to read
 *
 * It reads only; DATABASE_URL must be exported.
 */
import { q } from "../src/lib/db";

const arg = (name: string) => {
  const i = process.argv.indexOf("--" + name);
  return i < 0 ? undefined : (process.argv[i + 1]?.startsWith("--") ? "" : process.argv[i + 1]) ?? "";
};
const days = Math.max(1, Number(arg("days") ?? 7) || 7);
const handle = arg("agent")?.replace(/^@/, "");
const asJson = arg("json") !== undefined;

const cut = (s: unknown, n = 90) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const out: Record<string, unknown> = {};
function section(title: string, key: string, rows: Record<string, unknown>[], empty = "Nothing.") {
  out[key] = rows;
  if (asJson) return;
  console.log(`\n${title}`);
  if (!rows.length) return console.log(`  ${empty}`);
  const cols = Object.keys(rows[0]);
  const text = rows.map((r) => cols.map((c) => cut(r[c], c === "args" || c === "error" || c === "what" || c === "said" ? 110 : 60)));
  const w = cols.map((c, i) => Math.max(c.length, ...text.map((r) => r[i].length)));
  console.log("  " + cols.map((c, i) => c.padEnd(w[i])).join("  "));
  for (const r of text) console.log("  " + r.map((v, i) => v.padEnd(w[i])).join("  "));
}

/** What an id stands for, in a few words. */
async function names(ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!ids.length) return m;
  for (const r of await q<{ id: string; what: string }>(
    `SELECT id, 'post: ' || left(body, 70) AS what FROM posts WHERE id = ANY($1)
     UNION ALL SELECT id, 'todo: ' || title FROM todos WHERE id = ANY($1)
     UNION ALL SELECT id, kind || ': /context/' || path FROM context_nodes WHERE id = ANY($1)
     UNION ALL SELECT id, 'topic: ' || title FROM trackers WHERE id = ANY($1)
     UNION ALL SELECT id, 'agent: @' || handle FROM agents WHERE id = ANY($1)`,
    [ids],
  ))
    m.set(r.id, r.what);
  return m;
}

async function oneRun(id: string) {
  const run = await q("SELECT r.*, a.handle FROM agent_runs r JOIN agents a ON a.id = r.agent_id WHERE r.id = $1", [id]);
  section(`Run ${id}`, "run", run.map((r: any) => ({ agent: "@" + r.handle, via: r.via, started: r.started_at?.toISOString?.() ?? r.started_at, status: r.status, steps: r.steps, calls: r.calls, errors: r.errors, tokens_in: r.input_tokens, tokens_out: r.output_tokens, model: r.model, reason: r.reason, detail: r.detail ?? "" })), "No such run.");
  const calls = await q("SELECT id, ts, tool, kind, ok, ms, args, error, result_count, result_chars, seen FROM agent_calls WHERE run_id = $1 ORDER BY id", [id]);
  section("Its calls, in order", "calls", calls.map((c: any) => ({ at: new Date(c.ts).toISOString().slice(11, 19), tool: c.tool, ok: c.ok ? "ok" : "FAILED", ms: c.ms, listed: c.result_count ?? "", shown_ids: c.seen.length, args: JSON.stringify(c.args), error: c.error ?? "" })));
  if (!asJson && (run[0] as any)?.said) console.log(`\nWhat the model said to itself\n  ${String((run[0] as any).said).replace(/\n/g, "\n  ")}`);
}

async function main() {
  if (arg("run")) return oneRun(arg("run")!);

  const params: unknown[] = [`${days} days`];
  let who = "";
  if (handle) who = ` AND c.agent_id = (SELECT id FROM agents WHERE handle = $${params.push(handle)})`;
  const W = `c.ts > now() - $1::interval${who}`;
  if (!asJson) console.log(`What agents did in the last ${days} day${days === 1 ? "" : "s"}${handle ? `, @${handle}` : ""}`);

  if (arg("errors") !== undefined) {
    const rows = await q(`SELECT c.ts, a.handle, c.via, c.client, c.tool, c.error, c.args, c.run_id FROM agent_calls c JOIN agents a ON a.id = c.agent_id WHERE ${W} AND NOT c.ok ORDER BY c.id DESC LIMIT 200`, params);
    section("Failed calls, newest first", "errors", rows.map((r: any) => ({ at: new Date(r.ts).toISOString().slice(0, 16), agent: "@" + r.handle, via: r.client ?? r.via, tool: r.tool, error: r.error, args: JSON.stringify(r.args), run: r.run_id ?? "" })), "No failed calls.");
    return;
  }

  section("Per agent and app", "agents", await q(
    `SELECT '@' || a.handle AS agent, coalesce(c.client, c.via) AS app, count(*)::int AS calls, count(*) FILTER (WHERE c.kind = 'read')::int AS reads, count(*) FILTER (WHERE c.kind = 'write')::int AS writes,
            count(*) FILTER (WHERE NOT c.ok)::int AS failed, round(avg(c.ms))::int AS avg_ms, max(c.ms) AS slowest_ms, to_char(max(c.ts), 'YYYY-MM-DD HH24:MI') AS last_call
     FROM agent_calls c JOIN agents a ON a.id = c.agent_id WHERE ${W} GROUP BY 1, 2 ORDER BY calls DESC`, params), "No calls recorded in this window.");

  section("Tools, most used first", "tools", await q(
    `SELECT c.tool, count(*)::int AS calls, count(*) FILTER (WHERE NOT c.ok)::int AS failed, round(avg(c.ms))::int AS avg_ms, round(avg(c.result_chars))::int AS avg_result_chars
     FROM agent_calls c WHERE ${W} GROUP BY 1 ORDER BY calls DESC`, params));

  section("Failures, by tool and message", "failures", await q(
    `SELECT c.tool, count(*)::int AS times, to_char(max(c.ts), 'YYYY-MM-DD HH24:MI') AS last, left(c.error, 160) AS error
     FROM agent_calls c WHERE ${W} AND NOT c.ok GROUP BY c.tool, left(c.error, 160) ORDER BY times DESC, last DESC LIMIT 25`, params), "No failed calls.");

  section("Where they browse (explore paths)", "paths", await q(
    `SELECT c.path, count(*)::int AS times, count(DISTINCT c.agent_id)::int AS agents FROM agent_calls c WHERE ${W} AND c.tool = 'explore' GROUP BY 1 ORDER BY times DESC LIMIT 25`, params));

  section("What they search for", "searches", await q(
    `SELECT lower(c.query) AS query, count(*)::int AS times, round(avg(coalesce(c.result_count, 0)), 1) AS avg_results FROM agent_calls c WHERE ${W} AND c.tool = 'search' AND c.query IS NOT NULL GROUP BY 1 ORDER BY times DESC, query LIMIT 25`, params));

  section("Searches that found nothing", "empty_searches", await q(
    `SELECT to_char(c.ts, 'YYYY-MM-DD HH24:MI') AS at, '@' || a.handle AS agent, c.query, c.args->'types' AS types FROM agent_calls c JOIN agents a ON a.id = c.agent_id
     WHERE ${W} AND c.tool = 'search' AND c.ok AND coalesce(c.result_count, 0) = 0 ORDER BY c.id DESC LIMIT 25`, params), "Every search found something.");

  // what is opened in full, again and again
  const opened = await q<{ id: string; times: number; agents: number }>(
    `SELECT r AS id, count(*)::int AS times, count(DISTINCT c.agent_id)::int AS agents FROM agent_calls c, unnest(c.refs) r WHERE ${W} AND c.tool = 'read' GROUP BY 1 ORDER BY times DESC LIMIT 20`, params);
  const openedNames = await names(opened.map((o) => o.id));
  section("Read in full most often", "opened", opened.map((o) => ({ what: openedNames.get(o.id) ?? o.id, id: o.id, times: o.times, agents: o.agents })));

  // what is shown to agents (in any listing or result) and never opened
  const context = await q<{ id: string; path: string; kind: string; shown: number; opened: number }>(
    `SELECT n.id, n.path, n.kind,
            (SELECT count(*)::int FROM agent_calls c WHERE ${W} AND c.seen @> ARRAY[n.id]) AS shown,
            (SELECT count(*)::int FROM agent_calls c WHERE ${W} AND c.tool = 'read' AND (c.refs @> ARRAY[n.id] OR c.refs @> ARRAY['/context/' || n.path])) AS opened
     FROM context_nodes n WHERE NOT n.archived AND n.kind IN ('note', 'page', 'journal') ORDER BY n.path`, params);
  section("Context nobody opened in this window", "unread_context", context.filter((n) => !n.opened).slice(0, 40).map((n) => ({ what: `${n.kind}: /context/${n.path}`, shown_in_listings: n.shown })), "Every note, page and journal entry was opened at least once.");

  // Mentions: an event that names an agent. Seen = some later call of that agent was shown the thing;
  // answered = some later write of that agent names it or the thread it is in (a reply, an update to the todo or node).
  // It is a pointer for a person to follow up, not a verdict: a mention may need no answer.
  const mentions = await q<{ seq: number; ts: string; handle: string; type: string; entity_id: string; summary: string; seen: boolean; answered: boolean }>(
    `SELECT e.seq, e.ts, a.handle, e.type, e.entity_id, e.summary,
            EXISTS (SELECT 1 FROM agent_calls c WHERE c.agent_id = a.id AND c.ts >= e.ts AND (c.seen @> ARRAY[e.entity_id] OR c.refs @> ARRAY[e.entity_id])) AS seen,
            EXISTS (SELECT 1 FROM agent_calls c WHERE c.agent_id = a.id AND c.ts >= e.ts AND c.kind = 'write' AND c.ok AND (c.refs @> ARRAY[e.entity_id] OR c.refs @> ARRAY[(SELECT coalesce(p.root_id, p.id) FROM posts p WHERE p.id = e.entity_id)])) AS answered
     FROM events e JOIN agents a ON a.handle = ANY(e.mentions) AND a.kind = 'agent' AND a.id <> e.actor
     WHERE e.ts > now() - $1::interval${handle ? ` AND a.handle = $2` : ""} ORDER BY e.seq DESC LIMIT 400`, params);
  section("Mentions, and what became of them", "mentions", Object.values(mentions.reduce((acc: Record<string, { agent: string; mentioned: number; never_seen: number; seen_not_acted_on: number; acted_on: number }>, m) => {
    const r = (acc[m.handle] ??= { agent: "@" + m.handle, mentioned: 0, never_seen: 0, seen_not_acted_on: 0, acted_on: 0 });
    r.mentioned++;
    if (m.answered) r.acted_on++;
    else if (m.seen) r.seen_not_acted_on++;
    else r.never_seen++;
    return acc;
  }, {})), "Nobody was mentioned.");
  section("Possibly missed: mentioned, and no write that names it since", "missed", mentions.filter((m) => !m.answered).slice(0, 30).map((m) => ({ at: new Date(m.ts).toISOString().slice(0, 16), agent: "@" + m.handle, state: m.seen ? "seen, not acted on" : "never seen", event: m.type, id: m.entity_id, what: m.summary })), "Every mention was followed by a write naming it.");

  section("Runs inside Subspace and wake-ups, newest first", "runs", (await q(
    `SELECT r.id, '@' || a.handle AS agent, r.via, to_char(r.started_at, 'YYYY-MM-DD HH24:MI') AS started, r.status, round(extract(epoch FROM (r.finished_at - r.started_at)))::int AS seconds, r.steps, r.calls, r.errors,
            r.input_tokens AS tokens_in, r.output_tokens AS tokens_out, r.reason, coalesce(r.detail, '') AS detail
     FROM agent_runs r JOIN agents a ON a.id = r.agent_id WHERE r.started_at > now() - $1::interval${handle ? ` AND a.handle = $2` : ""} ORDER BY r.started_at DESC LIMIT 30`, params)), "No runs or wake-ups.");

  if (!asJson) console.log("\nOne run call by call: npm run agent-log -- --run <id>. Every failed call: npm run agent-log -- --errors.");
}

main()
  .then(() => (asJson && console.log(JSON.stringify(out, null, 1)), process.exit(0)))
  .catch((e) => (console.error(e), process.exit(1)));

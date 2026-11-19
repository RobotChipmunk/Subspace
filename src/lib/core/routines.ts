/**
 * Routines: duties that come round on a schedule, each done by one agent the owner chooses.
 *
 * Nothing here runs an agent by itself. When a routine is due, a job is created for its agent,
 * which wakes it the way a mention does (the built-in runtime starts, or its wake hook is
 * called); an agent that is woken by neither finds the job the next time it calls changes() or
 * jobs(). The agent does the work with its ordinary tools and ends with routine_done.
 *
 * What a routine is (its title and brief) lives in code, here. Who does it and when it last ran
 * live in the database, so the owner's choices survive a deploy.
 */
import { q, q1 } from "../db";
import { sightOf } from "./access";
import { agentById, bad, logEvent, newId, notFound, ownerAgent, type Agent } from "./util";

type Every = "daily" | "weekly";
type BuiltIn = { key: string; title: string; about: string; every: Every; brief: string };

export const ROUTINES: BuiltIn[] = [
  {
    key: "news-gaps",
    title: "News-gap check",
    about: "Each week: find subjects the owner cares about that no followed topic covers, and suggest them.",
    every: "weekly",
    brief: `Find subjects the owner cares about that nothing under Following tracks, and offer to follow them.

1. What is tracked: explore("/following"), reading each topic's brief where its title does not say enough.
2. What the owner cares about now: /context/me (interests and news preferences), the journal's last month or two (explore("/journal"), month lines first), this week's tasks, and recently saved links (explore("/links")).
3. What the feed carried this week: explore("/feed/by-time") down to the last seven days. Notice subjects that came up with no topic behind them, and topics that produced nothing.
4. Your own record: the note at /context/agents/routines/news-gaps (search for it; create it under /context/agents if it is missing). It lists what was suggested before and what the owner declined. Never suggest a declined subject again, and do not repeat one that is still waiting.
5. A gap is a subject that is plainly in 2 and absent from 1. For each one worth the owner's attention, raise one rail module: title "Follow <subject>?", one sentence saying why now, and two buttons that come back to you: actions [{ label: "Follow it", send: "follow:<slug>" }, { label: "Not this", send: "decline:<slug>" }]. The rail holds eight modules in all; if there are more gaps than room, raise the strongest and keep the rest in your note for next week.
6. Write what you suggested into the note, with the date.
7. When an answer comes back (changes(): rail.cleared with sent "follow:<slug>"), create the topic with tracker_create: a description that says exactly what counts as news for it and what to ignore, assigned to the agent that covers that area (yourself if none does). On "decline:<slug>", record it in the note. Answers may come days later; act on them whenever they arrive.
8. Finish with routine_done and one line on what you found. Finding no gap is a fine result: say so and raise nothing.`,
  },
  {
    key: "system-review",
    title: "System review",
    about: "Each week: look at how Subspace was used and suggest improvements, to the agents' ways of working or to the app itself.",
    every: "weekly",
    brief: `Look at how the system was used this week and suggest what would make it work better for the owner.

1. usage({ days: 7 }) gives the week in numbers: calls and failures by agent and tool, searches that found nothing, what happened to rail modules, tasks added and finished.
2. Look for what is wasteful or not working: a tool that keeps failing and why; searches that found nothing (content that is missing, or agents using words that are not there); an agent that reads far more than it uses, or was silent; modules the owner dismissed without acting (noise) against those they acted on; tasks agents added that were deleted; context that is stale, duplicated or has summaries that no longer fit.
3. Your own record: the note at /context/agents/routines/system-review (create it under /context/agents if missing). It lists what was suggested and what came of it. Do not repeat a suggestion the owner declined.
4. Sort each improvement worth making into one of two kinds.
   a. Something agents can change themselves (how a topic is described, a note that should be split or archived, a standing instruction): raise one rail module that says the change in a few words, with buttons that come back to you: actions [{ label: "Do it", send: "approve:<slug>" }, { label: "Not this", send: "decline:<slug>" }]. On "approve", make the change; on "decline", record it.
   b. Something that needs the app itself changed (a missing tool, a screen that gets in the way, a limit that is wrong): add a task with todo_add, tagged "subspace", view "backlog", whose notes give the case: what you saw, the numbers, and what would fix it. Then point one rail module at it (todo: its id). The owner takes these to the coding agent.
5. Write what you suggested into the note, with the date.
6. Finish with routine_done and one line. A quiet week needs no suggestions: say so and raise nothing.`,
  },
];

export type Routine = {
  key: string;
  title: string;
  about: string;
  every: Every;
  /** The agent that does it, or null while nobody does. */
  agent_id: string | null;
  /** When it next comes due; null while nobody is assigned. */
  next_at: string | null;
  /** When it was last handed to its agent, and when that agent last said it was done, with what it said. */
  last_at: string | null;
  last_done_at: string | null;
  last_note: string;
};

const DAYS: Record<Every, number> = { daily: 1, weekly: 7 };

async function ensure() {
  for (const r of ROUTINES) await q("INSERT INTO routines (key) VALUES ($1) ON CONFLICT (key) DO NOTHING", [r.key]);
}

export async function listRoutines(): Promise<Routine[]> {
  await ensure();
  const rows = await q<{ key: string; agent_id: string | null; next_at: string | null; last_at: string | null; last_done_at: string | null; last_note: string }>("SELECT key, agent_id, next_at, last_at, last_done_at, last_note FROM routines");
  return ROUTINES.map((r) => {
    const row = rows.find((x) => x.key === r.key);
    return { key: r.key, title: r.title, about: r.about, every: r.every, agent_id: row?.agent_id ?? null, next_at: row?.next_at ?? null, last_at: row?.last_at ?? null, last_done_at: row?.last_done_at ?? null, last_note: row?.last_note ?? "" };
  });
}

/**
 * The owner gives a routine to an agent, or takes it away (agent null). A routine given to an
 * agent for the first time comes due at once, so it is seen to work; one moved to another agent
 * keeps its day.
 */
export async function assignRoutine(actor: Agent, key: string, agentRef: string | null): Promise<Routine> {
  if (actor.kind !== "human") throw bad("Only the owner assigns routines.");
  if (!ROUTINES.some((r) => r.key === key)) throw notFound(`No routine "${key}".`);
  await ensure();
  if (agentRef === null || agentRef === "") {
    await q("UPDATE routines SET agent_id = NULL, next_at = NULL WHERE key = $1", [key]);
  } else {
    const a = await agentById(agentRef);
    if (!a || a.kind !== "agent" || a.archived) throw notFound("No such agent.");
    if (sightOf(a).readOnly) throw bad(`${a.name} is read-only, so it cannot do a routine. Turn Read only off first, or choose another agent.`);
    await q("UPDATE routines SET agent_id = $2, next_at = COALESCE(next_at, now()) WHERE key = $1", [key, a.id]);
  }
  await logEvent({ actor: actor.id, type: "routine.assigned", entity_type: "agent", entity_id: agentRef || actor.id, summary: `${ROUTINES.find((r) => r.key === key)!.title}: ${agentRef ? "assigned" : "unassigned"}`, data: { routine: key } });
  return (await listRoutines()).find((r) => r.key === key)!;
}

/**
 * Hands every routine that has come due to its agent, as a job. Safe to call often and from
 * several places at once: a routine is claimed in one statement, so it is handed over once. If
 * the agent has not finished the last round, no second job is made; the routine simply waits for
 * its next day.
 */
export async function tick(): Promise<{ due: string[] }> {
  // the same heartbeat tells the writers of notes that have passed their day (core/current.ts)
  await import("./current").then((c) => c.tellLapsed()).catch((e) => console.error("current: tellLapsed failed", (e as Error).message));
  // and gives what was written lately its place in search by meaning (core/meaning.ts)
  await import("./meaning").then((m) => m.embedPending()).catch((e) => console.error("meaning: embedPending failed", (e as Error).message));
  if (!(await q1("SELECT 1 FROM routines WHERE agent_id IS NOT NULL AND next_at <= now() LIMIT 1").catch(() => null))) return { due: [] };
  const due: string[] = [];
  for (const r of ROUTINES) {
    const claimed = await q1<{ agent_id: string }>(
      `UPDATE routines SET last_at = now(), next_at = now() + make_interval(days => $2)
       WHERE key = $1 AND agent_id IS NOT NULL AND next_at <= now() RETURNING agent_id`,
      [r.key, DAYS[r.every]],
    );
    if (!claimed) continue;
    const agent = await agentById(claimed.agent_id);
    if (!agent || agent.archived || agent.kind !== "agent") {
      await q("UPDATE routines SET agent_id = NULL, next_at = NULL WHERE key = $1", [r.key]);
      continue;
    }
    if (await q1("SELECT 1 FROM jobs WHERE kind = 'routine' AND target_id = $1 AND status = 'open'", [r.key])) continue;
    const owner = await ownerAgent();
    const id = newId("j");
    await q("INSERT INTO jobs (id, kind, target_type, target_id, prompt, requested_by, assigned_to) VALUES ($1,'routine','routine',$2,$3,$4,$5)", [id, r.key, r.title, owner.id, agent.id]);
    // the job's news names its agent, which is what wakes it
    await logEvent({ actor: owner.id, type: "job.created", entity_type: "job", entity_id: id, summary: `Routine due: ${r.title}`, data: { kind: "routine", routine: r.key, assigned_to: agent.id, target_id: r.key } });
    due.push(r.key);
  }
  return { due };
}

/** Runs tick() after the response has gone, when called inside a request. For places that are visited often anyway. */
export function tickSoon() {
  const run = () => tick().catch((e) => console.error("routines: tick failed", (e as Error).message));
  import("next/server").then(({ after }) => after(run)).catch(run);
}

/** A routine job as its agent is shown it: what the duty is and how to finish. */
export function routineJob(job: { id: string; target_id: string }) {
  const r = ROUTINES.find((x) => x.key === job.target_id);
  return {
    job_id: job.id,
    kind: "routine" as const,
    routine: job.target_id,
    title: r?.title ?? job.target_id,
    brief: r?.brief ?? "This routine no longer exists. Call routine_done to clear it.",
    finish: "When you have done it, call routine_done with this job_id and one line on what you found.",
  };
}

/** The agent says a routine is done for this round. */
export async function routineDone(agent: Agent, jobId: string, note: unknown) {
  const job = await q1<{ id: string; kind: string; target_id: string; assigned_to: string | null; status: string }>("SELECT id, kind, target_id, assigned_to, status FROM jobs WHERE id = $1", [jobId]);
  if (!job || job.kind !== "routine") throw notFound("No such routine job. jobs() lists the ones waiting for you.");
  if (job.assigned_to !== agent.id) throw bad("That routine is not yours.");
  const said = typeof note === "string" ? note.trim().slice(0, 300) : "";
  if (!said) throw bad("Give note: one line on what you found or did, for the owner to see beside the routine.");
  if (job.status === "open") {
    await q("UPDATE jobs SET status = 'done', done_at = now() WHERE id = $1", [jobId]);
    await q("UPDATE routines SET last_done_at = now(), last_note = $2 WHERE key = $1", [job.target_id, said]);
    await logEvent({ actor: agent.id, type: "job.done", entity_type: "job", entity_id: jobId, summary: `Routine done: ${ROUTINES.find((r) => r.key === job.target_id)?.title ?? job.target_id}. ${said}`, data: { kind: "routine", routine: job.target_id, assigned_to: agent.id } });
  }
  const next = await q1<{ next_at: string | null }>("SELECT next_at FROM routines WHERE key = $1", [job.target_id]);
  return { ok: true, next_due: next?.next_at ?? null };
}

/**
 * The week (or any number of days) in numbers, for the system review: who called what and how
 * often it failed, searches that found nothing, what became of rail modules, and tasks.
 */
export async function usage(days: unknown) {
  const n = Math.min(Math.max(Math.round(Number(days) || 7), 1), 60);
  const since = `now() - make_interval(days => ${n})`;
  const [agents, tools, failures, empty, rail, tasks, notes, runs] = await Promise.all([
    q<{ agent: string; calls: number; failed: number; reads: number; writes: number; chars_read: number }>(
      `SELECT a.handle AS agent, count(*)::int AS calls, (count(*) FILTER (WHERE NOT c.ok))::int AS failed, (count(*) FILTER (WHERE c.kind = 'read'))::int AS reads,
              (count(*) FILTER (WHERE c.kind = 'write'))::int AS writes, COALESCE(sum(c.result_chars), 0)::bigint AS chars_read
       FROM agent_calls c JOIN agents a ON a.id = c.agent_id WHERE c.ts >= ${since} GROUP BY 1 ORDER BY calls DESC`,
    ),
    q<{ tool: string; calls: number; failed: number }>(`SELECT tool, count(*)::int AS calls, (count(*) FILTER (WHERE NOT ok))::int AS failed FROM agent_calls WHERE ts >= ${since} GROUP BY 1 ORDER BY calls DESC LIMIT 40`),
    q<{ tool: string; error: string; times: number }>(`SELECT tool, left(error, 160) AS error, count(*)::int AS times FROM agent_calls WHERE ts >= ${since} AND NOT ok AND error IS NOT NULL GROUP BY 1, 2 ORDER BY times DESC LIMIT 12`),
    q<{ query: string; times: number }>(`SELECT lower(query) AS query, count(*)::int AS times FROM agent_calls WHERE ts >= ${since} AND tool = 'search' AND ok AND result_count = 0 AND query IS NOT NULL GROUP BY 1 ORDER BY times DESC, 1 LIMIT 20`),
    q<{ agent: string; raised: number; acted: number; sent: number; kept_for_later: number; opened_task: number; dismissed: number; showing: number }>(
      `SELECT a.handle AS agent, count(*)::int AS raised,
              (count(*) FILTER (WHERE m.cleared_by = 'action'))::int AS acted, (count(*) FILTER (WHERE m.sent IS NOT NULL))::int AS sent,
              (count(*) FILTER (WHERE m.cleared_by = 'later'))::int AS kept_for_later, (count(*) FILTER (WHERE m.cleared_by = 'todo_open'))::int AS opened_task,
              (count(*) FILTER (WHERE m.cleared_by = 'dismiss'))::int AS dismissed, (count(*) FILTER (WHERE m.dismissed_at IS NULL AND m.show_until > now()))::int AS showing
       FROM rail_modules m JOIN agents a ON a.id = m.author WHERE m.created_at >= ${since} GROUP BY 1 ORDER BY raised DESC`,
    ),
    q1<{ added_by_agents: number; added_by_owner: number; finished: number; deleted: number }>(
      `SELECT (count(*) FILTER (WHERE t.created_at >= ${since} AND a.kind = 'agent'))::int AS added_by_agents,
              (count(*) FILTER (WHERE t.created_at >= ${since} AND a.kind = 'human'))::int AS added_by_owner,
              (count(*) FILTER (WHERE t.done_at >= ${since}))::int AS finished,
              (count(*) FILTER (WHERE t.deleted_at >= ${since}))::int AS deleted
       FROM todos t JOIN agents a ON a.id = t.created_by`,
    ),
    q<{ path: string; title: string; chars: number; no_summary: boolean }>(
      `SELECT path, title, length(body)::int AS chars, (summary = '') AS no_summary FROM context_nodes
       WHERE NOT archived AND kind = 'note' AND ((summary = '' AND length(body) > 200) OR length(body) > 4500) ORDER BY length(body) DESC LIMIT 20`,
    ),
    q<{ agent: string; runs: number; errors: number; limits: number }>(
      `SELECT a.handle AS agent, count(*)::int AS runs, (count(*) FILTER (WHERE r.status = 'error'))::int AS errors, (count(*) FILTER (WHERE r.status = 'limit'))::int AS limits
       FROM agent_runs r JOIN agents a ON a.id = r.agent_id WHERE r.started_at >= ${since} GROUP BY 1 ORDER BY runs DESC`,
    ),
  ]);
  return {
    days: n,
    agents: agents.map((a) => ({ ...a, agent: "@" + a.agent, chars_read: Number(a.chars_read) })),
    tools,
    failures,
    searches_that_found_nothing: empty,
    rail: rail.map((r) => ({ ...r, agent: "@" + r.agent })),
    tasks,
    built_in_runs: runs.map((r) => ({ ...r, agent: "@" + r.agent })),
    // notes other agents cannot judge from far away (no summary) or should not have to read whole (long)
    context_to_tidy: notes.map((n) => ({ path: "/context/" + n.path, title: n.title, ...(n.no_summary ? { problem: "no summary" } : { problem: `long (${n.chars} characters): split it into child notes` }) })),
    reading: "calls are tool calls. chars_read is how much text each agent was given. In rail, acted is a tap on one of the module's buttons, sent a button that sent its answer to the agent, and dismissed is closed without acting: many dismissals for one agent is noise.",
  };
}

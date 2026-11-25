import { randomBytes } from "crypto";
import { q, q1 } from "../db";
import { readRules, type AccessRules } from "./access";
import { revokeAllFor } from "./oauth";
import { agentById, bad, logEvent, newId, notFound, sha256, slugify, type Agent } from "./util";

/** How long a standing brief may be. It is read at the start of every session, so it is kept to what matters. */
export const BRIEF_MAX = 1500;

export type Activity = {
  /** Posts to the feed and to followed topics. */
  posts: number;
  /** Replies, direct answers and words in a task's conversation. */
  replies: number;
  /** Notes, pages and links written or changed in context. */
  context: number;
  /** Tasks added. */
  todos: number;
  /** Rounds of a routine finished, and rounds still waiting to be done. */
  routines_done: number;
  routines_waiting: number;
  /** Tool calls in all, and how many of them wrote something. */
  calls: number;
  writes: number;
  /** When it last wrote anything in context, ever; null when it never has. */
  last_context_at: string | null;
};

/**
 * What each agent contributed over the last days, so the owner can see who is doing what: the
 * Agents screen shows it as one plain sentence per agent.
 */
export async function agentActivity(days: unknown): Promise<{ days: number; agents: Record<string, Activity> }> {
  const n = Math.min(Math.max(Math.round(Number(days) || 7), 1), 60);
  const since = `now() - make_interval(days => ${n})`;
  const WROTE = "entity_type = 'context' AND type NOT IN ('context.lapsed', 'context.archived')";
  const [posts, context, last, todos, jobs, calls] = await Promise.all([
    q<{ id: string; posts: number; replies: number }>(
      `SELECT author AS id, (count(*) FILTER (WHERE parent_id IS NULL AND todo_id IS NULL AND channel IN ('feed', 'timeline')))::int AS posts,
              (count(*) FILTER (WHERE parent_id IS NOT NULL OR todo_id IS NOT NULL OR channel LIKE 'dm:%' OR channel = 'agents'))::int AS replies
       FROM posts WHERE created_at >= ${since} GROUP BY 1`,
    ),
    q<{ id: string; n: number }>(`SELECT actor AS id, count(*)::int AS n FROM events WHERE ${WROTE} AND ts >= ${since} GROUP BY 1`),
    q<{ id: string; at: Date }>(`SELECT actor AS id, max(ts) AS at FROM events WHERE ${WROTE} GROUP BY 1`),
    q<{ id: string; n: number }>(`SELECT created_by AS id, count(*)::int AS n FROM todos WHERE created_at >= ${since} GROUP BY 1`),
    q<{ id: string; done: number; waiting: number }>(
      `SELECT assigned_to AS id, (count(*) FILTER (WHERE status = 'done' AND done_at >= ${since}))::int AS done, (count(*) FILTER (WHERE status = 'open'))::int AS waiting
       FROM jobs WHERE kind = 'routine' AND assigned_to IS NOT NULL GROUP BY 1`,
    ),
    q<{ id: string; calls: number; writes: number }>(`SELECT agent_id AS id, count(*)::int AS calls, (count(*) FILTER (WHERE kind = 'write' AND ok))::int AS writes FROM agent_calls WHERE ts >= ${since} AND tool <> 'connect' GROUP BY 1`),
  ]);
  const agents: Record<string, Activity> = {};
  for (const a of await q<{ id: string }>("SELECT id FROM agents WHERE kind = 'agent' AND NOT archived")) {
    const of = <T extends { id: string }>(rows: T[]) => rows.find((r) => r.id === a.id);
    const at = of(last)?.at;
    agents[a.id] = {
      posts: of(posts)?.posts ?? 0,
      replies: of(posts)?.replies ?? 0,
      context: of(context)?.n ?? 0,
      todos: of(todos)?.n ?? 0,
      routines_done: of(jobs)?.done ?? 0,
      routines_waiting: of(jobs)?.waiting ?? 0,
      calls: of(calls)?.calls ?? 0,
      writes: of(calls)?.writes ?? 0,
      last_context_at: at ? new Date(at).toISOString() : null,
    };
  }
  return { days: n, agents };
}

export async function createAgent(actor: Agent, input: { name: string; handle?: string; bio?: string }) {
  const name = (input.name ?? "").trim();
  if (!name) throw bad("Agent needs a name.");
  const handle = slugify(input.handle || name).replace(/-/g, "").slice(0, 24);
  if (handle.length < 2) throw bad("Handle must be at least two letters or digits.");
  if (handle === "guest") throw bad("That handle is reserved. Pick another name.");
  if (await q1("SELECT 1 FROM agents WHERE handle = $1", [handle])) throw bad(`@${handle} is taken.`);
  const id = newId("a");
  // New agents start at the present; history is there to explore, not to replay.
  await q("INSERT INTO agents (id, handle, name, bio, cursor_seq) VALUES ($1,$2,$3,$4,(SELECT COALESCE(max(seq),0) FROM events))", [id, handle, name.slice(0, 40), (input.bio ?? "").slice(0, 240)]);
  await logEvent({ actor: actor.id, type: "agent.joined", entity_type: "agent", entity_id: id, summary: `@${handle} (${name}) joined` });
  return (await agentById(id))!;
}

export async function updateAgent(actor: Agent, id: string, patch: { name?: string; bio?: string; /** the owner's standing brief for the agent; "" clears it */ brief?: string; illustrator?: boolean; /** true makes this the agent that answers when the owner names nobody */ default?: boolean; archived?: boolean; /** what it may see and do; null gives it everything again */ access?: AccessRules | null }) {
  const a = await agentById(id);
  if (!a || a.kind === "guest") throw notFound("No such agent");
  if (a.kind === "human" && patch.archived) throw bad("The owner cannot be removed.");
  if (patch.access !== undefined) {
    if (a.kind !== "agent") throw bad("Access is set on agents.");
    const rules = readRules(patch.access);
    await q("UPDATE agents SET access = $2::jsonb WHERE id = $1", [id, rules ? JSON.stringify(rules) : null]);
    await logEvent({ actor: actor.id, type: "agent.access", entity_type: "agent", entity_id: id, summary: `@${a.handle}: access ${rules ? "changed" : "set to everything"}` });
  }
  let roles = a.roles;
  if (patch.illustrator === true) {
    // One illustrator at a time keeps the visual style consistent.
    await q("UPDATE agents SET roles = array_remove(roles, 'illustrator')");
    await q("UPDATE jobs SET assigned_to = $1 WHERE status = 'open' AND kind <> 'routine'", [id]);
    roles = [...roles.filter((r) => r !== "illustrator"), "illustrator"];
  } else if (patch.illustrator === false) roles = roles.filter((r) => r !== "illustrator");
  if (patch.default === true) {
    if (a.kind !== "agent") throw bad("Only an agent can be the default.");
    // one at a time: it is who a message goes to when it names nobody
    await q("UPDATE agents SET roles = array_remove(roles, 'default')");
    roles = [...roles.filter((r) => r !== "default"), "default"];
  }
  if (patch.archived) roles = roles.filter((r) => r !== "default");
  await q("UPDATE agents SET name = $2, bio = $3, roles = $4, archived = $5, token_hash = CASE WHEN $5 THEN NULL ELSE token_hash END WHERE id = $1", [
    id, patch.name?.trim() || a.name, patch.bio ?? a.bio, roles, patch.archived ?? a.archived,
  ]);
  if (typeof patch.brief === "string" && patch.brief.trim() !== (a.brief ?? "")) {
    if (a.kind !== "agent") throw bad("A standing brief is written for an agent.");
    await q("UPDATE agents SET brief = $2 WHERE id = $1", [id, patch.brief.trim().slice(0, BRIEF_MAX)]);
    // the agent hears that what is wanted of it has changed; it reads the brief itself in its next briefing
    await logEvent({ actor: actor.id, type: "agent.brief", entity_type: "agent", entity_id: id, summary: `@${a.handle}: standing brief ${patch.brief.trim() ? "changed" : "cleared"}`, mentions: [a.handle] });
  }
  if (patch.archived) {
    // its routines are left for the owner to give to someone else, and any round it had not finished is closed
    // (a routine it shared with others goes on with them: the next one takes its place)
    await q("UPDATE routines SET also = array_remove(also, $1) WHERE $1 = ANY(also)", [id]);
    await q("UPDATE routines SET agent_id = also[1], also = also[2:], next_at = CASE WHEN also[1] IS NULL THEN NULL ELSE next_at END WHERE agent_id = $1", [id]);
    await q("UPDATE jobs SET status = 'cancelled', done_at = now() WHERE kind = 'routine' AND status = 'open' AND assigned_to = $1", [id]);
    await q("UPDATE trackers SET agents = array_remove(agents, $1)", [id]);
    await revokeAllFor(id);
  }
  return (await agentById(id))!;
}

/**
 * Issues a fresh static token, replacing any earlier one. The token is shown once. It is for scripts
 * and clients that send an Authorization header; it is never accepted in an address. Apps connect by
 * signing in instead (see core/oauth.ts).
 */
export async function issueToken(id: string): Promise<string> {
  const a = await agentById(id);
  if (!a || a.kind !== "agent") throw notFound("No such agent");
  const token = "ss_" + randomBytes(24).toString("base64url");
  await q("UPDATE agents SET token_hash = $2, cursor_seq = GREATEST(cursor_seq, 0) WHERE id = $1", [id, sha256(token)]);
  return token;
}

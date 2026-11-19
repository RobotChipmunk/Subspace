/**
 * What is true for now: the middle tier of memory, between the rail (hours and days) and
 * long-term context (until someone changes it).
 *
 * A note under the top-level section Current (/context/current) says what holds for a while: this
 * month's focus, a trip, a temporary preference, a project in its busy weeks. It carries the day
 * it stops being true (`until`). Agents write these freely, from what they see in the journal,
 * the tasks and what the owner asks for; the owner can change or remove any of them.
 *
 * Every agent's briefing lists what is current, so it starts a session knowing it. When a note
 * passes its day it drops out of the briefing and the agent that wrote it is told, once, to renew
 * it, fold what lasted into long-term context, or archive it. Nothing is deleted by the clock.
 */
import { q, q1 } from "../db";
import { createNode, CURRENT, getNode, type ContextNode } from "./context";
import { listAgents, logEvent, ownerAgent, timezone, todayIn } from "./util";

export { CURRENT };

/** The Current section, created the first time it is needed. */
export async function ensureCurrent(): Promise<ContextNode> {
  const have = await q1<{ id: string }>("SELECT id FROM context_nodes WHERE path = $1 AND NOT archived", [CURRENT]);
  if (have) return getNode(have.id);
  return createNode(await ownerAgent(), {
    title: "Current",
    summary: "What is true for now: this month's focus, a trip, a temporary preference. Each note says until when.",
    body: "Notes here hold for a while and say until when. Agents add them from what they see; change or remove any of them.",
  });
}

export type CurrentNote = { id: string; path: string; title: string; summary: string; until: string | null; updated_by: string; updated_at: string; lapsed: boolean };

/** The notes under Current, soonest to end first, with those past their day marked. */
export async function currentNotes(): Promise<CurrentNote[]> {
  const today = todayIn(await timezone());
  const rows = await q<Omit<CurrentNote, "lapsed">>(
    `SELECT id, path, title, summary, until, updated_by, updated_at FROM context_nodes
     WHERE path LIKE $1 AND NOT archived AND kind = 'note' ORDER BY until NULLS LAST, title LIMIT 60`,
    [CURRENT + "/%"],
  );
  return rows.map((r) => ({ ...r, lapsed: !!r.until && r.until < today }));
}

/**
 * Tells the writer of each note that has passed its day, once. Safe to call often: a note is
 * claimed in the same statement that finds it.
 */
export async function tellLapsed(): Promise<number> {
  const today = todayIn(await timezone());
  const rows = await q<{ id: string; path: string; title: string; until: string; updated_by: string }>(
    "UPDATE context_nodes SET lapse_told = true WHERE until IS NOT NULL AND until < $1::date AND NOT lapse_told AND NOT archived RETURNING id, path, title, until, updated_by",
    [today],
  );
  if (!rows.length) return 0;
  const agents = await listAgents(true);
  const owner = await ownerAgent();
  for (const n of rows) {
    const writer = agents.find((a) => a.id === n.updated_by && a.kind === "agent" && !a.archived);
    await logEvent({
      actor: owner.id,
      type: "context.lapsed",
      entity_type: "context",
      entity_id: n.id,
      summary: `/context/${n.path} passed its day (${n.until}). If it still holds, give it a new until; if something in it lasted, move that into long-term context; otherwise archive it.`,
      // naming the writer is what brings it to them
      mentions: writer ? [writer.handle] : [],
      data: { path: n.path, until: n.until },
    });
  }
  return rows.length;
}

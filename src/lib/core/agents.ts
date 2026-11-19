import { randomBytes } from "crypto";
import { q, q1 } from "../db";
import { readRules, type AccessRules } from "./access";
import { revokeAllFor } from "./oauth";
import { agentById, bad, logEvent, newId, notFound, sha256, slugify, type Agent } from "./util";

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

export async function updateAgent(actor: Agent, id: string, patch: { name?: string; bio?: string; illustrator?: boolean; archived?: boolean; /** what it may see and do; null gives it everything again */ access?: AccessRules | null }) {
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
  await q("UPDATE agents SET name = $2, bio = $3, roles = $4, archived = $5, token_hash = CASE WHEN $5 THEN NULL ELSE token_hash END WHERE id = $1", [
    id, patch.name?.trim() || a.name, patch.bio ?? a.bio, roles, patch.archived ?? a.archived,
  ]);
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

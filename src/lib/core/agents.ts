import { randomBytes } from "crypto";
import { q, q1 } from "../db";
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

export async function updateAgent(actor: Agent, id: string, patch: { name?: string; bio?: string; illustrator?: boolean; archived?: boolean; url_token?: boolean }) {
  const a = await agentById(id);
  if (!a || a.kind === "guest") throw notFound("No such agent");
  if (a.kind === "human" && patch.archived) throw bad("The owner cannot be removed.");
  let roles = a.roles;
  if (patch.illustrator === true) {
    // One illustrator at a time keeps the visual style consistent.
    await q("UPDATE agents SET roles = array_remove(roles, 'illustrator')");
    await q("UPDATE jobs SET assigned_to = $1 WHERE status = 'open'", [id]);
    roles = [...roles.filter((r) => r !== "illustrator"), "illustrator"];
  } else if (patch.illustrator === false) roles = roles.filter((r) => r !== "illustrator");
  await q("UPDATE agents SET name = $2, bio = $3, roles = $4, archived = $5, token_hash = CASE WHEN $5 THEN NULL ELSE token_hash END WHERE id = $1", [
    id, patch.name?.trim() || a.name, patch.bio ?? a.bio, roles, patch.archived ?? a.archived,
  ]);
  // Switching off the old secret address is one-way here; a new static token is header-only from the start.
  if (patch.url_token === false) await q("UPDATE agents SET url_token = false WHERE id = $1", [id]);
  if (patch.archived) {
    await q("UPDATE trackers SET agents = array_remove(agents, $1)", [id]);
    await revokeAllFor(id);
  }
  return (await agentById(id))!;
}

/**
 * Issues a fresh static token, replacing any earlier one. The token is shown once. It is for scripts
 * and clients that send an Authorization header; it is not accepted in the address itself, where it
 * would end up in logs and settings screens. Apps connect by signing in instead (see core/oauth.ts).
 */
export async function issueToken(id: string): Promise<string> {
  const a = await agentById(id);
  if (!a || a.kind !== "agent") throw notFound("No such agent");
  const token = "ss_" + randomBytes(24).toString("base64url");
  await q("UPDATE agents SET token_hash = $2, url_token = false, cursor_seq = GREATEST(cursor_seq, 0) WHERE id = $1", [id, sha256(token)]);
  return token;
}

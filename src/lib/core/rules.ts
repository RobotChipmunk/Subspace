/**
 * House rules: the instructions every agent follows that the owner can read and shape.
 *
 * They are ordinary context nodes under one top-level section, System (/context/system), so they
 * are searchable, versioned and readable like any other note. What sets them apart:
 *  - Every agent is given them without asking: a digest goes out with the connection
 *    instructions, in the briefing and in the built-in agent's prompt.
 *  - Only the owner changes them directly. An agent's change is held as a proposal and put to the
 *    owner in the rail ("Approve" / "Decline"); approved, the server applies it as that agent
 *    wrote it. Every other part of context stays free for agents to edit.
 *
 * The fixed guide (mcp/guide.ts) says how the tools work and must match the code. House rules say
 * how this household wants its agents to behave, and win where the two differ.
 */
import { q, q1 } from "../db";
import { archiveNode, createNode, getNode, isSystemPath, SYSTEM, updateNode, type ContextNode } from "./context";
import { doersOf, listRoutines } from "./routines";
import { listTrackers } from "./trackers";
import { agentById, bad, listAgents, newId, notFound, oneLine, ownerAgent, type Agent } from "./util";

export { isSystemPath, SYSTEM };
/** The key of a rail module that asks the owner about a proposal. */
const MODULE_KEY = "house-rule-";

const STARTER = `These are the house rules: how this household wants its agents to work. Every agent is given them at the start of a session, and they win over the general guide where the two differ.

- Agents may propose a change to anything in this section. A proposal goes to the owner, and nothing changes until they approve it.
- Keep each rule short and say why it exists.`;

/** The System section, created the first time it is needed. */
export async function ensureSystem(): Promise<ContextNode> {
  const have = await q1<{ id: string }>("SELECT id FROM context_nodes WHERE path = $1 AND NOT archived", [SYSTEM]);
  if (have) return getNode(have.id);
  const owner = await ownerAgent();
  const made = await createNode(owner, { title: "System", summary: "House rules: how agents work here. Every agent is given them; agents propose changes and the owner approves.", body: STARTER });
  if (made.path === SYSTEM) return made;
  // two requests made it at once and this one came second: keep the first
  await archiveNode(owner, made.id).catch(() => {});
  return getNode(SYSTEM);
}

const DIGEST_CHARS = 6000;

/**
 * The house rules as text for an agent: the notes under System in full while they fit, then by
 * summary; who does each routine; and the topics being followed. Empty until the section exists.
 */
export async function houseRules(): Promise<string> {
  const nodes = await q<{ id: string; path: string; title: string; summary: string; body: string }>(
    "SELECT id, path, title, summary, body FROM context_nodes WHERE (path = $1 OR path LIKE $2) AND NOT archived AND kind = 'note' ORDER BY path",
    [SYSTEM, SYSTEM + "/%"],
  );
  if (!nodes.length) return "";
  const parts: string[] = [];
  let used = 0;
  const later: string[] = [];
  for (const n of nodes) {
    const text = n.path === SYSTEM ? n.body.trim() : `${"#".repeat(Math.min(n.path.split("/").length, 4))} ${n.title}\n${n.body.trim() || n.summary}`;
    if (!text) continue;
    if (used + text.length <= DIGEST_CHARS) {
      parts.push(text);
      used += text.length;
    } else later.push(`- ${n.title}: ${n.summary || oneLine(n.body, 120)} (read /context/${n.path})`);
  }
  if (later.length) parts.push(`More house rules, by summary. Read the ones that bear on what you are doing:\n${later.join("\n")}`);

  const agents = await listAgents(true);
  const handle = (id: string | null) => (id ? "@" + (agents.find((a) => a.id === id)?.handle ?? id) : "nobody yet");
  const routines = await listRoutines();
  if (routines.length) parts.push(`Routines (each is one agent's duty, except idea growth, which several may share; explore("/routines") has the briefs):\n${routines.map((r) => `- ${r.title}, ${r.every}: ${doersOf(r).map(handle).join(" and ") || handle(null)}`).join("\n")}`);
  const topics = await listTrackers();
  if (topics.length) {
    const shown = topics.slice(0, 40);
    parts.push(
      `Followed topics (news is tracked for these; explore("/following") has each brief):\n${shown.map((t) => `- ${t.title} [${t.label}]: ${t.agents.length ? t.agents.map(handle).join(" ") : "unassigned"}`).join("\n")}${topics.length > shown.length ? `\n- and ${topics.length - shown.length} more` : ""}`,
    );
  }
  return parts.join("\n\n");
}

/** The digest under its heading, ready to follow the guide in an agent's instructions; empty when there are no house rules. */
export async function houseRulesSection(): Promise<string> {
  const text = await houseRules().catch(() => "");
  return text
    ? `HOUSE RULES (set by the owner for this Subspace; follow them, and where they differ from the guide above, they win. To change one, use context_write on the note under /context/system with why: your change is put to the owner and applies only if they approve.)\n\n${text}`
    : "";
}

// ---------- Proposals ----------

type Patch = { title?: string; summary?: string; body?: string; body_append?: string; body_replace?: { find: string; replace: string } };
export type Proposal = {
  id: string;
  agent_id: string;
  /** create: a new note under parent. update: a change to node. archive: removing node. */
  kind: "create" | "update" | "archive";
  node_id: string | null;
  parent_id: string | null;
  /** The note's title: the existing one, or the one a new note would have. */
  title: string;
  why: string;
  patch: Patch;
  /** In a few words, for a notification: what would change. */
  excerpt: string;
  /** The note's text as it would be afterwards (empty for a removal). */
  after: string;
  status: "pending" | "approved" | "declined" | "failed";
  error: string | null;
  module_id: string | null;
  created_at: string;
  decided_at: string | null;
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
/** A piece of a note as one plain line, without the dashes of a list. */
const said = (md: string, n: number) => oneLine(md.replace(/^\s*[-*]\s+/gm, ""), n);

/** Whether a context_write or context_archive call from an agent is aimed at the house rules. */
export async function aimsAtSystem(args: { id?: unknown; parent?: unknown }): Promise<boolean> {
  for (const ref of [args.id, args.parent]) {
    if (typeof ref !== "string" || !ref.trim() || ["/", "/context", "/context/"].includes(ref)) continue;
    const key = ref.replace(/^\/?(context\/)?/, "").replace(/\/$/, "");
    if (isSystemPath(key)) return true;
    const n = await q1<{ path: string }>("SELECT path FROM context_nodes WHERE id = $1 AND NOT archived", [ref]);
    if (n && isSystemPath(n.path)) return true;
  }
  return false;
}

/**
 * An agent's change to a house rule, held for the owner. It is written down exactly, so what the
 * owner approves is what is applied, and a rail module asks them (unless the rail is full or
 * `rail` is false, when it waits under Context > System all the same).
 */
export async function propose(
  agent: Agent,
  input: Patch & { id?: string; parent?: string | null; archive?: boolean; why?: string },
  opts: { rail?: boolean } = {},
): Promise<{ proposed: true; id: string; note: string }> {
  const why = String(input.why ?? "").trim();
  if (!why) throw bad("This is a house rule, which changes only with the owner's approval. Send the same call again with why: one sentence, at most 120 characters, telling the owner why the change is worth making. It is then put to them, and applied if they approve.");
  if (why.length > 120) throw bad(`why is ${why.length} characters; keep it to one sentence of at most 120.`);
  await ensureSystem();

  let kind: Proposal["kind"];
  let node: ContextNode | null = null;
  let parent: ContextNode | null = null;
  let after = "";
  let excerpt = "";
  const patch: Patch = {};
  if (input.id) {
    node = await getNode(input.id);
    if (!isSystemPath(node.path)) throw bad("That note is not a house rule; change it directly.");
    if (input.parent !== undefined) throw bad("A house rule cannot be moved by proposal. Propose removing it and adding it where it belongs.");
    if (input.archive) {
      if (node.path === SYSTEM) throw bad("The System section itself cannot be removed.");
      kind = "archive";
      excerpt = "Removes this rule.";
    } else {
      kind = "update";
      after = node.body;
      if (input.body !== undefined) {
        patch.body = input.body;
        after = input.body;
        excerpt = "Rewrites it: " + said(input.body, 200);
      } else if (input.body_append) {
        patch.body_append = input.body_append;
        after = node.body.trim() ? `${node.body.trimEnd()}\n\n${input.body_append}` : input.body_append;
        excerpt = "Adds: " + said(input.body_append, 200);
      } else if (input.body_replace) {
        const { find, replace } = input.body_replace;
        if (!find || !node.body.includes(find)) throw bad("body_replace.find was not found. Read the note first and copy the exact text.");
        patch.body_replace = { find, replace };
        after = node.body.replace(find, replace);
        excerpt = `Changes “${said(find, 90)}” to “${said(replace, 90)}”`;
      }
      if (input.title?.trim() && input.title.trim() !== node.title) patch.title = input.title.trim();
      if (input.summary !== undefined && input.summary !== node.summary) patch.summary = input.summary;
      if (!excerpt) excerpt = patch.title ? `Renames it “${patch.title}”` : patch.summary !== undefined ? "Changes its summary: " + oneLine(patch.summary, 180) : "";
      if (!excerpt) throw bad("Nothing would change. Give body, body_append, body_replace, title or summary.");
    }
  } else {
    const title = (input.title ?? "").trim();
    if (!title) throw bad("A new house rule needs a title.");
    parent = input.parent ? await getNode(input.parent) : await ensureSystem();
    if (!isSystemPath(parent.path)) throw bad("A new house rule goes under /context/system.");
    kind = "create";
    patch.title = title;
    patch.summary = input.summary ?? "";
    patch.body = input.body ?? input.body_append ?? "";
    after = patch.body;
    excerpt = `New rule, “${title}”: ` + said(patch.body || patch.summary || "", 180);
  }
  if (after.length > 100_000) throw bad("That is too long for a house rule. Keep rules short; put detail in an ordinary context note and point to it.");

  const title = node?.title ?? patch.title ?? "";
  const same = await q1<{ id: string }>("SELECT id FROM rule_proposals WHERE status = 'pending' AND agent_id = $1 AND node_id IS NOT DISTINCT FROM $2 AND kind = $3 AND patch = $4::jsonb", [agent.id, node?.id ?? null, kind, JSON.stringify(patch)]);
  if (same) return { proposed: true, id: same.id, note: "You have already proposed exactly this and the owner has not answered yet. Wait for their answer in changes(); do not propose it again." };

  const id = newId("u");
  await q("INSERT INTO rule_proposals (id, agent_id, kind, node_id, parent_id, title, why, patch, excerpt, after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
    id, agent.id, kind, node?.id ?? null, parent?.id ?? null, title, why, JSON.stringify(patch), clip(excerpt, 240), after,
  ]);

  let asked = false;
  if (opts.rail !== false) {
    try {
      const { setModule } = await import("./rail");
      const m = await setModule(agent, {
        key: MODULE_KEY + id.slice(2),
        icon: "document",
        label: "House rule · needs your approval",
        title: clip(title, 60),
        subtitle: why,
        blocks: [{ type: "callout", tone: "decision", text: clip(excerpt, 240) }],
        actions: [{ label: "Approve", send: "approve" }, { label: "Decline", send: "decline" }],
        show_until: new Date(Date.now() + 21 * 86400_000).toISOString(),
        priority: 3,
      });
      await q("UPDATE rule_proposals SET module_id = $2 WHERE id = $1", [id, m.id]);
      asked = true;
    } catch (e) {
      console.error("rules: could not raise the proposal in the rail", (e as Error).message);
    }
  }
  return {
    proposed: true,
    id,
    note: `Nothing has changed yet. House rules change only with the owner's approval, and your change has been put to them${asked ? " in the rail" : " under Context, System (the rail is full)"}. Their answer reaches you in changes(). If they approve, it is applied exactly as you wrote it: you need do nothing more, and must not make the change another way.`,
  };
}

async function withNames(rows: Proposal[]) {
  const agents = await listAgents(true);
  return rows.map((p) => ({ ...p, by: agents.find((a) => a.id === p.agent_id)?.handle ?? p.agent_id }));
}

/** Proposals waiting for the owner, oldest first. */
export async function pendingProposals() {
  return withNames(await q<Proposal>("SELECT * FROM rule_proposals WHERE status = 'pending' ORDER BY created_at"));
}

/** Applies or sets aside a proposal. Approved, the change is made as the agent wrote it and carries its name. */
async function settle(p: Proposal, approve: boolean): Promise<{ status: Proposal["status"]; error?: string }> {
  if (p.status !== "pending") return { status: p.status };
  if (!approve) {
    await q("UPDATE rule_proposals SET status = 'declined', decided_at = now() WHERE id = $1 AND status = 'pending'", [p.id]);
    return { status: "declined" };
  }
  const agent = await agentById(p.agent_id);
  try {
    if (!agent) throw new Error("The agent that proposed this is gone.");
    if (p.kind === "create") await createNode(agent, { parent: p.parent_id, title: p.patch.title ?? p.title, summary: p.patch.summary, body: p.patch.body }, { approved: true });
    else if (p.kind === "archive") await archiveNode(agent, p.node_id!, { approved: true });
    else await updateNode(agent, p.node_id!, p.patch, { approved: true });
    await q("UPDATE rule_proposals SET status = 'approved', decided_at = now() WHERE id = $1", [p.id]);
    return { status: "approved" };
  } catch (e) {
    const error = (e as Error).message.slice(0, 300);
    await q("UPDATE rule_proposals SET status = 'failed', decided_at = now(), error = $2 WHERE id = $1", [p.id, error]);
    return { status: "failed", error: `It could not be applied: ${error} The rule has probably changed since this was proposed; the agent can propose it again.` };
  }
}

/** The owner answered a proposal's rail module. Called from the rail when one of its buttons is tapped. */
export async function decideByModule(moduleId: string, approve: boolean) {
  const p = await q1<Proposal>("SELECT * FROM rule_proposals WHERE module_id = $1", [moduleId]);
  return p ? settle(p, approve) : null;
}

export const isProposalModule = (key: string) => key.startsWith(MODULE_KEY);

/**
 * The owner answers a proposal from the Context screen. If a rail module is asking about it, the
 * answer goes through that module, so it leaves the rail and its agent hears exactly as if the
 * module's own button had been tapped.
 */
export async function decide(actor: Agent, id: string, approve: boolean) {
  if (actor.kind !== "human") throw bad("Only the owner approves a house rule.");
  const p = await q1<Proposal>("SELECT * FROM rule_proposals WHERE id = $1", [id]);
  if (!p) throw notFound("No such proposal.");
  if (p.module_id && p.status === "pending") {
    const { moduleActed } = await import("./rail");
    const acted = await moduleActed(actor, p.module_id, approve ? "Approve" : "Decline");
    if (acted.cleared || acted.sent) return (await q1<Proposal>("SELECT * FROM rule_proposals WHERE id = $1", [id]))!;
  }
  await settle(p, approve);
  return (await q1<Proposal>("SELECT * FROM rule_proposals WHERE id = $1", [id]))!;
}

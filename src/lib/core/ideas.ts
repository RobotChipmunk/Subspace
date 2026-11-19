/**
 * Ideas: a place to let an idea grow.
 *
 * An idea is a canvas. The owner puts things on it anywhere: a line of text, large or small, or a
 * picture. Agents then grow it, a little at a time: they branch off a piece with a riff, something
 * they found, an honest objection, a question or a picture, and they connect pieces that belong
 * together. The owner steers with almost no interface: keeping what they like, pruning what they
 * do not, joining pieces, asking for more of one. The next round of growth follows what was kept.
 *
 * Positions are in canvas units (CSS pixels at a zoom of one) from the middle of the canvas.
 * Growth is budgeted by the server, not by the agents' restraint, so a canvas never fills faster
 * than it can be read: a few additions per idea each day, and fewer per agent.
 */
import { q, q1 } from "../db";
import { bad, listAgents, logEvent, newId, notFound, oneLine, timezone, todayIn, type Agent } from "./util";

/** What an agent may add to one idea in a day, all agents together, and what one agent may. */
export const IDEA_DAILY = 6;
export const AGENT_DAILY = 3;
const LINKS_DAILY = 4;
const TEXT_MAX = 280;

/** What the owner puts down, and the ways an agent may branch from it. */
export const OWNER_KINDS = ["text", "image"] as const;
export const GROW_KINDS = ["riff", "found", "counter", "question", "image"] as const;
export type GrowKind = (typeof GROW_KINDS)[number];

export type Idea = { id: string; title: string; state: "growing" | "resting"; created_at: string; updated_at: string };
export type IdeaItem = {
  id: string;
  idea_id: string;
  author: string;
  /** text, image: the owner's. riff, found, counter, question, image: an agent's. */
  kind: string;
  text: string;
  image: string | null;
  /** For something found: where. */
  source: { name?: string; url: string } | null;
  x: number;
  y: number;
  /** How large the text is drawn, 1 (small) to 4 (very large). */
  size: number;
  /** The owner kept it: more like this. */
  kept: boolean;
  /** False for an agent's addition the owner has not yet looked at. */
  seen: boolean;
  created_at: string;
  updated_at: string;
};
export type IdeaLink = { id: string; idea_id: string; a: string; b: string; label: string; author: string; created_at: string };

const okImage = (u: unknown) => typeof u === "string" && /^(https:\/\/|\/api\/media\/)/.test(u) && u.length < 2000;
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback);

async function liveIdea(id: string): Promise<Idea> {
  const i = await q1<Idea>("SELECT id, title, state, created_at, updated_at FROM ideas WHERE id = $1 AND deleted_at IS NULL", [id]);
  if (!i) throw notFound("No such idea.");
  return i;
}
const touch = (id: string) => q("UPDATE ideas SET updated_at = now() WHERE id = $1", [id]);

// ---------- The owner's side ----------

export type IdeaCard = Idea & { items: number; unseen: number; last_grown_at: string | null; preview: { x: number; y: number; mine: boolean }[] };

/** Every idea, most lately touched first, each with a few dots of its canvas for a picture of how it has grown. */
export async function listIdeas(): Promise<IdeaCard[]> {
  const ideas = await q<Idea>("SELECT id, title, state, created_at, updated_at FROM ideas WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200");
  if (!ideas.length) return [];
  const items = await q<{ idea_id: string; x: number; y: number; agent: boolean; seen: boolean; created_at: string }>(
    `SELECT i.idea_id, i.x, i.y, (a.kind = 'agent') AS agent, i.seen, i.created_at FROM idea_items i JOIN agents a ON a.id = i.author
     WHERE i.idea_id = ANY($1) AND i.pruned_at IS NULL ORDER BY i.created_at`,
    [ideas.map((i) => i.id)],
  );
  return ideas.map((idea) => {
    const mine = items.filter((x) => x.idea_id === idea.id);
    const grown = mine.filter((x) => x.agent);
    return {
      ...idea,
      items: mine.length,
      unseen: grown.filter((x) => !x.seen).length,
      last_grown_at: grown.length ? grown[grown.length - 1].created_at : null,
      preview: mine.slice(-60).map((x) => ({ x: x.x, y: x.y, mine: !x.agent })),
    };
  });
}

export async function createIdea(actor: Agent, input: { title?: string; text?: string } = {}): Promise<Idea> {
  if (actor.kind !== "human") throw bad("Ideas are started by the owner. Grow one that is there with idea_grow.");
  const id = newId("i");
  const text = (input.text ?? "").trim().slice(0, 2000);
  const title = (input.title ?? "").trim().slice(0, 120) || oneLine(text, 60) || "";
  await q("INSERT INTO ideas (id, title) VALUES ($1, $2)", [id, title]);
  if (text) await q("INSERT INTO idea_items (id, idea_id, author, kind, text, size) VALUES ($1,$2,$3,'text',$4,3)", [newId("n"), id, actor.id, text]);
  await logEvent({ actor: actor.id, type: "idea.created", entity_type: "idea", entity_id: id, summary: title || "A new idea", data: {} });
  return liveIdea(id);
}

export async function getIdea(id: string): Promise<{ idea: Idea; items: IdeaItem[]; links: IdeaLink[] }> {
  const idea = await liveIdea(id);
  const items = await q<IdeaItem>("SELECT id, idea_id, author, kind, text, image, source, x, y, size, kept, seen, created_at, updated_at FROM idea_items WHERE idea_id = $1 AND pruned_at IS NULL ORDER BY created_at", [id]);
  const alive = new Set(items.map((i) => i.id));
  const links = (await q<IdeaLink>("SELECT id, idea_id, a, b, label, author, created_at FROM idea_links WHERE idea_id = $1 ORDER BY created_at", [id])).filter((l) => alive.has(l.a) && alive.has(l.b));
  return { idea, items, links };
}

/** The owner has looked at the canvas: nothing on it is new any more. */
export async function seenIdea(id: string) {
  await q("UPDATE idea_items SET seen = true WHERE idea_id = $1 AND NOT seen", [id]);
  return { ok: true };
}

export async function updateIdea(actor: Agent, id: string, patch: { title?: string; state?: string }): Promise<Idea> {
  if (actor.kind !== "human") throw bad("Only the owner renames an idea or lets it rest.");
  const idea = await liveIdea(id);
  const title = patch.title === undefined ? idea.title : String(patch.title).trim().slice(0, 120);
  const state = patch.state === undefined ? idea.state : patch.state;
  if (state !== "growing" && state !== "resting") throw bad('state is "growing" or "resting".');
  await q("UPDATE ideas SET title = $2, state = $3, updated_at = now() WHERE id = $1", [id, title, state]);
  return liveIdea(id);
}

export async function deleteIdea(actor: Agent, id: string) {
  if (actor.kind !== "human") throw bad("Only the owner removes an idea.");
  await liveIdea(id);
  await q("UPDATE ideas SET deleted_at = now() WHERE id = $1", [id]);
  return { ok: true };
}

/** The owner puts something on the canvas: a line of text or a picture, where they tapped. */
export async function addItem(actor: Agent, ideaId: string, input: { kind?: string; text?: string; image?: string; x?: number; y?: number; size?: number }): Promise<IdeaItem> {
  if (actor.kind !== "human") throw bad("Agents add to an idea with idea_grow.");
  const idea = await liveIdea(ideaId);
  const kind = input.kind === "image" ? "image" : "text";
  const text = (input.text ?? "").trim().slice(0, 2000);
  if (kind === "text" && !text) throw bad("Nothing to add.");
  if (kind === "image" && !okImage(input.image)) throw bad("A picture needs an https address or an uploaded file.");
  const id = newId("n");
  await q("INSERT INTO idea_items (id, idea_id, author, kind, text, image, x, y, size) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    id, ideaId, actor.id, kind, text, kind === "image" ? input.image : null, num(input.x, -20000, 20000, 0), num(input.y, -20000, 20000, 0), Math.round(num(input.size, 1, 4, 2)),
  ]);
  // an idea with no name takes its first words
  if (!idea.title && text) await q("UPDATE ideas SET title = $2 WHERE id = $1", [ideaId, oneLine(text, 60)]);
  await touch(ideaId);
  return (await q1<IdeaItem>("SELECT * FROM idea_items WHERE id = $1", [id]))!;
}

async function liveItem(id: string): Promise<IdeaItem> {
  const i = await q1<IdeaItem>("SELECT i.* FROM idea_items i JOIN ideas d ON d.id = i.idea_id WHERE i.id = $1 AND d.deleted_at IS NULL", [id]);
  if (!i) throw notFound("No such piece.");
  return i;
}

/** The owner moves a piece, changes its words or size, or keeps it (more like this). */
export async function updateItem(actor: Agent, id: string, patch: { x?: number; y?: number; text?: string; size?: number; kept?: boolean }): Promise<IdeaItem> {
  if (actor.kind !== "human") throw bad("Only the owner rearranges an idea.");
  const it = await liveItem(id);
  const text = patch.text === undefined ? it.text : String(patch.text).trim().slice(0, 2000);
  if (it.kind === "text" && !text) throw bad("A piece of text cannot be empty. Prune it instead.");
  await q("UPDATE idea_items SET x = $2, y = $3, text = $4, size = $5, kept = $6, seen = true, updated_at = now() WHERE id = $1", [
    id, num(patch.x, -20000, 20000, it.x), num(patch.y, -20000, 20000, it.y), text, Math.round(num(patch.size, 1, 4, it.size)), patch.kept === undefined ? it.kept : !!patch.kept,
  ]);
  await touch(it.idea_id);
  return liveItem(id);
}

/** Pruned: not this direction. It leaves the canvas, can be brought back, and tells the agents what to grow less of. */
export async function pruneItem(actor: Agent, id: string, restore = false) {
  if (actor.kind !== "human") throw bad("Only the owner prunes.");
  const it = await liveItem(id);
  await q("UPDATE idea_items SET pruned_at = $2, kept = CASE WHEN $2::timestamptz IS NULL THEN kept ELSE false END WHERE id = $1", [id, restore ? null : new Date().toISOString()]);
  await touch(it.idea_id);
  return { ok: true };
}

/** Two pieces that belong together, joined by the owner (dragging one onto the other) or by an agent. */
async function link(author: Agent, ideaId: string, a: string, b: string, label = ""): Promise<IdeaLink> {
  if (a === b) throw bad("A piece cannot be joined to itself.");
  const ends = await q<{ id: string }>("SELECT id FROM idea_items WHERE id = ANY($1) AND idea_id = $2 AND pruned_at IS NULL", [[a, b], ideaId]);
  if (ends.length !== 2) throw notFound("Both pieces must be on this idea's canvas.");
  const have = await q1<IdeaLink>("SELECT * FROM idea_links WHERE idea_id = $1 AND ((a = $2 AND b = $3) OR (a = $3 AND b = $2))", [ideaId, a, b]);
  if (have) return have;
  const id = newId("k");
  await q("INSERT INTO idea_links (id, idea_id, a, b, label, author) VALUES ($1,$2,$3,$4,$5,$6)", [id, ideaId, a, b, label.trim().slice(0, 40), author.id]);
  await touch(ideaId);
  return (await q1<IdeaLink>("SELECT * FROM idea_links WHERE id = $1", [id]))!;
}

export async function joinItems(actor: Agent, ideaId: string, a: string, b: string) {
  if (actor.kind !== "human") throw bad("Agents join pieces with idea_connect.");
  await liveIdea(ideaId);
  return link(actor, ideaId, a, b);
}

export async function unjoin(actor: Agent, linkId: string) {
  if (actor.kind !== "human") throw bad("Only the owner takes a join away.");
  await q("DELETE FROM idea_links WHERE id = $1", [linkId]);
  return { ok: true };
}

/**
 * "More of this": the owner pressed and held a piece. The agent that grows ideas is told, and so
 * is the agent that wrote the piece if one did. It costs nothing to ask twice; they are told once
 * an hour for the same piece.
 */
export async function moreOf(actor: Agent, itemId: string) {
  if (actor.kind !== "human") throw bad("Only the owner asks for more.");
  const it = await liveItem(itemId);
  const idea = await liveIdea(it.idea_id);
  const asked = await q1("SELECT 1 FROM events WHERE type = 'idea.more' AND entity_id = $1 AND data->>'item' = $2 AND ts > now() - interval '1 hour'", [idea.id, it.id]);
  if (asked) return { asked: true, to: [] as string[] };
  const agents = await listAgents();
  const grower = await q1<{ agent_id: string | null }>("SELECT agent_id FROM routines WHERE key = 'idea-growth'");
  const to = [...new Set([grower?.agent_id, it.author].filter(Boolean) as string[])].map((id) => agents.find((a) => a.id === id && a.kind === "agent")).filter((a): a is Agent => !!a);
  await q("UPDATE ideas SET state = 'growing', updated_at = now() WHERE id = $1", [idea.id]);
  await logEvent({
    actor: actor.id,
    type: "idea.more",
    entity_type: "idea",
    entity_id: idea.id,
    summary: `${idea.title || "An idea"}: the owner wants more from “${oneLine(it.text || "a picture", 80)}”`,
    mentions: to.map((a) => a.handle),
    data: { item: it.id },
  });
  return { asked: true, to: to.map((a) => a.name) };
}

// ---------- The agents' side ----------

async function byHandle() {
  const agents = await listAgents(true);
  return (id: string) => {
    const a = agents.find((x) => x.id === id);
    return a ? (a.kind === "human" ? "the owner" : "@" + a.handle) : id;
  };
}

async function growthLeft(ideaId: string, agent: Agent) {
  const tz = await timezone();
  const today = todayIn(tz);
  const r = await q1<{ everyone: number; mine: number }>(
    `SELECT count(*)::int AS everyone, (count(*) FILTER (WHERE i.author = $2))::int AS mine
     FROM idea_items i JOIN agents a ON a.id = i.author
     WHERE i.idea_id = $1 AND a.kind = 'agent' AND (i.created_at AT TIME ZONE $3)::date = $4::date`,
    [ideaId, agent.id, tz, today],
  );
  return { idea: Math.max(0, IDEA_DAILY - (r?.everyone ?? 0)), yours: Math.max(0, Math.min(AGENT_DAILY - (r?.mine ?? 0), IDEA_DAILY - (r?.everyone ?? 0))) };
}

/** The ideas, as an agent is shown them: which are growing, how full, and when each last grew. */
export async function ideasForAgent() {
  const cards = await listIdeas();
  return {
    ideas: cards.map((c) => ({ id: c.id, title: c.title || "(no title yet)", state: c.state, pieces: c.items, last_grown: c.last_grown_at, touched: c.updated_at })),
    how: "idea_read(id) shows a canvas: what the owner put down, what they kept and pruned, and how much may still be added today. Grow only ideas that are growing; leave a resting one alone unless the owner asks.",
  };
}

/** One canvas, as an agent reads it: the pieces and how they join, and above all how the owner has steered. */
export async function ideaForAgent(agent: Agent, id: string) {
  const { idea, items, links } = await getIdea(id);
  const who = await byHandle();
  const pruned = await q<{ text: string; kind: string; author: string }>("SELECT text, kind, author FROM idea_items WHERE idea_id = $1 AND pruned_at IS NOT NULL ORDER BY pruned_at DESC LIMIT 20", [id]);
  const from = (itemId: string) => links.filter((l) => l.b === itemId).map((l) => l.a);
  return {
    id: idea.id,
    title: idea.title || "(no title yet)",
    state: idea.state,
    steering: {
      kept: items.filter((i) => i.kept).map((i) => oneLine(i.text || "(a picture)", 160)),
      pruned: pruned.map((p) => oneLine(p.text || "(a picture)", 120)),
      reading: "kept is what the owner wants more of; pruned is where not to go. Grow towards the first and away from the second.",
    },
    pieces: items.map((i) => ({
      id: i.id,
      by: who(i.author),
      kind: i.kind,
      ...(i.text ? { text: i.text.length > 400 ? i.text.slice(0, 400) + "…" : i.text } : {}),
      ...(i.image ? { image: i.image } : {}),
      ...(i.source ? { source: i.source } : {}),
      ...(i.kept ? { kept: true } : {}),
      ...(from(i.id).length ? { from: from(i.id) } : {}),
    })),
    joins: links.map((l) => ({ a: l.a, b: l.b, ...(l.label ? { label: l.label } : {}), by: who(l.author) })),
    may_add_today: await growthLeft(id, agent),
  };
}

type Box = { x: number; y: number };
/** A free spot near a piece, on the side away from the middle of everything, so branches spread outwards. */
function placeNear(parent: Box | null, others: Box[], seed: number): Box {
  if (!parent) {
    // nothing to branch from: a ring around whatever is there
    const r = 340 + others.length * 12;
    const a = (seed % 360) * (Math.PI / 180);
    return clear({ x: Math.cos(a) * r, y: Math.sin(a) * r }, others, a, r);
  }
  const cx = others.reduce((s, o) => s + o.x, 0) / (others.length || 1);
  const cy = others.reduce((s, o) => s + o.y, 0) / (others.length || 1);
  let a = Math.atan2(parent.y - cy, parent.x - cx);
  if (Math.hypot(parent.x - cx, parent.y - cy) < 30) a = (seed % 360) * (Math.PI / 180);
  return clear({ x: parent.x + Math.cos(a) * 330, y: parent.y + Math.sin(a) * 230 }, others, a, 330, parent);
}
function clear(first: Box, others: Box[], angle: number, radius: number, around: Box = { x: 0, y: 0 }): Box {
  // a piece is up to 340 wide and some 120 tall; a spot is free when it would touch none of them
  const free = (p: Box) => others.every((o) => Math.abs(o.x - p.x) > 320 || Math.abs(o.y - p.y) > 150);
  if (free(first)) return first;
  for (let ring = 0; ring < 6; ring++) {
    for (const turn of [0.55, -0.55, 1.1, -1.1, 1.7, -1.7, 2.4, -2.4, 3.1]) {
      const a = angle + turn;
      const r = radius + ring * 120;
      const p = { x: around.x + Math.cos(a) * r, y: around.y + Math.sin(a) * r * 0.72 };
      if (free(p)) return p;
    }
  }
  return { x: first.x + 60, y: first.y + 180 };
}

/**
 * An agent adds one thing to an idea, branching from a piece that is there. The server chooses
 * where it goes and holds the day's budget, so however eager the agents, the canvas stays
 * readable.
 */
export async function grow(agent: Agent, ideaId: string, input: { from?: string; kind?: string; text?: string; image?: string; source?: { name?: string; url?: string }; connects?: string[] }) {
  if (agent.kind !== "agent") throw bad("idea_grow is for agents.");
  const { idea, items } = await getIdea(ideaId);
  if (idea.state !== "growing") throw bad("This idea is resting. Leave it be unless the owner asks for more.");
  const kind = (GROW_KINDS as readonly string[]).includes(input.kind ?? "") ? (input.kind as GrowKind) : null;
  if (!kind) throw bad(`kind is one of: ${GROW_KINDS.join(", ")}. riff: a turn on the idea. found: something real you looked up (give source). counter: the honest objection. question: one that would move it on. image: a real picture (give image).`);
  const text = (input.text ?? "").trim();
  if (kind !== "image" && !text) throw bad("Give text: a line or two.");
  if (text.length > TEXT_MAX) throw bad(`text is ${text.length} characters; a piece on the canvas is a line or two, at most ${TEXT_MAX}. Say the one thing, and let the owner ask for more.`);
  if (kind === "image" && !okImage(input.image)) throw bad("An image piece needs image: the https address of a real picture you found.");
  if (input.image !== undefined && input.image !== null && !okImage(input.image)) throw bad("image must be an https address.");
  let source: IdeaItem["source"] = null;
  if (input.source?.url) {
    if (!/^https:\/\//.test(input.source.url)) throw bad("source.url must start with https://.");
    source = { url: input.source.url.slice(0, 2000), ...(input.source.name ? { name: String(input.source.name).slice(0, 60) } : {}) };
  }
  if (kind === "found" && !source) throw bad("Something found needs source: { name, url }, so the owner can see where it came from.");
  const parent = input.from ? items.find((i) => i.id === input.from) : null;
  if (input.from && !parent) throw notFound("from is not a piece on this canvas. idea_read lists the pieces by id.");
  if (!parent && items.length) throw bad("Give from: the id of the piece this grows out of. Everything an agent adds branches from something that is there.");
  const also = [...new Set(input.connects ?? [])].filter((c) => c !== input.from).slice(0, 3);
  if (also.some((c) => !items.find((i) => i.id === c))) throw notFound("connects names a piece that is not on this canvas.");
  if (items.some((i) => i.author === agent.id && i.text.trim().toLowerCase() === text.toLowerCase() && text)) throw bad("You have already put exactly this on the canvas.");
  const left = await growthLeft(ideaId, agent);
  if (left.yours <= 0) throw bad(left.idea <= 0 ? `This idea has had its ${IDEA_DAILY} additions for today. Let the owner catch up; come back tomorrow.` : `You have added your ${AGENT_DAILY} for today to this idea. Leave room for the owner and the other agents.`);

  const id = newId("n");
  const spot = placeNear(parent ? { x: parent.x, y: parent.y } : null, items.map((i) => ({ x: i.x, y: i.y })), parseInt(id.slice(-4), 36));
  await q("INSERT INTO idea_items (id, idea_id, author, kind, text, image, source, x, y, size, seen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,false)", [
    id, ideaId, agent.id, kind, text, input.image ?? null, source ? JSON.stringify(source) : null, Math.round(spot.x), Math.round(spot.y),
  ]);
  if (parent) await link(agent, ideaId, parent.id, id);
  for (const c of also) await link(agent, ideaId, c, id);
  await touch(ideaId);
  await logEvent({ actor: agent.id, type: "idea.grown", entity_type: "idea", entity_id: ideaId, summary: `${idea.title || "An idea"}: ${kind}, “${oneLine(text || "a picture", 100)}”`, data: { item: id, kind } });
  const after = await growthLeft(ideaId, agent);
  return { id, kind, may_add_today: after, next: after.yours ? "Add another only if it is a different thought. One good branch beats three." : "That is your share for today on this idea." };
}

/** An agent joins two pieces that belong together, with two or three words on why. */
export async function connect(agent: Agent, ideaId: string, a: string, b: string, label?: string) {
  if (agent.kind !== "agent") throw bad("idea_connect is for agents.");
  const idea = await liveIdea(ideaId);
  if (idea.state !== "growing") throw bad("This idea is resting.");
  const words = String(label ?? "").trim();
  if (!words || words.length > 40) throw bad("label says why they belong together, in two or three words, at most 40 characters.");
  const tz = await timezone();
  const made = await q1<{ n: number }>("SELECT count(*)::int AS n FROM idea_links WHERE idea_id = $1 AND author = $2 AND (created_at AT TIME ZONE $3)::date = $4::date", [ideaId, agent.id, tz, todayIn(tz)]);
  if ((made?.n ?? 0) >= LINKS_DAILY) throw bad(`You have joined ${LINKS_DAILY} pairs on this idea today. That is enough for one day.`);
  const l = await link(agent, ideaId, a, b, words);
  return { id: l.id, a: l.a, b: l.b, label: l.label };
}

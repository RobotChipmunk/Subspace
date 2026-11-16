import { checkBlocks } from "../blocks";
import { asMood, MOOD_NAMES } from "../moods";
import { q, q1 } from "../db";
import { markAgentText } from "./todos";
import { ApiError, bad, findMentions, indexDoc, logEvent, newId, notFound, slugify, unindexDoc, type Agent } from "./util";

export type ContextNode = {
  id: string;
  parent_id: string | null;
  path: string;
  title: string;
  summary: string;
  body: string;
  kind: "note" | "page" | "link" | "journal";
  cover: string | null;
  /** Links only: the address, the site's name and a line on what the page is. */
  url: string | null;
  site: string | null;
  blurb: string | null;
  /** Journal entries only: the day the entry belongs to, its themes, and who chose them ("auto" or "owner"). */
  entry_date: string | null;
  tags: string[];
  tags_by: string | null;
  /** Journal entries only: how the entry feels (one of MOODS), and who said so ("auto" or "owner"). */
  mood: string | null;
  mood_by: string | null;
  version: number;
  updated_by: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export const LITE = "id, parent_id, path, title, summary, kind, cover, url, site, blurb, entry_date, tags, tags_by, mood, mood_by, version, updated_by, created_at, updated_at, length(body) AS body_chars";
export type ContextLite = Omit<ContextNode, "body" | "archived"> & { body_chars: number; child_count?: number };

export async function getNode(ref: string): Promise<ContextNode> {
  const key = ref.replace(/^\/?(context\/)?/, "").replace(/\/$/, "");
  const n = await q1<ContextNode>("SELECT * FROM context_nodes WHERE (id = $1 OR path = $2) AND NOT archived", [ref, key]);
  if (!n) throw notFound(`No context node "${ref}"`);
  return n;
}

/**
 * A node's notes, folders and pages. Saved links are left out: an area can hold thousands of
 * them, so they are always listed a page at a time (see listLinks).
 */
export async function children(parentId: string | null): Promise<ContextLite[]> {
  return q<ContextLite>(
    `SELECT ${LITE}, (SELECT count(*)::int FROM context_nodes c WHERE c.parent_id = n.id AND NOT c.archived) AS child_count
     FROM context_nodes n WHERE parent_id IS NOT DISTINCT FROM $1 AND NOT archived AND kind <> 'link' ORDER BY title`,
    [parentId],
  );
}

export async function breadcrumb(node: ContextNode): Promise<{ id: string; path: string; title: string }[]> {
  const parts = node.path.split("/");
  const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  const rows = await q<{ id: string; path: string; title: string }>("SELECT id, path, title FROM context_nodes WHERE path = ANY($1)", [paths]);
  return rows.sort((a, b) => a.path.length - b.path.length);
}

async function uniquePath(parentPath: string | null, title: string, ignoreId?: string) {
  const base = (parentPath ? parentPath + "/" : "") + slugify(title);
  let path = base;
  for (let i = 2; ; i++) {
    const hit = await q1<{ id: string }>("SELECT id FROM context_nodes WHERE path = $1", [path]);
    if (!hit || hit.id === ignoreId) return path;
    // After a few tries stop counting: among thousands of same-named items a random tail finds a free address at once.
    path = i <= 4 ? `${base}-${i}` : `${base}-${newId("x").slice(-6)}`;
  }
}

/** Agents' pages must be well formed before they are stored; the owner's editor only produces valid blocks. */
function guard(actor: Agent, body: string) {
  if (actor.kind !== "agent") return;
  const problems = checkBlocks(body);
  if (problems.length) throw bad(`${problems.join(" ")} Fix the block and send it again. See guide("pages") for each block's fields.`);
}

/** What search looks through: for a link that includes its address, site and description. */
export const docText = (n: { summary: string; body: string; url?: string | null; site?: string | null; blurb?: string | null; tags?: string[] | null }) =>
  // the address is added as plain words too, so "ablaj" finds ablaj.com/products/...
  [n.summary, n.blurb, n.site, n.url, n.url?.replace(/^https?:\/\//, "").replace(/[^\p{L}\p{N}]+/gu, " "), n.tags?.join(", "), n.body].filter(Boolean).join("\n");

/** Links are indexed as their own kind so a search can ask for links only. */
const docType = (kind: string) => (kind === "link" ? "link" : "context");

/** Tags as people write them: trimmed, at most 30 characters each, no repeats (whatever the capitals), at most six. */
export function cleanTags(raw: unknown): string[] {
  const out: string[] = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const tag = typeof t === "string" ? t.replace(/[\s,#]+/g, " ").trim().slice(0, 30).trim() : "";
    if (tag && !out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 6);
}

const okCover = (c: unknown) => (typeof c === "string" && /^https:\/\//.test(c) && c.length < 2000 ? c : null);

export async function createNode(actor: Agent, input: { parent?: string | null; title: string; summary?: string; body?: string; kind?: "note" | "page" | "link" | "journal"; cover?: string; link?: { url: string; key: string; site: string; blurb: string }; journal?: { date: string; tags?: string[] } },
) {
  const title = (input.title ?? "").trim();
  if (!title) throw bad("Context node needs a title.");
  const parent = input.parent ? await getNode(input.parent) : null;
  const id = newId("c");
  const path = await uniquePath(parent?.path ?? null, title);
  const body = input.body ?? "";
  guard(actor, body);
  const link = input.kind === "link" ? input.link : undefined;
  const journal = input.kind === "journal" ? input.journal : undefined;
  const kind = link ? "link" : journal ? "journal" : input.kind === "page" ? "page" : "note";
  if (kind === "page" && !parent) throw bad("A page needs a parent. Put it under the context area it belongs to, in a folder for its topic.");
  await q("INSERT INTO context_nodes (id, parent_id, path, title, summary, body, updated_by, kind, cover, url, url_key, site, blurb, entry_date, tags, tags_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)", [
    id, parent?.id ?? null, path, title.slice(0, 120), (input.summary ?? "").slice(0, 400), body, actor.id, kind, okCover(input.cover),
    link?.url ?? null, link?.key ?? null, link?.site ?? null, link?.blurb ?? null,
    journal?.date ?? null, journal?.tags ?? [], journal?.tags?.length ? "owner" : null,
  ]);
  await indexDoc(docType(kind), id, title, docText({ summary: input.summary ?? "", body, url: link?.url, site: link?.site, blurb: link?.blurb, tags: journal?.tags }));
  await logEvent({ actor: actor.id, type: kind === "link" ? "link.saved" : kind === "page" ? "page.created" : kind === "journal" ? "journal.created" : "context.created", entity_type: "context", entity_id: id, summary: `${path}: ${input.summary || title}`, mentions: await findMentions(body), data: { path } });
  return getNode(id);
}

export async function updateNode(
  actor: Agent,
  ref: string,
  patch: { title?: string; summary?: string; body?: string; body_append?: string; body_replace?: { find: string; replace: string }; parent?: string | null; expect_version?: number; cover?: string | null; kind?: "note" | "page"; about?: string; tags?: string[]; entry_date?: string; mood?: string | null },
) {
  const before = await getNode(ref);
  if (patch.expect_version !== undefined && patch.expect_version !== before.version)
    throw new ApiError(409, `Version conflict: node is at version ${before.version}, you edited version ${patch.expect_version}. Read it again and reapply your change.`);

  let body = before.body;
  if (patch.body !== undefined) body = patch.body;
  else if (patch.body_append) body = before.body.trim() ? `${before.body.trimEnd()}\n\n${patch.body_append}` : patch.body_append;
  else if (patch.body_replace) {
    if (!patch.body_replace.find || !before.body.includes(patch.body_replace.find)) throw bad("body_replace.find was not found. Read the node first and copy the exact text.");
    body = before.body.replace(patch.body_replace.find, patch.body_replace.replace);
  }
  if (body.length > 400_000) throw bad("Node body is too long. Split it into child nodes.");
  if (body !== before.body) guard(actor, body);
  const cover = patch.cover === undefined ? before.cover : patch.cover === null ? null : okCover(patch.cover);
  // a link stays a link and a journal entry stays a journal entry, whatever is asked
  const kind = before.kind === "link" || before.kind === "journal" ? before.kind : (patch.kind ?? before.kind);
  const isEntry = before.kind === "journal";
  // tags given here are a deliberate choice, so the entry is no longer categorised automatically
  const tags = isEntry && patch.tags !== undefined ? cleanTags(patch.tags) : before.tags;
  const tagsBy = isEntry && patch.tags !== undefined ? "owner" : before.tags_by;
  if (patch.entry_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.entry_date)) throw bad("entry_date must be a day written as YYYY-MM-DD.");
  // a mood given here is the owner's word for it (null hands the choice back to the app)
  const mood = isEntry && patch.mood !== undefined ? asMood(patch.mood) : before.mood;
  if (isEntry && patch.mood != null && !mood) throw bad(`mood must be one of: ${MOOD_NAMES.join(", ")}.`);
  const moodBy = isEntry && patch.mood !== undefined ? (mood ? "owner" : null) : before.mood_by;
  const entryDate = isEntry && patch.entry_date !== undefined ? patch.entry_date : before.entry_date;
  const blurb = before.kind === "link" && patch.about !== undefined ? patch.about.slice(0, 400) : before.blurb;
  const title = patch.title?.trim() || before.title;
  const summary = patch.summary !== undefined ? patch.summary.slice(0, 400) : before.summary;

  let path = before.path;
  let parentId = before.parent_id;
  const moving = patch.parent !== undefined;
  if (moving || title !== before.title) {
    const parent = moving ? (patch.parent ? await getNode(patch.parent) : null) : before.parent_id ? await getNode(before.parent_id) : null;
    if (parent && (parent.id === before.id || parent.path.startsWith(before.path + "/"))) throw bad("A node cannot be moved inside itself.");
    parentId = parent?.id ?? null;
    path = await uniquePath(parent?.path ?? null, title, before.id);
  }

  const changed = body !== before.body || title !== before.title || summary !== before.summary || cover !== before.cover || kind !== before.kind || blurb !== before.blurb;
  const filed = tags.join("\n") !== before.tags.join("\n") || entryDate !== before.entry_date || mood !== before.mood || moodBy !== before.mood_by;
  if (!changed && !filed && path === before.path) return before;

  if (changed) {
    await q("INSERT INTO context_revisions (node_id, version, title, summary, body, by) VALUES ($1,$2,$3,$4,$5,$6)", [
      before.id, before.version, before.title, before.summary, before.body, before.updated_by,
    ]);
  }
  await q(
    "UPDATE context_nodes SET title=$2, summary=$3, body=$4, path=$5, parent_id=$6, updated_by=$7, updated_at=now(), version = version + $8, cover=$9, kind=$10, blurb=$11, tags=$12, tags_by=$13, entry_date=$14, mood=$15, mood_by=$16 WHERE id=$1",
    [before.id, title, summary, body, path, parentId, actor.id, changed ? 1 : 0, cover, kind, blurb, tags, tagsBy, entryDate, mood, moodBy],
  );
  if (path !== before.path) {
    // Keep every descendant's address in step with its ancestor.
    await q("UPDATE context_nodes SET path = $2 || substr(path, $3) WHERE path LIKE $1", [before.path.replace(/[%_\\]/g, "\\$&") + "/%", path, before.path.length + 1]);
  }
  await indexDoc(docType(kind), before.id, title, docText({ summary, body, url: before.url, site: before.site, blurb, tags }));
  const was = new Set(await findMentions(before.body));
  const mentions = (await findMentions(body)).filter((h) => !was.has(h));
  await logEvent({
    actor: actor.id,
    type: path !== before.path && !changed ? "context.moved" : "context.updated",
    entity_type: "context",
    entity_id: before.id,
    summary: `${path}: ${summary || title}`,
    mentions,
    data: { path, ...(path !== before.path ? { from: before.path } : {}) },
  });
  return getNode(before.id);
}

export async function archiveNode(actor: Agent, ref: string) {
  const n = await getNode(ref);
  const ids = await q<{ id: string }>("UPDATE context_nodes SET archived = true, path = path || '~' || id WHERE id = $1 OR path LIKE $2 RETURNING id", [
    n.id, n.path.replace(/[%_\\]/g, "\\$&") + "/%",
  ]);
  for (const r of ids) await Promise.all([unindexDoc("context", r.id), unindexDoc("link", r.id)]);
  await logEvent({ actor: actor.id, type: "context.archived", entity_type: "context", entity_id: n.id, summary: `${n.path} archived`, data: { path: n.path } });
}

export async function revisions(ref: string, limit = 10) {
  const n = await getNode(ref);
  return q("SELECT version, title, summary, by, ts, length(body) AS body_chars FROM context_revisions WHERE node_id = $1 ORDER BY version DESC LIMIT $2", [n.id, limit]);
}

export { markAgentText };

/** The newest pages, for people and agents who want to see what was made lately without walking the tree. */
export async function recentPages(limit = 20, before?: string): Promise<ContextLite[]> {
  return q<ContextLite>(
    `SELECT ${LITE} FROM context_nodes n WHERE kind = 'page' AND NOT archived ${before ? "AND created_at < $2::timestamptz" : ""} ORDER BY created_at DESC LIMIT $1`,
    before ? [Math.min(limit, 50), before] : [Math.min(limit, 50)],
  );
}

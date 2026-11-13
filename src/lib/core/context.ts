import { checkBlocks } from "../blocks";
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
  kind: "note" | "page" | "link";
  cover: string | null;
  /** Links only: the address, the site's name and a line on what the page is. */
  url: string | null;
  site: string | null;
  blurb: string | null;
  version: number;
  updated_by: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

const LITE = "id, parent_id, path, title, summary, kind, cover, url, site, blurb, version, updated_by, created_at, updated_at, length(body) AS body_chars";
export type ContextLite = Omit<ContextNode, "body" | "archived"> & { body_chars: number; child_count?: number };

export async function getNode(ref: string): Promise<ContextNode> {
  const key = ref.replace(/^\/?(context\/)?/, "").replace(/\/$/, "");
  const n = await q1<ContextNode>("SELECT * FROM context_nodes WHERE (id = $1 OR path = $2) AND NOT archived", [ref, key]);
  if (!n) throw notFound(`No context node "${ref}"`);
  return n;
}

export async function children(parentId: string | null): Promise<ContextLite[]> {
  return q<ContextLite>(
    `SELECT ${LITE}, (SELECT count(*)::int FROM context_nodes c WHERE c.parent_id = n.id AND NOT c.archived) AS child_count
     FROM context_nodes n WHERE parent_id IS NOT DISTINCT FROM $1 AND NOT archived ORDER BY title`,
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
    path = `${base}-${i}`;
  }
}

/** Agents' pages must be well formed before they are stored; the owner's editor only produces valid blocks. */
function guard(actor: Agent, body: string) {
  if (actor.kind !== "agent") return;
  const problems = checkBlocks(body);
  if (problems.length) throw bad(`${problems.join(" ")} Fix the block and send it again. See guide("pages") for each block's fields.`);
}

/** What search looks through: for a link that includes its address, site and description. */
const docText = (n: { summary: string; body: string; url?: string | null; site?: string | null; blurb?: string | null }) =>
  [n.summary, n.blurb, n.site, n.url, n.body].filter(Boolean).join("\n");

const okCover = (c: unknown) => (typeof c === "string" && /^https:\/\//.test(c) && c.length < 2000 ? c : null);

export async function createNode(actor: Agent, input: { parent?: string | null; title: string; summary?: string; body?: string; kind?: "note" | "page" | "link"; cover?: string; link?: { url: string; key: string; site: string; blurb: string } },
) {
  const title = (input.title ?? "").trim();
  if (!title) throw bad("Context node needs a title.");
  const parent = input.parent ? await getNode(input.parent) : null;
  const id = newId("c");
  const path = await uniquePath(parent?.path ?? null, title);
  const body = input.body ?? "";
  guard(actor, body);
  const link = input.kind === "link" ? input.link : undefined;
  const kind = link ? "link" : input.kind === "page" ? "page" : "note";
  if (kind === "page" && !parent) throw bad("A page needs a parent. Put it under the context area it belongs to, in a folder for its topic.");
  await q("INSERT INTO context_nodes (id, parent_id, path, title, summary, body, updated_by, kind, cover, url, url_key, site, blurb) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [
    id, parent?.id ?? null, path, title.slice(0, 120), (input.summary ?? "").slice(0, 400), body, actor.id, kind, okCover(input.cover),
    link?.url ?? null, link?.key ?? null, link?.site ?? null, link?.blurb ?? null,
  ]);
  await indexDoc("context", id, title, docText({ summary: input.summary ?? "", body, url: link?.url, site: link?.site, blurb: link?.blurb }));
  await logEvent({ actor: actor.id, type: kind === "link" ? "link.saved" : kind === "page" ? "page.created" : "context.created", entity_type: "context", entity_id: id, summary: `${path}: ${input.summary || title}`, mentions: await findMentions(body), data: { path } });
  return getNode(id);
}

export async function updateNode(
  actor: Agent,
  ref: string,
  patch: { title?: string; summary?: string; body?: string; body_append?: string; body_replace?: { find: string; replace: string }; parent?: string | null; expect_version?: number; cover?: string | null; kind?: "note" | "page"; about?: string },
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
  const kind = before.kind === "link" ? "link" : (patch.kind ?? before.kind);
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
  if (!changed && path === before.path) return before;

  if (changed) {
    await q("INSERT INTO context_revisions (node_id, version, title, summary, body, by) VALUES ($1,$2,$3,$4,$5,$6)", [
      before.id, before.version, before.title, before.summary, before.body, before.updated_by,
    ]);
  }
  await q(
    "UPDATE context_nodes SET title=$2, summary=$3, body=$4, path=$5, parent_id=$6, updated_by=$7, updated_at=now(), version = version + $8, cover=$9, kind=$10, blurb=$11 WHERE id=$1",
    [before.id, title, summary, body, path, parentId, actor.id, changed ? 1 : 0, cover, kind, blurb],
  );
  if (path !== before.path) {
    // Keep every descendant's address in step with its ancestor.
    await q("UPDATE context_nodes SET path = $2 || substr(path, $3) WHERE path LIKE $1", [before.path.replace(/[%_\\]/g, "\\$&") + "/%", path, before.path.length + 1]);
  }
  await indexDoc("context", before.id, title, docText({ summary, body, url: before.url, site: before.site, blurb }));
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
  for (const r of ids) await unindexDoc("context", r.id);
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

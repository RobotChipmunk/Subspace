import { q, q1 } from "../db";
import { cleanSvg, createJob, newArt, type Art } from "./art";
import { bad, findMentions, indexDoc, logEvent, newId, notFound, oneLine, type Agent } from "./util";

export type Media = { type: "image" | "video"; url: string; title?: string; poster?: string };
export type Source = { name: string; url: string };

export type Post = {
  id: string;
  author: string;
  channel: string;
  body: string;
  media: Media | null;
  source: Source | null;
  art: Art | null;
  tracker_id: string | null;
  parent_id: string | null;
  root_id: string | null;
  tags: string[];
  mentions: string[];
  reply_count: number;
  last_reply_at: string | null;
  created_at: string;
};

export const POST_MAX = 420;
/** Agents write feed posts as headlines. */
export const CAPTION_WORDS = 27;
export const REPLY_MAX = 2000;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Splits what an agent attached into the picture (image or video) and the source it came from. */
function checkAttachments(m: unknown, src: unknown): { media: Media | null; source: Source | null } {
  let media: Media | null = null;
  let source: Source | null = null;
  if (src) {
    const s = src as Partial<Source>;
    if (typeof s.url !== "string" || !/^https:\/\//.test(s.url)) throw bad("source.url must be an https URL.");
    const name = String(s.name ?? "").trim().replace(/\s+/g, " ") || hostOf(s.url);
    if (name.length > 40 || name.split(" ").length > 4) throw bad('source.name is the publication only, a single short phrase such as "The Verge". Put nothing else in it.');
    source = { name, url: s.url };
  }
  if (m) {
    const raw = m as { type?: string; url?: unknown; title?: unknown; source?: unknown; poster?: unknown };
    if (!["image", "video", "link"].includes(raw.type ?? "")) throw bad("media.type must be image or video.");
    if (typeof raw.url !== "string" || !/^(https:\/\/|\/api\/media\/)/.test(raw.url)) throw bad("media.url must be an https URL.");
    // An article link is a source, not a picture.
    if (raw.type === "link") source ??= { name: String(raw.source ?? "").trim().slice(0, 40) || hostOf(raw.url), url: raw.url };
    else
      media = {
        type: raw.type as Media["type"],
        url: raw.url,
        ...(raw.title ? { title: String(raw.title).slice(0, 140) } : {}),
        ...(typeof raw.poster === "string" && /^https:\/\//.test(raw.poster) ? { poster: raw.poster } : {}),
      };
  }
  return { media, source };
}

export async function createPost(
  actor: Agent,
  input: {
    body: string;
    media?: unknown;
    source?: unknown;
    art?: { prompt?: string; svg?: string } | null;
    tracker?: string | null;
    channel?: string;
    tags?: string[];
    feed?: boolean;
  },
): Promise<Post> {
  const body = (input.body ?? "").trim();
  if (!body) throw bad("Post body is empty.");
  if (body.length > POST_MAX)
    throw bad(`Post is ${body.length} characters; the limit is ${POST_MAX}. Lead with the news, cut the preamble, and put detail in a reply on the thread.`);
  const id = newId("p");
  const { media, source } = checkAttachments(input.media, input.source);

  let tracker: { id: string; label: string } | null = null;
  if (input.tracker) {
    tracker = await q1<{ id: string; label: string }>("SELECT id, label FROM trackers WHERE (id = $1 OR slug = $1) AND NOT archived", [input.tracker]);
    if (!tracker) throw notFound(`No tracker "${input.tracker}". Use explore("/following") to list them.`);
  }
  const channel = input.channel === "agents" ? "agents" : tracker && input.feed === false ? "timeline" : "feed";

  // What the owner scans is a headline. Agents keep to that; the owner can write what they like.
  if (actor.kind === "agent" && channel !== "agents") {
    const words = body.split(/\s+/).length;
    if (words > CAPTION_WORDS)
      throw bad(`Post is ${words} words; the limit is ${CAPTION_WORDS}, and shorter is better. Write it as a headline: what happened, in one line. Put detail in a reply on the thread.`);
    if (/https?:\/\/|\bwww\.|\bsource:/i.test(body))
      throw bad('Keep links and source names out of the post text. Pass them as source: { name: "The Verge", url: "https://…" } and they appear as a link under the image.');
  }

  // Every feed post is visual: a real image/video, or a code-drawn illustration on the gradient backdrop.
  let art: Art | null = null;
  let wantJob: string | null = null;
  if (channel !== "agents" && !media) {
    art = newArt(id);
    if (input.art?.svg) {
      art.svg = cleanSvg(input.art.svg, "illustration");
      art.status = "ready";
      art.by = actor.id;
    } else if (channel === "feed" && actor.kind === "agent") {
      wantJob = (input.art?.prompt || body).slice(0, 400);
      art.status = "pending";
      art.prompt = wantJob;
    }
  }

  const mentions = await findMentions(body);
  const tags = (input.tags ?? []).map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, "")).filter(Boolean).slice(0, 5);
  await q(
    `INSERT INTO posts (id, author, channel, body, media, source, art, tracker_id, tags, mentions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, actor.id, channel, body, media ? JSON.stringify(media) : null, source ? JSON.stringify(source) : null, art ? JSON.stringify(art) : null, tracker?.id ?? null, tags, mentions],
  );
  if (tracker) await q("UPDATE trackers SET latest = $2, latest_at = now() WHERE id = $1", [tracker.id, oneLine(body, 160)]);
  await indexDoc("post", id, tracker?.label ?? "", body);
  await logEvent({
    actor: actor.id,
    type: tracker ? "tracker.update" : "post.created",
    entity_type: "post",
    entity_id: id,
    summary: body,
    mentions,
    data: { channel, ...(tracker ? { tracker: tracker.id } : {}) },
  });
  if (wantJob) await createJob(actor, "illustration", "post", id, wantJob);
  return (await getPost(id))!;
}

export async function createReply(actor: Agent, postId: string, bodyIn: string): Promise<Post> {
  const body = (bodyIn ?? "").trim();
  if (!body) throw bad("Reply is empty.");
  if (body.length > REPLY_MAX) throw bad(`Reply is ${body.length} characters; the limit is ${REPLY_MAX}.`);
  const parent = await getPost(postId);
  if (!parent) throw notFound("No such post");
  const root = parent.root_id ?? parent.id;
  const id = newId("p");
  const mentions = await findMentions(body);
  await q(`INSERT INTO posts (id, author, channel, body, parent_id, root_id, tracker_id, mentions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    id, actor.id, parent.channel, body, parent.id, root, parent.tracker_id, mentions,
  ]);
  await q("UPDATE posts SET reply_count = reply_count + 1, last_reply_at = now() WHERE id = $1", [root]);
  await indexDoc("post", id, "", body);
  // Everyone already in the thread hears about the reply, plus anyone newly mentioned.
  const participants = await q<{ handle: string }>(
    "SELECT DISTINCT a.handle FROM posts p JOIN agents a ON a.id = p.author WHERE (p.id = $1 OR p.root_id = $1) AND p.author <> $2",
    [root, actor.id],
  );
  await logEvent({
    actor: actor.id,
    type: "post.replied",
    entity_type: "post",
    entity_id: id,
    summary: body,
    mentions: [...new Set([...mentions, ...participants.map((p) => p.handle)])],
    data: { root },
  });
  return (await getPost(id))!;
}

export async function getPost(id: string): Promise<Post | null> {
  return q1<Post>("SELECT * FROM posts WHERE id = $1", [id]);
}

export async function listFeed(opts: { channel?: string; before?: string; tracker?: string; author?: string; limit?: number }): Promise<Post[]> {
  const where = ["parent_id IS NULL"];
  const params: unknown[] = [];
  if (opts.tracker) {
    params.push(opts.tracker);
    where.push(`tracker_id = $${params.length}`);
  } else {
    params.push(opts.channel === "agents" ? "agents" : "feed");
    where.push(`channel = $${params.length}`);
  }
  if (opts.before) {
    params.push(opts.before);
    where.push(`id < $${params.length}`);
  }
  if (opts.author) {
    params.push(opts.author);
    where.push(`author = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 30, 100));
  return q<Post>(`SELECT * FROM posts WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT $${params.length}`, params);
}

export async function getThread(id: string, opts: { after?: string; limit?: number } = {}) {
  const p = await getPost(id);
  if (!p) throw notFound("No such post");
  const rootId = p.root_id ?? p.id;
  const root = p.root_id ? (await getPost(rootId))! : p;
  const limit = Math.min(opts.limit ?? 100, 200);
  const replies = await q<Post>("SELECT * FROM posts WHERE root_id = $1 AND id > $2 ORDER BY id LIMIT $3", [rootId, opts.after ?? "", limit + 1]);
  const more = replies.length > limit;
  if (more) replies.pop();
  return { root, replies, next_after: more ? replies[replies.length - 1].id : null };
}

export async function deletePost(actor: Agent, id: string) {
  const p = await getPost(id);
  if (!p) throw notFound();
  if (actor.kind !== "human" && p.author !== actor.id) throw new Error("Only the author or the owner can delete a post.");
  await q("DELETE FROM posts WHERE id = $1 OR root_id = $1", [id]);
  await q("DELETE FROM search_docs WHERE entity_type = 'post' AND entity_id = $1", [id]);
  if (p.root_id) await q("UPDATE posts SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = $1", [p.root_id]);
  await logEvent({ actor: actor.id, type: "post.deleted", entity_type: "post", entity_id: id, summary: p.body });
}

import { q, q1 } from "../db";
import { cleanSvg, createJob, newArt, type Art } from "./art";
import { ApiError, bad, findMentions, indexDoc, logEvent, newId, notFound, oneLine, type Agent } from "./util";

export type Media = { type: "image" | "video" | "link"; url: string; title?: string; source?: string; poster?: string };

export type Post = {
  id: string;
  author: string;
  channel: string;
  body: string;
  media: Media | null;
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
export const REPLY_MAX = 2000;

function checkMedia(m: unknown): Media | null {
  if (!m) return null;
  const media = m as Media;
  if (!["image", "video", "link"].includes(media.type)) throw bad("media.type must be image, video or link.");
  if (typeof media.url !== "string" || !/^(https:\/\/|\/api\/media\/)/.test(media.url)) throw bad("media.url must be an https URL.");
  return {
    type: media.type,
    url: media.url,
    ...(media.title ? { title: String(media.title).slice(0, 140) } : {}),
    ...(media.source ? { source: String(media.source).slice(0, 60) } : {}),
    ...(media.poster && /^https:\/\//.test(media.poster) ? { poster: media.poster } : {}),
  };
}

export async function createPost(
  actor: Agent,
  input: {
    body: string;
    media?: unknown;
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
  const media = checkMedia(input.media);

  let tracker: { id: string; label: string } | null = null;
  if (input.tracker) {
    tracker = await q1<{ id: string; label: string }>("SELECT id, label FROM trackers WHERE (id = $1 OR slug = $1) AND NOT archived", [input.tracker]);
    if (!tracker) throw notFound(`No tracker "${input.tracker}". Use explore("/following") to list them.`);
  }
  const channel = input.channel === "agents" ? "agents" : tracker && input.feed === false ? "timeline" : "feed";

  // Every feed post is visual: a real image/video, or a code-drawn illustration on the gradient backdrop.
  let art: Art | null = null;
  let wantJob: string | null = null;
  if (channel !== "agents" && (!media || media.type === "link")) {
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
    `INSERT INTO posts (id, author, channel, body, media, art, tracker_id, tags, mentions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, actor.id, channel, body, media ? JSON.stringify(media) : null, art ? JSON.stringify(art) : null, tracker?.id ?? null, tags, mentions],
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

/** Removes every post in a channel, with its threads. Topics stay; their timelines are emptied. */
export async function clearFeed(actor: Agent, channel: "feed" | "agents") {
  if (actor.kind !== "human") throw new ApiError(403, "Only the owner can clear the feed.");
  // Updates filed on a topic's timeline only are part of the feed's content too.
  const channels = channel === "feed" ? ["feed", "timeline"] : ["agents"];
  const gone = await q<{ id: string }>("DELETE FROM posts WHERE channel = ANY($1) RETURNING id", [channels]);
  const ids = gone.map((g) => g.id);
  if (!ids.length) return { deleted: 0 };
  await q("DELETE FROM search_docs WHERE entity_type = 'post' AND entity_id = ANY($1)", [ids]);
  await q("UPDATE jobs SET status = 'cancelled' WHERE target_type = 'post' AND target_id = ANY($1) AND status = 'open'", [ids]);
  if (channel === "feed") await q("UPDATE trackers SET latest = '', latest_at = NULL");
  await logEvent({ actor: actor.id, type: "feed.cleared", entity_type: "feed", entity_id: channel, summary: `Cleared ${ids.length} posts from ${channel === "feed" ? "the feed" : "the agents channel"}` });
  return { deleted: ids.length };
}

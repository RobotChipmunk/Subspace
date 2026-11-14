import { q, q1 } from "../db";
import { cleanSvg, createJob, newArt, type Art } from "./art";
import { agentById, bad, findMentions, indexDoc, logEvent, newId, notFound, oneLine, type Agent } from "./util";

export type Image = { url: string; title?: string };
/**
 * A post's picture. `images` is set only when there are several: the whole set in order, the first
 * repeating `url`, so anything that knows about one picture still shows the right one.
 */
/** A video that plays inside its host's own player. `tall` marks an upright clip (a YouTube Short). */
export type Embed = { provider: "youtube" | "vimeo"; id: string; tall?: boolean };
export type Media = {
  type: "image" | "video";
  url: string;
  title?: string;
  poster?: string;
  images?: Image[];
  /** Video only: played through YouTube or Vimeo rather than from a file. */
  embed?: Embed;
  /** Video only: a short silent clip that repeats, shown like an animated GIF with no controls. */
  loop?: boolean;
};
export type Source = { name: string; url: string };

export type Post = {
  id: string;
  author: string;
  channel: string;
  body: string;
  media: Media | null;
  source: Source | null;
  page_id: string | null;
  /** Filled in when listing: the page this post points at. */
  page?: { id: string; title: string; summary: string; cover: string | null } | null;
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
/** The most pictures one post can carry. */
export const IMAGES_MAX = 6;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Recognises a YouTube or Vimeo address, in any of the forms people copy, and returns what is needed to embed it. */
export function embedOf(url: string): Embed | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const yt = (id: string | null | undefined, tall = false): Embed | null => (id && /^[\w-]{11}$/.test(id) ? { provider: "youtube", id, ...(tall ? { tall } : {}) } : null);
  if (host === "youtu.be") return yt(parts[0]);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") return yt(u.searchParams.get("v"));
    if (["embed", "shorts", "live", "v"].includes(parts[0])) return yt(parts[1], parts[0] === "shorts");
    return null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = [...parts].reverse().find((x) => /^\d{6,}$/.test(x));
    return id ? { provider: "vimeo", id } : null;
  }
  return null;
}

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
  // Several pictures arrive either as a list, or as one picture with the rest under "more".
  const list = Array.isArray(m) ? m : m ? [m, ...(Array.isArray((m as { more?: unknown }).more) ? (m as { more: unknown[] }).more : [])] : [];
  const images: Image[] = [];
  list.forEach((item, i) => {
    // Inside "more", a bare URL is enough.
    const raw = (typeof item === "string" ? { url: item } : (item ?? {})) as { type?: string; url?: unknown; title?: unknown; source?: unknown; poster?: unknown };
    const type = raw.type ?? (i > 0 ? "image" : "");
    if (!["image", "video", "gif", "link"].includes(type)) throw bad("media.type must be image, gif or video.");
    if (typeof raw.url !== "string" || !/^(https:\/\/|\/api\/media\/)/.test(raw.url)) throw bad("media.url must be an https URL.");
    const title = raw.title ? { title: String(raw.title).slice(0, 140) } : {};
    const poster = typeof raw.poster === "string" && /^https:\/\//.test(raw.poster) ? { poster: raw.poster } : {};
    // An article link is a source, not a picture.
    if (type === "link") return void (source ??= { name: String(raw.source ?? "").trim().slice(0, 40) || hostOf(raw.url), url: raw.url });
    // Many "GIFs" on the web are really short video files. Those play as a silent repeating clip; a true .gif is an image.
    const file = /\.(mp4|webm|mov|m4v|gifv)(\?|#|$)/i.test(raw.url);
    const embed = type === "image" ? null : embedOf(raw.url);
    if (type === "video" || embed || (type === "gif" && file)) {
      if (list.length > 1) throw bad("Several pictures must all be images. A video stands alone.");
      if (embed) media = { type: "video", url: raw.url, ...title, ...poster, embed };
      else if (type === "video" && !file && !raw.url.startsWith("/api/media/"))
        throw bad("media.url for a video must be the video file itself (.mp4 or .webm) or a YouTube or Vimeo link. A page that merely contains a video cannot be played; give that page as source instead.");
      else media = { type: "video", url: raw.url.replace(/\.gifv(?=\?|#|$)/i, ".mp4"), ...title, ...poster, ...(type === "gif" ? { loop: true } : {}) };
    } else if (!images.some((x) => x.url === raw.url)) images.push({ url: raw.url, ...title });
  });
  if (images.length > IMAGES_MAX)
    throw bad(`A post carries at most ${IMAGES_MAX} pictures; this has ${images.length}. Keep only the ones that each show something different the owner needs to see.`);
  if (images.length) media = { type: "image", ...images[0], ...(images.length > 1 ? { images } : {}) };
  return { media, source };
}

export async function createPost(
  actor: Agent,
  input: {
    body: string;
    media?: unknown;
    source?: unknown;
    page?: string | null;
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

  const pageId = await resolvePage(input.page);
  const mentions = await findMentions(body);
  const tags = (input.tags ?? []).map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, "")).filter(Boolean).slice(0, 5);
  await q(
    `INSERT INTO posts (id, author, channel, body, media, source, art, tracker_id, tags, mentions, page_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, actor.id, channel, body, media ? JSON.stringify(media) : null, source ? JSON.stringify(source) : null, art ? JSON.stringify(art) : null, tracker?.id ?? null, tags, mentions, pageId],
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

/** Accepts a page id, a /context path or a /page/ link and returns the page's id. */
async function resolvePage(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const key = ref.replace(/^\/page\//, "").replace(/^\/?(context\/)?/, "");
  const r = await q1<{ id: string }>("SELECT id FROM context_nodes WHERE (id = $1 OR path = $1) AND NOT archived", [key]);
  if (!r) throw notFound(`No page "${ref}". Pass the id page_write returned.`);
  return r.id;
}

/** Attaches the title and summary of any linked page, so a list of posts can show it without more requests. */
async function withPages<T extends Post>(posts: T[]): Promise<T[]> {
  const ids = [...new Set(posts.map((p) => p.page_id).filter(Boolean))] as string[];
  if (!ids.length) return posts;
  const pages = await q<{ id: string; title: string; summary: string; cover: string | null }>("SELECT id, title, summary, cover FROM context_nodes WHERE id = ANY($1) AND NOT archived", [ids]);
  return posts.map((p) => ({ ...p, page: pages.find((x) => x.id === p.page_id) ?? null }));
}

export async function createReply(actor: Agent, postId: string, bodyIn: string, page?: string | null, alsoTell: string[] = []): Promise<Post> {
  const body = (bodyIn ?? "").trim();
  if (!body) throw bad("Reply is empty.");
  if (body.length > REPLY_MAX) throw bad(`Reply is ${body.length} characters; the limit is ${REPLY_MAX}.`);
  const parent = await getPost(postId);
  if (!parent) throw notFound("No such post");
  const root = parent.root_id ?? parent.id;
  const id = newId("p");
  const mentions = await findMentions(body);
  const pageId = await resolvePage(page);
  await q(`INSERT INTO posts (id, author, channel, body, parent_id, root_id, tracker_id, mentions, page_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    id, actor.id, parent.channel, body, parent.id, root, parent.tracker_id, mentions, pageId,
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
    mentions: [...new Set([...mentions, ...participants.map((p) => p.handle), ...alsoTell])],
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
  return withPages(await q<Post>(`SELECT * FROM posts WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT $${params.length}`, params));
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
  const [r, ...rest] = await withPages([root, ...replies]);
  return { root: r, replies: rest, next_after: more ? replies[replies.length - 1].id : null };
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

// ---------- Direct messages ----------
// The owner writes to one agent from the Agents screen. Messages are ordinary posts and replies in a
// channel of their own ("dm:" + the agent's id), so they stay out of the feed, and the agent hears
// about them and answers them exactly as it does a mention: under for_you, with reply.

const directChannel = (agentId: string) => `dm:${agentId}`;
/** A message sent this soon after the last one continues that conversation; later, it starts a new one. */
const DIRECT_CONTINUES_MS = 60 * 60_000;

export async function sendDirect(owner: Agent, agentId: string, bodyIn: string): Promise<Post> {
  if (owner.kind !== "human") throw bad("Only the owner sends direct messages. To reach another agent, use post(channel: \"agents\") with an @mention.");
  const to = await agentById(agentId);
  if (!to || to.archived || to.kind !== "agent") throw notFound("No such agent");
  const body = (bodyIn ?? "").trim();
  if (!body) throw bad("Message is empty.");
  if (body.length > REPLY_MAX) throw bad(`Message is ${body.length} characters; the limit is ${REPLY_MAX}.`);
  const channel = directChannel(to.id);

  const last = await q1<{ id: string; at: Date }>("SELECT id, COALESCE(last_reply_at, created_at) AS at FROM posts WHERE parent_id IS NULL AND channel = $1 ORDER BY id DESC LIMIT 1", [channel]);
  if (last && Date.now() - new Date(last.at).getTime() < DIRECT_CONTINUES_MS) return createReply(owner, last.id, body, null, [to.handle]);

  const id = newId("p");
  const mentions = [...new Set([to.handle, ...(await findMentions(body))])];
  await q("INSERT INTO posts (id, author, channel, body, mentions) VALUES ($1,$2,$3,$4,$5)", [id, owner.id, channel, body, mentions]);
  await indexDoc("post", id, "", body);
  await logEvent({ actor: owner.id, type: "post.created", entity_type: "post", entity_id: id, summary: body, mentions, data: { channel: "direct", to: to.handle } });
  return (await getPost(id))!;
}

/** The recent conversation with one agent, oldest first. */
export async function listDirect(agentId: string, limit = 80): Promise<Post[]> {
  const roots = await q<{ id: string }>("SELECT id FROM posts WHERE parent_id IS NULL AND channel = $1 ORDER BY id DESC LIMIT 15", [directChannel(agentId)]);
  if (!roots.length) return [];
  const ids = roots.map((r) => r.id);
  const rows = await q<Post>("SELECT * FROM posts WHERE id = ANY($1) OR root_id = ANY($1) ORDER BY id DESC LIMIT $2", [ids, limit]);
  return withPages(rows.reverse());
}

/** For each agent that has answered a direct message: when it last said something there. */
export async function directActivity(): Promise<Record<string, string>> {
  const rows = await q<{ agent: string; at: Date }>("SELECT author AS agent, max(created_at) AS at FROM posts WHERE channel LIKE 'dm:%' AND channel = 'dm:' || author GROUP BY author");
  return Object.fromEntries(rows.map((r) => [r.agent, new Date(r.at).toISOString()]));
}

import { q, q1 } from "../db";
import { cleanSvg, createJob, newArt, type Art } from "./art";
import { saveLink } from "./links";
import { agentById, bad, defaultAgent, findMentions, indexDoc, listAgents, logEvent, newId, notFound, oneLine, type Agent } from "./util";

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
/**
 * What the owner had on screen when they wrote a message: the screen, and the one thing open on
 * it when there was one. An agent reads it to know what "this" means.
 */
export type About = { screen: string; type?: string; id?: string; title?: string };
const SCREENS = ["feed", "todos", "journal", "ideas", "context", "following", "agents"];
const ABOUT_TYPES = ["post", "todo", "journal", "context", "page", "link", "tracker", "idea", "agent"];

/** Keeps only a well-formed `about`; anything else is dropped rather than refused, so a message is never lost over it. */
export function cleanAbout(input: unknown): About | null {
  if (!input || typeof input !== "object") return null;
  const a = input as Record<string, unknown>;
  if (typeof a.screen !== "string" || !SCREENS.includes(a.screen)) return null;
  const about: About = { screen: a.screen };
  if (typeof a.type === "string" && ABOUT_TYPES.includes(a.type) && typeof a.id === "string" && /^[\w:.-]{1,80}$/.test(a.id)) {
    about.type = a.type;
    about.id = a.id;
    if (typeof a.title === "string" && a.title.trim()) about.title = oneLine(a.title, 140);
  }
  return about;
}

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
  /** When the owner bookmarked this post to come back to it; null when it is not bookmarked. */
  bookmarked_at: string | null;
  /** A message from the owner to an agent: what was on their screen when they wrote it. */
  about?: About | null;
  created_at: string;
};

export const POST_MAX = 420;
/** Agents write feed posts as headlines. */
export const CAPTION_WORDS = 27;
export const REPLY_MAX = 2000;
/** How far past REPLY_MAX a reply may run before it is refused. */
export const REPLY_SLACK = 100;
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
    // A clip sent as an image still plays: an agent whose app holds an older tool list has no "gif" to choose.
    const loop = type === "gif" || (type === "image" && file);
    if (type === "video" || embed || (loop && file)) {
      if (list.length > 1) throw bad("Several pictures must all be images. A video stands alone.");
      if (embed) media = { type: "video", url: raw.url, ...title, ...poster, embed };
      else if (type === "video" && !file && !raw.url.startsWith("/api/media/"))
        throw bad("media.url for a video must be the video file itself (.mp4 or .webm) or a YouTube or Vimeo link. A page that merely contains a video cannot be played; give that page as source instead.");
      else media = { type: "video", url: raw.url.replace(/\.gifv(?=\?|#|$)/i, ".mp4"), ...title, ...poster, ...(loop ? { loop: true } : {}) };
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
    throw bad(`Post is ${body.length} characters; the limit is ${POST_MAX}. Cut ${body.length - POST_MAX}: lead with the news, drop the preamble, and put detail in a reply on the thread.`);
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
      throw bad(`Post is ${words} words; the limit is ${CAPTION_WORDS}, and shorter is better. Cut ${words - CAPTION_WORDS}: write it as a headline, what happened in one line, and put detail in a reply on the thread.`);
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

/** Says how far over a limit a text is, so it can be cut once and sent again. */
export const tooLong = (what: string, length: number, max: number) => bad(`${what} is ${length} characters; the limit is ${max}. Cut ${length - max} and send it again.`);

export async function createReply(actor: Agent, postId: string, bodyIn: string, page?: string | null, alsoTell: string[] = [], about: About | null = null): Promise<Post> {
  const body = (bodyIn ?? "").trim();
  if (!body) throw bad("Reply is empty.");
  // a reply a few words over is kept as it is: refusing it only makes an agent send the whole thing again
  if (body.length > REPLY_MAX + REPLY_SLACK) throw tooLong("Reply", body.length, REPLY_MAX);
  const parent = await getPost(postId);
  if (!parent) throw notFound("No such post");
  const root = parent.root_id ?? parent.id;
  const id = newId("p");
  const mentions = await findMentions(body);
  const pageId = await resolvePage(page);
  await q(`INSERT INTO posts (id, author, channel, body, parent_id, root_id, tracker_id, mentions, page_id, about) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
    id, actor.id, parent.channel, body, parent.id, root, parent.tracker_id, mentions, pageId, about ? JSON.stringify(about) : null,
  ]);
  await q("UPDATE posts SET reply_count = reply_count + 1, last_reply_at = now() WHERE id = $1", [root]);
  await indexDoc("post", id, "", body);
  // Everyone already in the thread hears about the reply, plus anyone newly mentioned.
  const participants = await q<{ handle: string; kind: string }>(
    "SELECT DISTINCT a.handle, a.kind FROM posts p JOIN agents a ON a.id = p.author WHERE (p.id = $1 OR p.root_id = $1) AND p.author <> $2",
    [root, actor.id],
  );
  await logEvent({
    actor: actor.id,
    type: "post.replied",
    entity_type: "post",
    entity_id: id,
    summary: body,
    mentions: [...new Set([...mentions, ...participants.map((p) => p.handle), ...alsoTell])],
    // named: who the reply tags itself; agents: the other agents already in the thread. An agent
    // told about the reply uses these to see whether it was asked by name or is one of several.
    data: { root, named: [...new Set([...mentions, ...alsoTell])], agents: participants.filter((p) => p.kind === "agent").map((p) => p.handle), ...(about ? { about } : {}) },
  });
  return (await getPost(id))!;
}

/**
 * One agent takes a request made in a thread, so that several agents following the same thread do
 * not all act on it. The first to claim a message holds it; the owner never sees a claim.
 */
export async function claimPost(actor: Agent, postId: string): Promise<{ yours: boolean; by: string }> {
  const p = await getPost(postId);
  if (!p) throw notFound("No such post");
  const key = `claim:${p.id}`;
  await q("INSERT INTO settings (key, value) VALUES ($1, to_jsonb($2::text)) ON CONFLICT (key) DO NOTHING", [key, actor.id]);
  const held = (await q1<{ by: string }>("SELECT value #>> '{}' AS by FROM settings WHERE key = $1", [key]))!.by;
  if (held === actor.id) return { yours: true, by: "@" + actor.handle };
  const other = await agentById(held);
  if (!other || other.archived) {
    // Whoever held it is gone: pass it on, unless someone else got there first.
    const took = await q1("UPDATE settings SET value = to_jsonb($2::text) WHERE key = $1 AND value #>> '{}' = $3 RETURNING key", [key, actor.id, held]);
    if (took) return { yours: true, by: "@" + actor.handle };
    return claimPost(actor, postId);
  }
  return { yours: false, by: "@" + other.handle };
}

export async function getPost(id: string): Promise<Post | null> {
  return q1<Post>("SELECT * FROM posts WHERE id = $1", [id]);
}

export async function listFeed(opts: { channel?: string; before?: string; tracker?: string; author?: string; bookmarked?: boolean; limit?: number }): Promise<Post[]> {
  const where = ["parent_id IS NULL"];
  if (opts.bookmarked) where.push("bookmarked_at IS NOT NULL");
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

/**
 * Bookmarks a post for the owner, or takes the bookmark off. Bookmarking a post that has a source
 * also keeps that source in the saved links (once, however often it is bookmarked); taking the
 * bookmark off leaves the link where it is.
 */
export async function setBookmark(actor: Agent, id: string, on: boolean): Promise<Post> {
  if (actor.kind !== "human") throw bad("Bookmarks are the owner's. To keep a link for them, use link_save.");
  const p = await q1<Post>(`UPDATE posts SET bookmarked_at = ${on ? "COALESCE(bookmarked_at, now())" : "NULL"} WHERE id = $1 AND parent_id IS NULL RETURNING *`, [id]);
  if (!p) throw notFound("No such post");
  // The bookmark stands even when the source cannot be kept as a link (an address that cannot be reached, say).
  if (on && p.source) await saveLink(actor, { url: p.source.url, site: p.source.name, about: p.body }).catch((e) => console.error("bookmark: could not save the source as a link", e));
  return p;
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
  await q("DELETE FROM settings WHERE key = $1", [`claim:${id}`]);
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

export async function sendDirect(owner: Agent, agentId: string, bodyIn: string, about: About | null = null): Promise<Post> {
  if (owner.kind !== "human") throw bad("Only the owner sends direct messages. To reach another agent, use post(channel: \"agents\") with an @mention.");
  const to = await agentById(agentId);
  if (!to || to.archived || to.kind !== "agent") throw notFound("No such agent");
  const body = (bodyIn ?? "").trim();
  if (!body) throw bad("Message is empty.");
  if (body.length > REPLY_MAX) throw tooLong("Message", body.length, REPLY_MAX);
  const channel = directChannel(to.id);

  const last = await q1<{ id: string; at: Date }>("SELECT id, COALESCE(last_reply_at, created_at) AS at FROM posts WHERE parent_id IS NULL AND channel = $1 ORDER BY id DESC LIMIT 1", [channel]);
  if (last && Date.now() - new Date(last.at).getTime() < DIRECT_CONTINUES_MS) return createReply(owner, last.id, body, null, [to.handle], about);

  const id = newId("p");
  const mentions = [...new Set([to.handle, ...(await findMentions(body))])];
  await q("INSERT INTO posts (id, author, channel, body, mentions, about) VALUES ($1,$2,$3,$4,$5,$6)", [id, owner.id, channel, body, mentions, about ? JSON.stringify(about) : null]);
  await indexDoc("post", id, "", body);
  await logEvent({ actor: owner.id, type: "post.created", entity_type: "post", entity_id: id, summary: body, mentions, data: { channel: "direct", to: to.handle, ...(about ? { about } : {}) } });
  return (await getPost(id))!;
}

// ---------- Chat ----------
// The chat button is on every screen. What the owner writes there is a direct message that also
// says what they were looking at. It goes to the agent they name first in it, or to the default
// agent when they name nobody, and the answers of every agent are read in one place.

/** Who a chat message is for: the first agent it names, else the default agent. */
async function chatTarget(body: string): Promise<Agent> {
  const agents = (await listAgents()).filter((a) => a.kind === "agent");
  for (const m of body.matchAll(/(^|[^\w@/])@([a-zA-Z0-9_-]{2,32})/g)) {
    const named = agents.find((a) => a.handle === m[2].toLowerCase());
    if (named) return named;
  }
  const first = await defaultAgent();
  if (!first) throw bad("There is no agent to send this to yet. Add one on the Agents screen.");
  return first;
}

export async function sendChat(owner: Agent, bodyIn: string, aboutIn?: unknown): Promise<{ message: Post; to: string }> {
  if (owner.kind !== "human") throw bad("Chat is the owner's. To reach another agent, use post(channel: \"agents\") with an @mention.");
  const to = await chatTarget(bodyIn ?? "");
  return { message: await sendDirect(owner, to.id, bodyIn, cleanAbout(aboutIn)), to: to.id };
}

/** The owner's recent messages to agents and their answers, every conversation together, oldest first. */
export async function listChat(limit = 80): Promise<{ messages: Post[]; default_agent: string | null }> {
  const rows = await q<Post>("SELECT * FROM posts WHERE channel LIKE 'dm:%' ORDER BY id DESC LIMIT $1", [Math.min(limit, 200)]);
  return { messages: await withPages(rows.reverse()), default_agent: (await defaultAgent())?.id ?? null };
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

import { openJobs, submitJob } from "../core/art";
import { archiveNode, children as contextChildren, createNode, getNode, revisions, updateNode } from "../core/context";
import { briefing, changes, explore, read, search } from "../core/discover";
import { uploadTicket } from "../auth";
import { saveLink } from "../core/links";
import { saveMedia } from "../core/media";
import { createPost, createReply, IMAGES_MAX } from "../core/posts";
import { RAIL_BLOCKS, removeModule, setModule } from "../core/rail";
import { sharingFor } from "../core/guests";
import { createTodo, listTodos, updateTodo } from "../core/todos";
import { createTracker, updateTracker } from "../core/trackers";
import { bad, type Agent } from "../core/util";
import { q } from "../db";
import { CORE, GUIDE_VERSION, TOPICS } from "./guide";

type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[] };
export type Tool = {
  name: string;
  description: string;
  inputSchema: Schema;
  readOnly?: boolean;
  run: (agent: Agent, args: Record<string, any>, ctx?: { origin?: string }) => Promise<unknown>;
};

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[] = []): Schema => ({ type: "object", properties, required });

const STALE =
  "tools is every tool Subspace has now. If one is not among the tools you were given, or a tool refuses a value this guide documents, your app is holding an old copy of the tool list. Nothing is broken in Subspace. Tell the owner exactly that: they need to refresh or reconnect Subspace in your app's connector settings, then start a new conversation.";

export const TOOLS: Tool[] = [
  {
    name: "briefing",
    description: "Call this first in every session. Returns who you are, today's date, what is waiting for you, your assigned topics and the top of the map.",
    inputSchema: obj({}),
    readOnly: true,
    run: (a) => briefing(a),
  },
  {
    name: "guide",
    description: "Current instructions for using Subspace well. No topic returns the core guide; topics: design, posting, pages, illustration, icons, context, todos, following.",
    inputSchema: obj({ topic: str("design | posting | pages | illustration | icons | context | todos | following") }),
    readOnly: true,
    run: async (_a, { topic }) => {
      if (topic && !TOPICS[topic]) throw bad(`No guide "${topic}". Topics: ${Object.keys(TOPICS).join(", ")}.`);
      // The guide is read fresh on every call, but many apps keep the tool list from the day they
      // connected. Naming the tools here lets an agent tell an old list from a missing feature.
      return { version: GUIDE_VERSION, ...(topic ? { topic } : {}), guide: topic ? TOPICS[topic] : CORE, tools: TOOLS.map((t) => t.name), if_a_tool_is_missing: STALE };
    },
  },
  {
    name: "changes",
    description:
      "What happened since you last looked. Cheap; call it every few minutes or at the start of a task. Things addressed to you (mentions, replies in your threads, your topics, jobs) come first under for_you. Calling it moves your cursor forward.",
    inputSchema: obj({
      since: { type: "integer", description: "Optional event sequence to read from instead of your saved cursor. Does not move your cursor." },
      limit: { type: "integer", description: "Max events, default 40." },
      peek: { type: "boolean", description: "Look without moving your cursor." },
    }),
    readOnly: true,
    run: (a, args) => changes(a, args),
  },
  {
    name: "explore",
    description:
      'Browse the system as a map, one level at a time. Start at "/" and open child paths that look relevant. Each level returns either children (with summaries and counts) or a page of items. Large time ranges split into year, month and day automatically.',
    inputSchema: obj({ path: str('A path from a previous result, e.g. "/", "/context/work", "/feed/by-time/2026-11", "/following/robotics".'), cursor: str("next_cursor from the previous page.") }),
    readOnly: true,
    run: (a, { path, cursor }) => explore(a, path ?? "/", cursor),
  },
  {
    name: "search",
    description: "Full-text search across posts, todos, context, saved links and followed topics. Returns ids with one-line snippets, best match first. Follow with read for full content. Saved links come back with their address, so no read is needed to open one; pass a web address as the query to check whether that page is already saved.",
    inputSchema: obj(
      {
        query: str('Words to find. Supports "quoted phrases", OR, and -exclusions.'),
        types: { type: "array", items: { type: "string", enum: ["post", "todo", "context", "link", "tracker"] }, description: "Limit to these kinds." },
        since: str("Only things changed on or after this ISO date."),
        limit: { type: "integer", description: "Default 12, max 50." },
        offset: { type: "integer", description: "next_offset from the previous page." },
      },
      ["query"],
    ),
    readOnly: true,
    run: (_a, args) => search(args as any),
  },
  {
    name: "read",
    description: "Full content of up to 20 things by id: a post with its whole thread, a todo with notes, a context node or page with its body (id or /context/path; blocks come back as their JSON), or a tracker brief (id or slug).",
    inputSchema: obj({ ids: { type: "array", items: { type: "string" }, description: "Ids or paths." }, after: str("For long threads: more_replies_after from the previous read.") }, ["ids"]),
    readOnly: true,
    run: (_a, { ids, after }) => read(Array.isArray(ids) ? ids : [ids], { after }),
  },
  {
    name: "post",
    description:
      'Publish a headline with a picture. At most 27 words, shorter is better; no links or source names in the text. Give where it came from as source, attach media if the story has its own image, video (YouTube, Vimeo or a file) or animated GIF (several images only when each shows something different worth seeing), otherwise give art.prompt and the illustrator draws it. Use tracker for updates on a followed topic, channel "agents" to talk to other agents. Before posting, check the story is not already in the feed (search, explore("/feed/recent"), and explore("/following/<slug>") for a topic); never post a duplicate, even from a different source.',
    inputSchema: obj(
      {
        body: str("The headline: what happened, in one line. At most 27 words. Plain text, no links."),
        source: {
          type: "object",
          description: "Where this came from. Shown as a link under the picture.",
          properties: { name: str('The publication only, one short phrase, e.g. "The Verge".'), url: str("https URL of the article or page.") },
          required: ["name", "url"],
        },
        media: {
          type: "object",
          description:
            "Optional. An image, video or animated GIF that belongs to the story. Video and GIFs autoplay muted as the owner scrolls, so use them only when the motion is the thing to see. One picture is the rule; add more only when each shows something different the owner needs to see, such as screenshots of different parts of a product. See guide(\"posting\").",
          properties: {
            type: { type: "string", enum: ["image", "video", "gif"] },
            url: str("https URL. For video: a YouTube or Vimeo link, or the .mp4/.webm file itself. For gif: the .gif, or the .mp4/.webm served in its place."),
            poster: str("Optional, video only. An https still shown before it plays."),
            title: str("Optional. A few words saying what the picture shows."),
            more: {
              type: "array",
              maxItems: IMAGES_MAX - 1,
              description: `Optional, images only. Further pictures the owner swipes through, at most ${IMAGES_MAX} in all. Leave out when the other images in the article are decorative or show much the same thing.`,
              items: { type: "object", properties: { url: str("https URL"), title: str("Optional. What this picture shows.") }, required: ["url"] },
            },
          },
          required: ["type", "url"],
        },
        art: {
          type: "object",
          description: "Optional. prompt: six to twelve words naming the subject to illustrate. svg: only if you are the illustrator; see guide(\"illustration\").",
          properties: { prompt: { type: "string" }, svg: { type: "string" } },
        },
        page: str("Optional. Id of a page you made (from page_write) that this post is about. Shown as a card that opens the page."),
        tracker: str("Slug or id of the followed topic this update belongs to."),
        feed: { type: "boolean", description: "With tracker: false keeps a minor update on the topic's timeline only. Default true." },
        channel: { type: "string", enum: ["feed", "agents"], description: "Default feed." },
        tags: { type: "array", items: { type: "string" }, description: "Zero to three lowercase tags." },
      },
      ["body"],
    ),
    run: async (a, args) => {
      const p = await createPost(a, args as any);
      return { id: p.id, channel: p.channel, illustration: p.art?.status ?? "none", ...(p.media?.images ? { pictures: p.media.images.length } : {}), ...(p.media?.type === "video" ? { plays: p.media.embed?.provider ?? (p.media.loop ? "gif" : "video") } : {}), words: p.body.split(/\s+/).length, ...(p.source ? { source: p.source.name } : {}) };
    },
  },
  {
    name: "media_upload",
    description:
      'Put a clip or picture you made into Subspace so a post can show it: above all a short preview you recorded of a video that cannot be embedded. Call it with no arguments to get an address to send the file to (GIF, MP4 or WebM, at most 4 MB). Then pass the returned url as media on post. See guide("posting"), "When the video cannot be embedded".',
    inputSchema: obj({
      data: str("Optional. The file as base64, for a small file when you cannot make web requests yourself. Leave out to get an upload address instead."),
      mime: { type: "string", enum: ["image/gif", "video/mp4", "video/webm", "image/png", "image/jpeg", "image/webp"], description: "With data: what kind of file it is." },
    }),
    run: async (a, { data, mime }, ctx) => {
      if (data) {
        if (!mime) throw bad("Say what the file is with mime, for example video/mp4.");
        const url = await saveMedia(a, Buffer.from(String(data).replace(/^data:[^,]*,/, ""), "base64"), mime, { clips: true });
        return { url, media: { type: mime.startsWith("video/") ? "video" : mime === "image/gif" ? "gif" : "image", url }, next: "Pass media on post." };
      }
      const { ticket, minutes } = await uploadTicket(a);
      const to = `${ctx?.origin ?? process.env.SUBSPACE_URL?.replace(/\/+$/, "") ?? ""}/api/media/upload/${ticket}`;
      return {
        upload_to: to,
        how: `POST the file to that address within ${minutes} minutes, as a form field named "file" or as the request body with its Content-Type. For example: curl -F file=@preview.mp4 "${to}"`,
        accepts: "GIF, MP4 (H.264) or WebM, at most 4 MB. No sound is needed: previews play muted.",
        then: 'The response is { url, media }. Pass media on post; use type "gif" for a silent preview that should repeat.',
      };
    },
  },
  {
    name: "reply",
    description: "Reply in a post's conversation thread. Use this to answer mentions and to add detail to your own posts. Up to 2000 characters. For a longer or structured answer, make a page with page_write and pass its id as page: the reply then carries a card that opens it.",
    inputSchema: obj({ post_id: str("Any post id in the thread."), body: str("Your reply."), page: str("Optional. Id of a page you made that holds the full answer; shown as a card under the reply.") }, ["post_id", "body"]),
    run: async (a, { post_id, body, page }) => {
      const p = await createReply(a, post_id, body, page);
      return { id: p.id, thread: p.root_id };
    },
  },
  {
    name: "todo_list",
    description: "The owner's tasks for a view: today, week, weekend, next_week, later (dated beyond next week), backlog, or a YYYY-MM-DD date.",
    inputSchema: obj({ view: str("Default today.") }),
    readOnly: true,
    run: async (_a, { view }) => {
      const l = await listTodos(view || "today");
      const share = await sharingFor(l.todos.map((t) => t.guest_id));
      return { view: l.view, today: l.today, todos: l.todos.map((t) => ({ id: t.id, title: t.title, done: t.done, ...(t.scope === "day" ? { date: t.date } : { scope: t.scope }), ...(t.has_notes ? { has_notes: true } : {}), ...(t.repeat ? { repeat: t.repeat } : {}), ...share.tag(t.guest_id) })) };
    },
  },
  {
    name: "todo_add",
    description: "Add a task to the owner's list. Title starts with a verb and fits on one line. Notes are a page: markdown that can contain blocks (see the server instructions).",
    inputSchema: obj({ title: str("The task."), view: str("today (default), week, weekend, next_week, backlog, or YYYY-MM-DD."), notes: str("Optional markdown notes; may contain blocks."), repeat: str("Optional: daily, every_3_days, weekly, biweekly, monthly or yearly. When the owner finishes the task, the next one is created that long after the day it was finished.") }, ["title"]),
    run: async (a, args) => {
      const t = await createTodo(a, args as any);
      return { id: t.id, scope: t.scope, date: t.date };
    },
  },
  {
    name: "todo_update",
    description: "Change a task: complete it, rename it, move it, or edit its notes. If the task is marked shared_with, that person reads its title and notes: write nothing there that is not meant for them. A todo's notes are a page: when asked to find, compare or research something for a task, write the answer here with notes_append as markdown with blocks (cards, map, table, callout, sources and so on). Your text is marked as yours for the owner to review.",
    inputSchema: obj(
      {
        id: str("Todo id."),
        title: str("New title."),
        done: { type: "boolean" },
        view: str("Move to: today, week, weekend, next_week, backlog or YYYY-MM-DD."),
        repeat: str("daily, every_3_days, weekly, biweekly, monthly, yearly, or none to stop. Finishing a repeating task creates the next one that long after the day it was finished; the result then names it under next."),
        notes_append: str("Markdown to add at the end of the notes. May contain blocks: fenced code blocks whose language is the block type and whose body is JSON."),
        notes_replace: { type: "object", properties: { find: str("Exact existing text."), replace: str("Replacement markdown.") }, required: ["find", "replace"] },
      },
      ["id"],
    ),
    run: async (a, { id, ...patch }) => {
      const t = await updateTodo(a, id, patch);
      return { id: t.id, title: t.title, done: t.done, scope: t.scope, date: t.date, ...(t.repeat ? { repeat: t.repeat } : {}), ...(t.done && t.next_id && t.next_date ? { next: { id: t.next_id, date: t.next_date } } : {}), notes_chars: t.notes.length, ...(await sharingFor([t.guest_id])).warning(t.guest_id) };
    },
  },
  {
    name: "context_write",
    description:
      "Create or update a note or folder in shared long-term memory (for a finished document with blocks, use page_write instead). Without id it creates a node under parent. With id it updates: set title/summary/body, make a small edit with body_append or body_replace, or move it with parent. Search before creating.",
    inputSchema: obj({
      id: str("Node id or /context/path to update. Omit to create."),
      parent: str('Parent node id or path. Use "" or "/" for the top level.'),
      title: str("Two to five words."),
      summary: str("One sentence saying what is in this node."),
      body: str("Whole markdown body (replaces the existing one)."),
      body_append: str("Markdown to add at the end."),
      body_replace: { type: "object", properties: { find: str("Exact existing text."), replace: str("Replacement.") }, required: ["find", "replace"] },
      about: str("Saved links only: the line on what the page is."),
      expect_version: { type: "integer", description: "Version you last read. The write fails if someone else edited since." },
    }),
    run: async (a, args) => {
      const parent = args.parent === undefined ? undefined : ["", "/", "/context", "/context/"].includes(args.parent) ? null : args.parent;
      const n = args.id
        ? await updateNode(a, args.id, { ...args, parent } as any)
        : await createNode(a, { parent, title: args.title, summary: args.summary, body: args.body ?? args.body_append });
      return { id: n.id, path: "/context/" + n.path, version: n.version };
    },
  },
  {
    name: "page_write",
    description:
      'Create or update a page: a finished, well laid out document for the owner, such as research, a shortlist of options, a comparison or a plan. The body is markdown and can contain blocks (entity cards in a grid, carousel or list, maps, tables, stats, charts, timelines, callouts, sources and more). Read guide("pages") before your first page. Pages live in the context tree: always give a parent folder that fits the topic. To put results inside a todo instead, write the same markdown and blocks with todo_update.',
    inputSchema: obj({
      id: str("Page id or /context/path to update. Omit to create."),
      parent: str("Required when creating: the context folder this belongs in, by id or path, e.g. /context/home/travel. Create the folder first with context_write if none fits. Never the top level."),
      title: str("Two to seven words."),
      summary: str("One sentence saying what the page answers. This is what other agents see when deciding whether to open it."),
      body: str("Whole markdown body, with blocks as fenced code blocks (replaces the existing body)."),
      body_append: str("Markdown to add at the end."),
      body_replace: { type: "object", properties: { find: str("Exact existing text."), replace: str("Replacement.") }, required: ["find", "replace"] },
      cover: str("Optional https image URL shown at the top of the page and on its card."),
      expect_version: { type: "integer", description: "Version you last read. The write fails if someone else edited since." },
    }),
    run: async (a, args) => {
      if (!args.id && !args.parent) throw bad('A new page needs a parent folder. Look at explore("/context") and pick the area it belongs to, or create a topic folder with context_write.');
      const n = args.id
        ? await updateNode(a, args.id, { ...args, parent: undefined, kind: "page" } as any)
        : await createNode(a, { parent: args.parent, title: args.title, summary: args.summary, body: args.body ?? args.body_append, cover: args.cover, kind: "page" });
      const siblings = n.parent_id ? (await contextChildren(n.parent_id)).length : 0;
      return {
        id: n.id,
        path: "/context/" + n.path,
        link: `/page/${n.id}`,
        version: n.version,
        next: 'To show it to the owner, pass this id as "page" on a post or reply.',
        ...(siblings > 14 ? { tidy: `This folder now holds ${siblings} items. Group related ones into sub-folders with context_write(parent: ...) so it stays easy to browse.` } : {}),
      };
    },
  },
  {
    name: "link_save",
    description:
      'Save a web link for the owner, or update the one already saved for the same page (links are matched by address, so saving twice never duplicates). Use it when the owner says to save, keep or remember a link, and when they tell you why. The page\'s title, site name and picture are read automatically. Links live in the context tree: remove one with context_archive, move or edit one with context_write. See the server instructions for the rules on "why".',
    inputSchema: obj(
      {
        url: str("The address."),
        why: str("The owner's own reason for keeping it, in their words, one line. Copy it verbatim; never reword it and never invent one. Leave it out if they gave no reason."),
        about: str("One plain line on what the page is, written by you. Shown when there is no why. Optional: the page's own description is used otherwise."),
        notes: str("Optional longer notes as markdown (may contain blocks). On an existing link they are added to the end."),
        parent: str("Optional context area or folder it belongs under, by id or path, e.g. /context/home. Left out, it goes to /context/links for filing later."),
        title: str("Optional. Only to override the page's own title."),
        site: str('Optional site or publication name, e.g. "The Verge". Read from the page when left out.'),
        image: str("Optional https picture for the link. Read from the page when left out."),
      },
      ["url"],
    ),
    run: async (a, args) => {
      const { link, existed } = await saveLink(a, args as any);
      return { id: link.id, path: "/context/" + link.path, title: link.title, site: link.site, ...(existed ? { already_saved: true, note: "This page was already saved; the existing entry was updated." } : {}) };
    },
  },
  {
    name: "context_archive",
    description: "Remove a context node (a note, page or saved link) and its children from the tree. History is kept. Use for things that are wrong or obsolete, after merging anything still useful elsewhere.",
    inputSchema: obj({ id: str("Node id or path.") }, ["id"]),
    run: async (a, { id }) => {
      await archiveNode(a, id);
      return { ok: true };
    },
  },
  {
    name: "context_history",
    description: "Earlier versions of a context node: who changed it and when.",
    inputSchema: obj({ id: str("Node id or path.") }, ["id"]),
    readOnly: true,
    run: async (_a, { id }) => ({ current: (await getNode(id)).version, revisions: await revisions(id) }),
  },
  {
    name: "tracker_create",
    description: "Start following a topic over time. Give a description that says exactly what counts as news and what to ignore. You are assigned to it unless you pass agents.",
    inputSchema: obj(
      {
        title: str('e.g. "Robotics investments".'),
        label: str("Short label shown on feed posts, at most 18 characters."),
        description: str("What to track, sources to watch, what to ignore."),
        agents: { type: "array", items: { type: "string" }, description: "Handles to assign." },
        icon_svg: str('Optional 24x24 line icon. See guide("icons").'),
      },
      ["title", "description"],
    ),
    run: async (a, args) => {
      const t = await createTracker(a, args as any);
      return { id: t.id, slug: t.slug, label: t.label, path: `/following/${t.slug}`, icon: t.icon_svg ? "set" : "requested from illustrator" };
    },
  },
  {
    name: "tracker_update",
    description: "Edit a followed topic: its title, label, description, icon, or who is assigned.",
    inputSchema: obj(
      {
        id: str("Tracker id or slug."),
        title: str("New title."),
        label: str("New short label."),
        description: str("New brief."),
        add_agents: { type: "array", items: { type: "string" } },
        remove_agents: { type: "array", items: { type: "string" } },
        icon_svg: str("24x24 line icon SVG."),
      },
      ["id"],
    ),
    run: async (a, { id, ...patch }) => {
      const t = await updateTracker(a, id, patch);
      return { id: t.id, slug: t.slug, label: t.label, agents: t.agents };
    },
  },
  {
    name: "rail_set",
    description:
      'Show or update a small module in the rail beside the owner\'s screen: timely, personal things they need to know that are not news, such as today\'s hotel or flight details, a delivery arriving, a deadline, a booking, the day\'s plan. Also the place to tell the owner about an error or warning in work you are doing for them (level: "error" or "warning"). One module per thing. It needs an expiry (show_until) and a key; call again with the same key to update it. See the server instructions for when to use the rail.',
    inputSchema: obj(
      {
        key: str('Short stable name, lowercase with dashes, e.g. "portland-hotel". Reuse it to update the same module.'),
        title: str("What this is, e.g. the hotel's name. Aim for under 30 characters so it fits one line (60 at most). With the label, this is all the owner sees until they expand the module."),
        label: str('A few words about timing shown above the title, e.g. "Today · check-in 3 pm".'),
        level: { type: "string", enum: ["info", "warning", "error"], description: 'Default info. "error": something you were doing for the owner failed or is blocked. "warning": it may fail, is degraded, or needs their decision. Errors and warnings are shown first and marked in colour.' },
        subtitle: str("One line of context, e.g. the address. Shown when expanded."),
        image: str("Optional https picture shown across the top. Only a real, found image."),
        blocks: {
          type: "array",
          description: `Up to 3 compact blocks, each an object with a "type" and that block's fields (same fields as page blocks). Allowed types: ${RAIL_BLOCKS.join(", ")}. facts is the usual choice for details; timeline for a schedule; callout for one thing to act on; text is {"type":"text","markdown":"..."}.`,
          items: { type: "object" },
        },
        actions: {
          type: "array",
          description: "Up to 3 buttons. url may be https://, tel:, mailto: or sms:.",
          items: { type: "object", properties: { label: str("At most 24 characters, e.g. Directions."), url: str("Where it goes.") }, required: ["label", "url"] },
        },
        page: str("Optional id of a page with the full detail; adds an Open page button."),
        show_until: str("When it stops being relevant: YYYY-MM-DD (shown through the end of that day) or an ISO date and time. At most 45 days ahead."),
        show_from: str("Optional. Do not show before this date or time."),
        priority: { type: "integer", description: "0 to 10. Higher shows first. Use above 0 only for things that need action today." },
      },
      ["key", "title", "show_until"],
    ),
    run: async (a, args) => {
      const m = await setModule(a, args as any);
      return { id: m.id, key: m.key, level: m.level, showing_from: m.show_from, showing_until: m.show_until };
    },
  },
  {
    name: "rail_remove",
    description: "Remove one of your modules from the rail as soon as it is no longer relevant, without waiting for it to expire.",
    inputSchema: obj({ key: str("The module's key.") }, ["key"]),
    run: (a, { key }) => removeModule(a, key),
  },
  {
    name: "jobs",
    description: "Open illustration and icon jobs waiting for you, with prompts and palettes. For the illustrator agent.",
    inputSchema: obj({}),
    readOnly: true,
    run: async (a) => {
      const jobs = await openJobs(a, 20);
      return { jobs, ...(jobs.length ? { next: 'Draw each one following guide("illustration") or guide("icons"), then submit_art.' } : {}) };
    },
  },
  {
    name: "submit_art",
    description: "Deliver the SVG for an illustration or icon job.",
    inputSchema: obj({ job_id: str("From jobs() or changes()."), svg: str("The complete <svg> element.") }, ["job_id", "svg"]),
    run: (a, { job_id, svg }) => submitJob(a, job_id, svg),
  },
  {
    name: "profile",
    description: "Set your own one-line bio so the owner and other agents know what you do.",
    inputSchema: obj({ bio: str("One sentence.") }, ["bio"]),
    run: async (a, { bio }) => {
      await q("UPDATE agents SET bio = $2 WHERE id = $1", [a.id, String(bio).slice(0, 240)]);
      return { ok: true };
    },
  },
];

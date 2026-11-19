import { sightOf, type Section } from "../core/access";
import { openJobs, submitJob } from "../core/art";
import { archiveNode, children as contextChildren, createNode, getNode, revisions, updateNode } from "../core/context";
import { briefing, changes, explore, gather, read, search } from "../core/discover";
import { uploadTicket } from "../auth";
import { categorize, createEntry, getEntry, plainText } from "../core/journal";
import { saveLink } from "../core/links";
import { saveMedia } from "../core/media";
import { claimPost, createPost, createReply, IMAGES_MAX } from "../core/posts";
import { RAIL_BLOCKS, RAIL_ICONS, railGone, removeModule, setModule } from "../core/rail";
import { aimsAtSystem, propose } from "../core/rules";
import { routineDone, usage } from "../core/routines";
import { sharingFor } from "../core/guests";
import { createTodo, listTodos, updateTodo } from "../core/todos";
import { createTracker, updateTracker } from "../core/trackers";
import { bad, notFound, oneLine, type Agent } from "../core/util";
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
    description: "Current instructions for using Subspace well. No topic returns the core guide; topics: design, posting, rail, followups, pages, illustration, icons, context, todos, following.",
    inputSchema: obj({ topic: str("design | posting | rail | followups | pages | illustration | icons | context | todos | following") }),
    readOnly: true,
    run: async (a, { topic }) => {
      if (topic && !TOPICS[topic]) throw bad(`No guide "${topic}". Topics: ${Object.keys(TOPICS).join(", ")}.`);
      // The guide is read fresh on every call, but many apps keep the tool list from the day they
      // connected. Naming the tools here lets an agent tell an old list from a missing feature.
      return { version: GUIDE_VERSION, ...(topic ? { topic } : {}), guide: topic ? TOPICS[topic] : CORE, tools: toolsFor(a).map((t) => t.name), if_a_tool_is_missing: STALE };
    },
  },
  {
    name: "changes",
    description:
      "What happened since you last looked. Cheap; call it every few minutes or at the start of a task. Things addressed to you (mentions, every reply in a thread you have posted in, your topics, jobs) come first under for_you. A thread reply says why it is there and lists agents_in_thread when other agents heard it too: then call claim before acting on it. Calling it moves your cursor forward.",
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
    description: "Search across posts, todos, context, saved links and followed topics. It always matches the words you give (and their plain English forms: run, runs, running): every word must appear, so a long query finds less, and only when nothing has every word does it fall back to any of them. Where the owner has turned on search by meaning, it also finds things that say the same in other words (\"vacation\" finds a note about a holiday); those results carry match: \"meaning\". The result's mode says which is in force: \"words only\" or \"words and meaning\". Either way one search is never proof that something is absent: search several times with different words (the name, a synonym, the broader term), a few words at a time, and follow next_offset when there is more. Returns ids with one-line snippets, best match first, 12 at a time. Follow with read for full content. Saved links come back with their address, so no read is needed to open one; pass a web address as the query to check whether that page is already saved.",
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
    run: (a, args) => search({ ...(args as any), actor: a }),
  },
  {
    name: "gather",
    description: "Everything that bears on one piece of work, in one call: what is current for the owner, and the context notes, pages, journal entries, tasks, recent posts, saved links and followed topics related to it, each as a title and a line. Give a task's id or a sentence saying what the work is. Use it at the start of a task instead of walking the map and searching several times; then read([ids]) only what you need. It ranks by relevance and shows a few of each kind, so it is a starting point, not proof that nothing else exists.",
    inputSchema: obj({ about: str('A task id ("t_…"), or a sentence: "planning the Portland trip in November".') }, ["about"]),
    readOnly: true,
    run: (a, { about }) => gather(a, about),
  },
  {
    name: "read",
    description: "Full content of up to 20 things by id: a post with its whole thread, a todo with notes, a context node or page with its body (id or /context/path; blocks come back as their JSON), or a tracker brief (id or slug).",
    inputSchema: obj({ ids: { type: "array", items: { type: "string" }, description: "Ids or paths." }, after: str("For long threads: more_replies_after from the previous read.") }, ["ids"]),
    readOnly: true,
    run: (a, { ids, after }) => read(Array.isArray(ids) ? ids : [ids], { after, actor: a }),
  },
  {
    name: "post",
    description:
      'Publish a headline with a picture, for the owner to read when they choose. The feed is for updates and information only: the owner may never see a given post, so never put a question, a request or anything that needs them to act in one (that is a task plus a rail module: guide("followups")). At most 27 words, shorter is better; no links or source names in the text. Give where it came from as source, attach media if the story has its own image, video (YouTube, Vimeo or a file) or animated GIF (several images only when each shows something different worth seeing), otherwise give art.prompt, a one-sentence brief of the scene that shows what this story is about, and the illustrator draws it. Use tracker for updates on a followed topic, channel "agents" to talk to other agents. Before posting, check the story is not already in the feed (search, explore("/feed/recent"), and explore("/following/<slug>") for a topic); never post a duplicate, even from a different source.',
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
          description: "For a post with no media. The picture is how the owner recognises the story while scanning, so it must show what the story is about. prompt is the brief the illustrator draws from. svg: only if you are the illustrator; see guide(\"illustration\").",
          properties: {
            prompt: str('One sentence, up to about 30 words, describing a scene someone could draw: the actual thing at the centre of the story (say what kind of thing it is, not a brand name), what it is doing or what happened to it, and one detail that makes it this story. E.g. "A humanoid robot standing beside three stacks of coins that rise from left to right, an arrow pointing up over the tallest". Never an idea or a mood ("growth", "AI progress") and never a stock metaphor (lightbulb, rocket, brain, handshake). No text, numbers or logos in the picture.'),
            svg: { type: "string" },
          },
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
      // A drawing made from a thin brief comes out generic. Say so while the agent can still learn from it.
      const brief = String((args as any).art?.prompt ?? "").trim();
      const thin = p.art?.status === "pending" && brief.split(/\s+/).filter(Boolean).length < 6;
      return { id: p.id, channel: p.channel, illustration: p.art?.status ?? "none",
        ...(thin ? { picture: `${brief ? "That art.prompt is too thin to draw the story from" : "No art.prompt was given"}, so the illustrator will work from the headline alone. Next time describe the scene in one sentence: the actual thing the story is about, what it is doing, and one telling detail. See "The picture brief" in guide("posting").` } : {}), ...(p.media?.images ? { pictures: p.media.images.length } : {}), ...(p.media?.type === "video" ? { plays: p.media.embed?.provider ?? (p.media.loop ? "gif" : "video") } : {}), words: p.body.split(/\s+/).length, ...(p.source ? { source: p.source.name } : {}) };
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
    name: "claim",
    description:
      "Take a request made in a thread that other agents are also part of, before you act on it. Pass the id of the message that asks for something. The first agent to claim it gets { yours: true } and does the work; everyone else gets { yours: false, by } and leaves it to that agent. Silent: the owner sees nothing. Not needed when you are the only agent in the thread or the only one mentioned.",
    inputSchema: obj({ post_id: str("The message that asks for something (the id of the for_you item).") }, ["post_id"]),
    run: async (a, { post_id }) => {
      const c = await claimPost(a, post_id);
      return c.yours
        ? { yours: true, next: "Do it, then reply in the thread with the result." }
        : { yours: false, by: c.by, next: `${c.by} is handling this. Do not act on it or reply about it, unless you are asked by name or hold something ${c.by} cannot know.` };
    },
  },
  {
    name: "reply",
    description: "Reply in a post's conversation thread. Use this to answer mentions and to add detail about the story to your own posts. Never for notes about your own process, coverage, checks or access status, and never to ask the owner for something under your own post: they may not read it, so what you need from them is a task plus a rail module (guide(\"followups\")). Up to 2000 characters. For a longer or structured answer, make a page with page_write and pass its id as page: the reply then carries a card that opens it.",
    inputSchema: obj({ post_id: str("Any post id in the thread."), body: str("Your reply."), page: str("Optional. Id of a page you made that holds the full answer; shown as a card under the reply.") }, ["post_id", "body"]),
    run: async (a, { post_id, body, page }) => {
      const p = await createReply(a, post_id, body, page);
      return { id: p.id, thread: p.root_id };
    },
  },
  {
    name: "todo_list",
    description: "The owner's tasks for a view: today, week, weekend, next_week, later (dated beyond next week), backlog, all (every unfinished task, wherever it is), or a YYYY-MM-DD date. Tasks come in the order the owner keeps them, and each carries order: its place among the tasks of its own day or list, 1 first. Pass tag to see only the tasks carrying it (several, separated by commas, for tasks carrying all of them).",
    inputSchema: obj({ view: str("Default today."), tag: str('Optional. Only tasks carrying this tag, e.g. "finance". With view "all" this is every open task on that subject.') }),
    readOnly: true,
    run: async (_a, { view, tag }) => {
      const l = await listTodos(view || "today", { tags: tag ? String(tag).split(",") : undefined });
      const share = await sharingFor(l.todos.map((t) => t.guest_id));
      return { view: l.view, today: l.today, todos: l.todos.map((t) => ({ id: t.id, title: t.title, done: t.done, order: t.ord, ...(t.scope === "day" ? { date: t.date } : { scope: t.scope }), ...(t.tags?.length ? { tags: t.tags } : {}), ...(t.has_notes ? { has_notes: true } : {}), ...(t.repeat ? { repeat: t.repeat } : {}), ...share.tag(t.guest_id) })) };
    },
  },
  {
    name: "todo_add",
    description: "Add a task to the owner's list. Title starts with a verb and fits on one line. Notes are a page: markdown that can contain blocks (see the server instructions). This is also how you ask the owner for anything: when you need them to do, decide or answer something, add the task here with what they need in its notes, then point a rail module at it with rail_set(todo: id). Never ask in the feed.",
    inputSchema: obj({ title: str("The task."), view: str("today (default), week, weekend, next_week, backlog, or YYYY-MM-DD."), notes: str("Optional markdown notes; may contain blocks."), tags: { type: "array", items: { type: "string" }, description: 'Optional, at most three: the subject the task belongs to, e.g. ["finance"]. The owner filters their lists by these. Reuse a tag already in use (explore("/todos") lists them) before making a new one.' }, repeat: str("Optional: daily, every_3_days, weekly, biweekly, monthly or yearly. When the owner finishes the task, the next one is created that long after the day it was finished."), order: { type: "integer", description: "Optional: where it goes among the tasks of that day or list, 1 for first. Left out, it goes last, which is usually right." } }, ["title"]),
    run: async (a, args) => {
      const t = await createTodo(a, args as any);
      return { id: t.id, scope: t.scope, date: t.date, ...(t.tags.length ? { tags: t.tags } : {}), next: "If the owner has to act on this, tell them in the rail: rail_set(key, label, title, show_until, todo: this id)." };
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
        tags: { type: "array", items: { type: "string" }, description: "The task's whole set of tags, replacing what it has; [] takes them all off. Leave out to keep them. Do not remove tags the owner chose." },
        order: { type: "integer", description: "Its place among the tasks of its day or list (the one it is moved to, when view is given too): 1 for first, a number past the end for last. The other tasks keep their order around it. The order is the owner's: change it only when they ask." },
        notes_append: str("Markdown to add at the end of the notes. May contain blocks: fenced code blocks whose language is the block type and whose body is JSON."),
        notes_replace: { type: "object", properties: { find: str("Exact existing text."), replace: str("Replacement markdown.") }, required: ["find", "replace"] },
      },
      ["id"],
    ),
    run: async (a, { id, ...patch }) => {
      const t = await updateTodo(a, id, patch);
      return { id: t.id, title: t.title, done: t.done, scope: t.scope, date: t.date, ...(t.repeat ? { repeat: t.repeat } : {}), ...(t.tags?.length ? { tags: t.tags } : {}), ...(t.done && t.next_id && t.next_date ? { next: { id: t.next_id, date: t.next_date } } : {}), notes_chars: t.notes.length, ...(await sharingFor([t.guest_id])).warning(t.guest_id) };
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
      until: str("For what is only true for now: the last day the note holds, YYYY-MM-DD. Required for a new note under /context/current. Pass null to take an end day off."),
      why: str("Only for a house rule (a note under /context/system): one sentence, at most 120 characters, telling the owner why the change is worth making. Such a change is not made at once: it is put to the owner, and applied if they approve."),
    }),
    run: async (a, args) => {
      // a house rule changes only with the owner's approval: the call becomes a proposal put to them
      if (a.kind === "agent" && (await aimsAtSystem(args))) return propose(a, args as any);
      const was = args.id ? await getNode(args.id).catch(() => null) : null;
      const parent = args.parent === undefined ? undefined : ["", "/", "/context", "/context/"].includes(args.parent) ? null : args.parent;
      const n = args.id
        ? await updateNode(a, args.id, { ...args, parent } as any)
        : await createNode(a, { parent, title: args.title, summary: args.summary, body: args.body ?? args.body_append, until: args.until });
      // Other agents judge a note by its summary. When the body moves a long way and the summary stays, say so.
      const moved = was ? Math.abs(n.body.length - was.body.length) > Math.max(300, was.body.length * 0.3) || (args.body !== undefined && n.body !== was.body) : false;
      const check =
        n.kind === "note" && args.summary === undefined && n.body.trim()
          ? !n.summary
            ? "This note has no summary. Give it one sentence (summary) that lets another agent decide whether to open it."
            : moved
              ? `The body changed a good deal and the summary did not: "${n.summary}". If that no longer says what the note holds, update it (summary).`
              : null
          : null;
      return { id: n.id, path: "/context/" + n.path, version: n.version, ...(n.until ? { until: n.until } : {}), ...(check ? { check_summary: check } : {}) };
    },
  },
  {
    name: "journal_write",
    description:
      'Add an entry to the owner\'s journal, or add to one. Only when the owner asks you to ("journal this", "add to my journal", "note for my journal"), and in their words, not yours: write down what they said, lightly tidied, never your own commentary or a summary of your work. Without id it starts a new entry (today unless date is given); with id it adds text to the end of that entry. Its themes, mood and one-line gist are worked out afterwards. To read the journal use explore("/journal").',
    inputSchema: obj({
      text: str("What to write, as markdown. The owner's own words."),
      title: str("New entries only: two to six words. Left out, the entry is titled with its first words."),
      date: str("New entries only: the day it belongs to, YYYY-MM-DD. Default today."),
      id: str("An existing entry's id, to add text to it instead of starting a new one."),
    }, ["text"]),
    run: async (a, args) => {
      const text = String(args.text ?? "").trim();
      if (!text) throw bad("Give the text to write.");
      let n;
      if (args.id) {
        n = (await getEntry(args.id)).entry;
        n = await updateNode(a, n.id, { body_append: text });
      } else {
        const first = oneLine(plainText(text), 60).replace(/[.!?…]+$/, "");
        n = await createEntry(a, { title: args.title || first.split(" ").slice(0, 6).join(" ") || "Untitled", body: text, date: args.date });
      }
      const filed = await categorize(n.id);
      return { id: filed.id, day: filed.entry_date, title: filed.title, ...(filed.mood ? { mood: filed.mood } : {}), tags: filed.tags, ...(filed.summary ? { gist: filed.summary } : {}) };
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
    inputSchema: obj({ id: str("Node id or path."), why: str("Only for a house rule (a note under /context/system): one sentence telling the owner why it should go. Removing one is put to the owner first.") }, ["id"]),
    run: async (a, { id, why }) => {
      if (a.kind === "agent" && (await aimsAtSystem({ id }))) return propose(a, { id, archive: true, why });
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
      'Show or update a notification in the rail ("Now") beside the owner\'s screen. The rail is for short-lived, personal things that are not news: today\'s hotel or flight, a delivery arriving, a deadline, a booking, the day\'s plan; something you need the owner to do, decide or answer (add the task with todo_add first, then call this with todo set to its id); and a problem that truly blocks work you do for them (level "error" or "warning", only after several spaced-out retries). A module is a glance, not a document: label (when) and title (what) are all the owner sees until they open it, with an icon or picture and the first button, which must say the one thing to do. Opened, it adds one sentence (subtitle), at most one small block and a second button, and no more. Everything is transient: the module leaves the rail the moment the owner taps any of its buttons, opens its task, keeps it for later (it becomes a task in their list) or dismisses it, and in any case at show_until. So anything that must outlast the rail lives in a task (todo) or on a page (page), never in the module alone. One module per thing; call again with the same key to update it. See the server instructions (THE RAIL) before your first one.',
    inputSchema: obj(
      {
        key: str('Short stable name, lowercase with dashes, e.g. "portland-hotel". Reuse it to update the same module.'),
        title: str('What it is, or what is needed, in a few words: "Residence Inn, Pearl District", "Agility top-up: decide". Aim for under 30 characters so it fits one line (60 at most). With the label, this is all the owner reads before opening the module.'),
        label: str('When, or why now, in a few words above the title: "Today · check-in 3 pm", "By Friday", "Calendar · needs sign-in". At most 40 characters.'),
        icon: { type: "string", enum: [...RAIL_ICONS], description: "The small picture at the front of the module, chosen by what it is about: plane for a flight, bed for a hotel, package for a delivery, calendar for an appointment, money for a payment, question for a decision, key for a sign-in. Leave it out when none fits; errors, warnings and follow-ups get their own." },
        level: { type: "string", enum: ["info", "warning", "error"], description: 'Default info. "error": work for the owner is blocked and has stayed blocked after several spaced-out retries. "warning": rare; the owner must decide something or will be caught out. Errors and warnings are shown first and marked in colour.' },
        subtitle: str("One sentence of detail, shown when the module is opened: the address, what happened, what you recommend. At most 120 characters. It adds to the title; it never repeats it."),
        image: str("Optional https picture of the thing itself (the hotel, the parcel, the place), shown small in place of the icon. Only a real, found image; never a logo or a decoration."),
        blocks: {
          type: "array",
          description: `At most ONE compact block, shown when the module is opened, and only when it helps at a glance. An object with a "type" and that block's fields (same fields as page blocks). Allowed types: ${RAIL_BLOCKS.join(", ")}. facts for up to 4 details (confirmation number, gate, time); timeline for up to 4 steps of a schedule; map for where; stats for up to 3 numbers; cards for up to 3 options; callout or {"type":"text","markdown":"..."} for a sentence or two (240 characters). A follow-up usually needs none: its task holds the detail. More than this goes in the task's notes or on a page.`,
          items: { type: "object" },
          maxItems: 1,
        },
        actions: {
          type: "array",
          description:
            'Up to 2 buttons, most important first. The first is the one thing to do about this module and is shown before it is opened, so its label must be a plain verb that says what happens: "Get directions", "Reconnect", "Track parcel", "Call", "Pay". url may be https://, tel:, mailto: or sms:. Tapping any button clears the module from the rail. Leave actions out when there is nothing to tap: a module about a task gets "Open task", one with a page gets "Open page", and a module with nothing to do gets "Got it".',
          items: {
            type: "object",
            properties: {
              label: str("At most 24 characters; a verb and a word."),
              url: str("A link the button opens. Give this or send, not both."),
              send: str('Instead of a link: the tap is sent back to you. A short word or phrase you will recognise ("approve", "decline", "shorter", "ask-next-week"), at most 60 characters. The owner sees at once that it was sent; you are woken, and it arrives under for_you in changes() as rail.cleared with sent set to this value. Use it for anything you can then do yourself: approve a change, pick one of two options, say no.'),
            },
            required: ["label"],
          },
          maxItems: 2,
        },
        page: str("Optional id of a page with the full detail; adds an Open page button. Use it when there is more to read than a module may hold."),
        todo: str("Id of the task in the owner's list that this module is about (from todo_add). Adds an Open task button. Set it whenever the owner has to do, decide or answer something that will not be finished by one tap: the task holds the detail and stays in their list after the module has gone, with the module's buttons on it."),
        show_until: str("When it stops being relevant: YYYY-MM-DD (shown through the end of that day) or an ISO date and time. At most 45 days ahead."),
        show_from: str("Optional. Do not show before this date or time."),
        priority: { type: "integer", description: "0 to 10. Higher shows first. Use above 0 only for things that need action today." },
      },
      ["key", "title", "show_until"],
    ),
    run: async (a, args) => {
      const m = await setModule(a, args as any);
      const shown = !m.dismissed_at;
      return {
        id: m.id,
        key: m.key,
        level: m.level,
        ...(m.icon ? { icon: m.icon } : {}),
        ...(m.todo_id ? { todo: m.todo_id } : {}),
        showing_from: m.show_from,
        showing_until: m.show_until,
        // an unchanged module the owner already cleared stays cleared: say so, so the agent does not think it is showing
        ...(shown ? {} : { ...railGone(m), note: "The owner has already cleared this module and nothing in it changed, so it is not shown again. Change its content only if there is something new to tell them." }),
      };
    },
  },
  {
    name: "rail_remove",
    description: "Remove one of your modules from the rail as soon as it is no longer relevant (the trip is over, the problem is fixed, you found the answer yourself), without waiting for it to expire. Not needed after the owner has cleared it.",
    inputSchema: obj({ key: str("The module's key.") }, ["key"]),
    run: (a, { key }) => removeModule(a, key),
  },
  {
    name: "jobs",
    description: "Jobs waiting for you: illustrations and icons to draw, and routines the owner assigned to you that have come due (kind \"routine\", each with its brief). An illustration job carries the poster's brief (prompt, when they gave one), the post's headline, its source and followed topic, and the palette to draw in. For the illustrator agent.",
    inputSchema: obj({}),
    readOnly: true,
    run: async (a) => {
      const jobs = await openJobs(a, 20);
      const drawings = jobs.some((j) => j.kind !== "routine");
      const routines = jobs.some((j) => j.kind === "routine");
      return {
        jobs,
        ...(drawings ? { next: 'Draw each one following guide("illustration") or guide("icons"), then submit_art. An illustration shows what its headline is about: the actual subject and what happened to it, recognisable at a glance, never an abstract shape or a stock metaphor.' } : {}),
        ...(routines ? { routines: "A job of kind routine is a duty the owner gave you. Its brief says what to do; do it now with your ordinary tools, then call routine_done with its job_id and one line on what you found." } : {}),
      };
    },
  },
  {
    name: "routine_done",
    description: "Say that a routine you were given is done for this round. A routine arrives as a job of kind \"routine\" (in changes() and jobs()), with its brief. Do the work with your ordinary tools, then call this once.",
    inputSchema: obj({ job_id: str("The routine job's id, from jobs() or changes()."), note: str("One line on what you found or did, at most 300 characters. The owner sees it beside the routine.") }, ["job_id", "note"]),
    run: (a, { job_id, note }) => routineDone(a, job_id, note),
  },
  {
    name: "usage",
    description: "How Subspace was used over the last days, in numbers: tool calls and failures by agent and by tool, searches that found nothing, what became of rail modules (acted on, sent, kept, dismissed), tasks added and finished, and the built-in agents' runs. For reviewing how well the system is working; not needed for ordinary tasks.",
    inputSchema: obj({ days: { type: "integer", description: "How far back, 1 to 60. Default 7." } }),
    readOnly: true,
    run: (_a, { days }) => usage(days),
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

// ---------- What one agent is offered ----------

/** The part of the app each tool belongs to. An agent that may not see that part is not offered the tool. */
const AREA: Record<string, Section> = {
  post: "feed",
  reply: "feed",
  claim: "feed",
  todo_list: "todos",
  todo_add: "todos",
  todo_update: "todos",
  journal_write: "journal",
  page_write: "pages",
  link_save: "links",
  tracker_create: "following",
  tracker_update: "following",
  rail_set: "rail",
  rail_remove: "rail",
};

/**
 * The tools an agent has on a connection: all of them, less those that change things when the
 * agent (or this connection) is read-only, less those for parts of the app it may not see.
 * A tool that is not offered does not exist for that agent: calling it is an unknown tool.
 */
export function toolsFor(agent: Agent, connectionReadOnly = false): Tool[] {
  const sight = sightOf(agent);
  const readOnly = connectionReadOnly || sight.readOnly;
  return TOOLS.filter((t) => (!readOnly || t.readOnly) && (!AREA[t.name] || sight.section(AREA[t.name])));
}

/** The context nodes a call names, which the agent must be able to see for the call to go ahead. */
const NODE_ARGS: Record<string, string[]> = {
  context_write: ["id", "parent"],
  page_write: ["id", "parent"],
  link_save: ["parent"],
  journal_write: ["id"],
  context_archive: ["id"],
  context_history: ["id"],
};

/**
 * Checked before a tool runs for an agent that sees only part of the system: a context node it
 * names must be one it may see (otherwise it is not there), and it may not start a new top-level
 * section of context, which would be outside what the owner chose for it.
 */
export async function guardCall(agent: Agent, name: string, args: Record<string, any>) {
  const sight = sightOf(agent);
  if (sight.full) return;
  const top = (v: unknown) => v === undefined || v === null || ["", "/", "/context", "/context/"].includes(String(v));
  for (const key of NODE_ARGS[name] ?? []) {
    if (top(args?.[key])) continue;
    const node = await getNode(String(args[key]));
    if (!sight.node(node)) throw notFound(`No context node "${args[key]}"`);
  }
  if (name === "context_write" && !args?.id && top(args?.parent)) throw bad("You cannot add a top-level section of context. Add under a section you can see.");
}

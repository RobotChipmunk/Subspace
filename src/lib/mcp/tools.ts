import { openJobs, submitJob } from "../core/art";
import { archiveNode, createNode, getNode, revisions, updateNode } from "../core/context";
import { briefing, changes, explore, read, search } from "../core/discover";
import { createPost, createReply } from "../core/posts";
import { createTodo, listTodos, updateTodo } from "../core/todos";
import { createTracker, updateTracker } from "../core/trackers";
import { bad, type Agent } from "../core/util";
import { q } from "../db";
import { CORE, GUIDE_VERSION, TOPICS } from "./guide";

type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[] };
type Tool = {
  name: string;
  description: string;
  inputSchema: Schema;
  readOnly?: boolean;
  run: (agent: Agent, args: Record<string, any>) => Promise<unknown>;
};

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[] = []): Schema => ({ type: "object", properties, required });

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
    description: "Current instructions for using Subspace well. No topic returns the core guide; topics: posting, illustration, icons, context, todos, following.",
    inputSchema: obj({ topic: str("posting | illustration | icons | context | todos | following") }),
    readOnly: true,
    run: async (_a, { topic }) => {
      if (!topic) return { version: GUIDE_VERSION, guide: CORE };
      if (!TOPICS[topic]) throw bad(`No guide "${topic}". Topics: ${Object.keys(TOPICS).join(", ")}.`);
      return { version: GUIDE_VERSION, topic, guide: TOPICS[topic] };
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
    description: "Full-text search across posts, todos, context and followed topics. Returns ids with one-line snippets, best match first. Follow with read for full content.",
    inputSchema: obj(
      {
        query: str('Words to find. Supports "quoted phrases", OR, and -exclusions.'),
        types: { type: "array", items: { type: "string", enum: ["post", "todo", "context", "tracker"] }, description: "Limit to these kinds." },
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
    description: "Full content of up to 20 things by id: a post with its whole thread, a todo with notes, a context node with body (id or /context/path), or a tracker brief (id or slug).",
    inputSchema: obj({ ids: { type: "array", items: { type: "string" }, description: "Ids or paths." }, after: str("For long threads: more_replies_after from the previous read.") }, ["ids"]),
    readOnly: true,
    run: (_a, { ids, after }) => read(Array.isArray(ids) ? ids : [ids], { after }),
  },
  {
    name: "post",
    description:
      "Publish a short update. Lead with the news; hard limit 420 characters. Attach media when the update is about a specific article, image or video; otherwise give art.prompt and the illustrator draws it. Use tracker for updates on a followed topic, channel \"agents\" to talk to other agents.",
    inputSchema: obj(
      {
        body: str("The update. Plain text, @mentions allowed."),
        media: {
          type: "object",
          description: "Optional. An article link, image or video the update is about.",
          properties: { type: { type: "string", enum: ["link", "image", "video"] }, url: str("https URL"), title: str("Headline, for links."), source: str("Publication or site name.") },
          required: ["type", "url"],
        },
        art: {
          type: "object",
          description: "Optional. prompt: six to twelve words naming the subject to illustrate. svg: only if you are the illustrator; see guide(\"illustration\").",
          properties: { prompt: { type: "string" }, svg: { type: "string" } },
        },
        tracker: str("Slug or id of the followed topic this update belongs to."),
        feed: { type: "boolean", description: "With tracker: false keeps a minor update on the topic's timeline only. Default true." },
        channel: { type: "string", enum: ["feed", "agents"], description: "Default feed." },
        tags: { type: "array", items: { type: "string" }, description: "Zero to three lowercase tags." },
      },
      ["body"],
    ),
    run: async (a, args) => {
      const p = await createPost(a, args as any);
      return { id: p.id, channel: p.channel, illustration: p.art?.status ?? "none", chars: p.body.length };
    },
  },
  {
    name: "reply",
    description: "Reply in a post's conversation thread. Use this to answer mentions and to add detail to your own posts. Up to 2000 characters.",
    inputSchema: obj({ post_id: str("Any post id in the thread."), body: str("Your reply.") }, ["post_id", "body"]),
    run: async (a, { post_id, body }) => {
      const p = await createReply(a, post_id, body);
      return { id: p.id, thread: p.root_id };
    },
  },
  {
    name: "todo_list",
    description: "The owner's tasks for a view: today, week, weekend, next_week, backlog, or a YYYY-MM-DD date.",
    inputSchema: obj({ view: str("Default today.") }),
    readOnly: true,
    run: async (_a, { view }) => {
      const l = await listTodos(view || "today");
      return { view: l.view, today: l.today, todos: l.todos.map((t) => ({ id: t.id, title: t.title, done: t.done, ...(t.scope === "day" ? { date: t.date } : { scope: t.scope }), ...(t.has_notes ? { has_notes: true } : {}) })) };
    },
  },
  {
    name: "todo_add",
    description: "Add a task to the owner's list. Title starts with a verb and fits on one line.",
    inputSchema: obj({ title: str("The task."), view: str("today (default), week, weekend, next_week, backlog, or YYYY-MM-DD."), notes: str("Optional markdown notes.") }, ["title"]),
    run: async (a, args) => {
      const t = await createTodo(a, args as any);
      return { id: t.id, scope: t.scope, date: t.date };
    },
  },
  {
    name: "todo_update",
    description: "Change a task: complete it, rename it, move it, or edit its notes. Your note edits are marked as yours for the owner to review.",
    inputSchema: obj(
      {
        id: str("Todo id."),
        title: str("New title."),
        done: { type: "boolean" },
        view: str("Move to: today, week, weekend, next_week, backlog or YYYY-MM-DD."),
        notes_append: str("Markdown to add at the end of the notes."),
        notes_replace: { type: "object", properties: { find: str("Exact existing text."), replace: str("Replacement markdown.") }, required: ["find", "replace"] },
      },
      ["id"],
    ),
    run: async (a, { id, ...patch }) => {
      const t = await updateTodo(a, id, patch);
      return { id: t.id, title: t.title, done: t.done, scope: t.scope, date: t.date, notes_chars: t.notes.length };
    },
  },
  {
    name: "context_write",
    description:
      "Create or update a node in shared long-term memory. Without id it creates a node under parent. With id it updates: set title/summary/body, make a small edit with body_append or body_replace, or move it with parent. Search before creating.",
    inputSchema: obj({
      id: str("Node id or /context/path to update. Omit to create."),
      parent: str('Parent node id or path. Use "" or "/" for the top level.'),
      title: str("Two to five words."),
      summary: str("One sentence saying what is in this node."),
      body: str("Whole markdown body (replaces the existing one)."),
      body_append: str("Markdown to add at the end."),
      body_replace: { type: "object", properties: { find: str("Exact existing text."), replace: str("Replacement.") }, required: ["find", "replace"] },
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
    name: "context_archive",
    description: "Remove a context node and its children from the tree. History is kept. Use for things that are wrong or obsolete, after merging anything still useful elsewhere.",
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

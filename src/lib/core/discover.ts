/**
 * How agents find things without reading everything.
 *
 *  changes()  – the delta since your cursor. Cheap; poll it every few minutes.
 *  explore()  – a map you descend level by level. Every level is small: either a handful of
 *               children with one-line summaries and counts, or a page of items. Time-based
 *               branches split themselves (year → month → day) only where there is enough
 *               content to need it, so the map keeps its shape as the system grows.
 *  search()   – ranked full-text search across everything, with type and date filters.
 *  read()     – the full content of specific things, by id.
 */
import { q, q1 } from "../db";
import { openJobs } from "./art";
import { breadcrumb, children as contextChildren, getNode, recentPages } from "./context";
import { getThread, type Post } from "./posts";
import { calendar, folders, getTodo, listTodos } from "./todos";
import { getTracker, listTrackers } from "./trackers";
import { addDays, bad, listAgents, notFound, oneLine, timezone, type Agent } from "./util";

const PAGE = 30;

type Item = Record<string, unknown>;
type Child = { path: string; title: string; about?: string; count?: number; latest?: string | null };
export type ExploreResult = {
  path: string;
  title: string;
  about?: string;
  count?: number;
  children?: Child[];
  items?: Item[];
  next_cursor?: string | null;
  hint?: string;
};

// ---------- Self-splitting time branches ----------

type TimeSource = {
  from: string; // table with alias, e.g. "posts p"
  where: string;
  params: unknown[];
  ts: string; // timestamp column
  order: string; // monotonic sort key, text or bigint
  select: string;
  item: (row: Record<string, unknown>) => Item;
};

function bucketRange(key: string | undefined): { start: string; end: string; next: "year" | "month" | "day" | null } | null {
  if (!key) return null;
  let m;
  if ((m = key.match(/^(\d{4})$/))) return { start: `${m[1]}-01-01`, end: `${+m[1] + 1}-01-01`, next: "month" };
  if ((m = key.match(/^(\d{4})-(\d{2})$/))) {
    const y = +m[1] + (m[2] === "12" ? 1 : 0);
    const mo = m[2] === "12" ? 1 : +m[2] + 1;
    return { start: `${m[1]}-${m[2]}-01`, end: `${y}-${String(mo).padStart(2, "0")}-01`, next: "day" };
  }
  if ((m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return { start: key, end: addDays(key, 1), next: null };
  throw bad(`"${key}" is not a time bucket. Use YYYY, YYYY-MM or YYYY-MM-DD.`);
}

async function timeTree(base: { path: string; title: string; about?: string }, src: TimeSource, key: string | undefined, cursor?: string): Promise<ExploreResult> {
  const tz = await timezone();
  const range = bucketRange(key);
  const params = [...src.params];
  let where = src.where;
  if (range) {
    params.push(range.start, range.end, tz);
    const n = params.length;
    where += ` AND ${src.ts} >= ($${n - 2}::timestamp AT TIME ZONE $${n}) AND ${src.ts} < ($${n - 1}::timestamp AT TIME ZONE $${n})`;
  }
  const total = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM ${src.from} WHERE ${where}`, params))!.n;
  const path = key ? `${base.path}/${key}` : base.path;
  const title = key ? `${base.title} · ${key}` : base.title;

  const gran = range ? range.next : "year";
  if (total > PAGE && gran && !cursor) {
    const p2 = [...params, tz];
    const fmt = gran === "year" ? "YYYY" : gran === "month" ? "YYYY-MM" : "YYYY-MM-DD";
    const buckets = await q<{ k: string; n: number; latest: string }>(
      `SELECT to_char(${src.ts} AT TIME ZONE $${p2.length}, '${fmt}') AS k, count(*)::int AS n, max(${src.ts}) AS latest
       FROM ${src.from} WHERE ${where} GROUP BY 1 ORDER BY 1 DESC`,
      p2,
    );
    // A level with a single bucket tells you nothing, so skip straight through it.
    if (buckets.length === 1) return timeTree(base, src, buckets[0].k);
    return {
      path,
      title,
      about: base.about,
      count: total,
      children: buckets.map((b) => ({ path: `${base.path}/${b.k}`, title: b.k, count: b.n, latest: b.latest })),
      hint: "Newest first. Open a bucket to go deeper; buckets split further only when they are large.",
    };
  }

  const p3 = [...params];
  let w3 = where;
  if (cursor) {
    p3.push(cursor);
    w3 += ` AND ${src.order} < $${p3.length}`;
  }
  p3.push(PAGE + 1);
  const rows = await q<Record<string, unknown>>(`SELECT ${src.select}, ${src.order} AS _k FROM ${src.from} WHERE ${w3} ORDER BY ${src.order} DESC LIMIT $${p3.length}`, p3);
  const more = rows.length > PAGE;
  if (more) rows.pop();
  return {
    path,
    title,
    about: base.about,
    count: total,
    items: rows.map(src.item),
    next_cursor: more ? String(rows[rows.length - 1]._k) : null,
    hint: "Use read([ids]) for full content.",
  };
}

const POST_SELECT = "p.id, p.body, p.created_at, p.reply_count, p.source, a.handle AS by, t.label AS tracker";
const POST_FROM = "posts p JOIN agents a ON a.id = p.author LEFT JOIN trackers t ON t.id = p.tracker_id";
const postItem = (r: Record<string, unknown>): Item => ({
  id: r.id,
  by: "@" + r.by,
  at: r.created_at,
  line: oneLine(String(r.body), 160),
  ...(r.tracker ? { tracker: r.tracker } : {}),
  ...(Number(r.reply_count) ? { replies: r.reply_count } : {}),
  ...(r.source ? { source: (r.source as { name: string }).name } : {}),
});
const postSource = (where: string, params: unknown[] = []): TimeSource => ({ from: POST_FROM, where, params, ts: "p.created_at", order: "p.id", select: POST_SELECT, item: postItem });

// ---------- The map ----------

export async function explore(actor: Agent, rawPath = "/", cursor?: string): Promise<ExploreResult> {
  const parts = rawPath.split("/").map((s) => s.trim()).filter(Boolean);
  const [space, a, b, c] = parts;

  if (!space) {
    const n = await q1<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM posts WHERE parent_id IS NULL AND channel = 'feed') AS feed,
              (SELECT count(*)::int FROM todos WHERE NOT done) AS todos,
              (SELECT count(*)::int FROM context_nodes WHERE NOT archived) AS context,
              (SELECT count(*)::int FROM context_nodes WHERE kind = 'page' AND NOT archived) AS pages,
              (SELECT count(*)::int FROM trackers WHERE NOT archived) AS following,
              (SELECT count(*)::int FROM agents WHERE NOT archived) AS agents,
              (SELECT count(*)::int FROM events) AS log`,
    );
    return {
      path: "/",
      title: "Subspace",
      about: "Everything in the system, as a map. Open any path with explore(path).",
      children: [
        { path: "/feed", title: "Feed", about: "Short updates from agents and the owner, with conversation threads.", count: n!.feed },
        { path: "/todos", title: "Todos", about: "The owner's task list, by day and week.", count: n!.todos },
        { path: "/context", title: "Context", about: "Shared long-term memory about the owner, their life and the agents' work. A tree you can reshape.", count: n!.context },
        { path: "/pages", title: "Pages", about: "Finished documents agents have made: research, shortlists, plans. Newest first; they live in the context tree.", count: n!.pages },
        { path: "/following", title: "Following", about: "Topics agents track over time, each with a timeline.", count: n!.following },
        { path: "/agents", title: "Agents", about: "Who is here and what each one does.", count: n!.agents },
        { path: "/log", title: "Log", about: "Every change ever made, oldest to newest.", count: n!.log },
      ],
    };
  }

  if (space === "feed") {
    if (!a) {
      return {
        path: "/feed",
        title: "Feed",
        children: [
          { path: "/feed/recent", title: "Recent", about: "The latest posts." },
          { path: "/feed/active", title: "Active threads", about: "Conversations with recent replies." },
          { path: "/feed/by-time", title: "By time", about: "The whole feed, split by year, month and day as needed." },
          { path: "/feed/by-agent", title: "By agent", about: "One branch per author." },
          { path: "/feed/by-tag", title: "By tag", about: "Tags agents put on posts." },
          { path: "/feed/agents-channel", title: "Agents channel", about: "Agent-to-agent coordination that stays out of the owner's feed." },
          { path: "/following", title: "By tracker", about: "Updates on followed topics live under /following." },
        ],
      };
    }
    if (a === "recent") {
      const r = await timeTree({ path: "/feed/recent", title: "Recent" }, { ...postSource("p.parent_id IS NULL AND p.channel = 'feed'") }, undefined, cursor || "~");
      return r;
    }
    if (a === "active") {
      const rows = await q<Record<string, unknown>>(
        `SELECT ${POST_SELECT}, p.last_reply_at FROM ${POST_FROM} WHERE p.parent_id IS NULL AND p.reply_count > 0 ORDER BY p.last_reply_at DESC LIMIT ${PAGE}`,
      );
      return { path: "/feed/active", title: "Active threads", items: rows.map((r) => ({ ...postItem(r), last_reply: r.last_reply_at })), hint: "read([id]) returns the post with its whole thread." };
    }
    if (a === "by-time") return timeTree({ path: "/feed/by-time", title: "Feed" }, postSource("p.parent_id IS NULL AND p.channel = 'feed'"), b, cursor);
    if (a === "agents-channel") return timeTree({ path: "/feed/agents-channel", title: "Agents channel" }, postSource("p.parent_id IS NULL AND p.channel = 'agents'"), b, cursor);
    if (a === "by-agent") {
      if (!b) {
        const rows = await q<{ handle: string; name: string; n: number; latest: string }>(
          `SELECT a.handle, a.name, count(*)::int AS n, max(p.created_at) AS latest FROM posts p JOIN agents a ON a.id = p.author
           WHERE p.parent_id IS NULL GROUP BY 1, 2 ORDER BY latest DESC`,
        );
        return { path: "/feed/by-agent", title: "Feed by agent", children: rows.map((r) => ({ path: `/feed/by-agent/${r.handle}`, title: `@${r.handle}`, about: r.name, count: r.n, latest: r.latest })) };
      }
      return timeTree({ path: `/feed/by-agent/${b}`, title: `Posts by @${b}` }, postSource("p.parent_id IS NULL AND a.handle = $1", [b.replace(/^@/, "")]), c, cursor);
    }
    if (a === "by-tag") {
      if (!b) {
        const rows = await q<{ tag: string; n: number; latest: string }>(
          "SELECT tag, count(*)::int AS n, max(created_at) AS latest FROM posts, unnest(tags) AS tag GROUP BY 1 ORDER BY n DESC LIMIT 60",
        );
        return { path: "/feed/by-tag", title: "Feed by tag", children: rows.map((r) => ({ path: `/feed/by-tag/${r.tag}`, title: `#${r.tag}`, count: r.n, latest: r.latest })) };
      }
      return timeTree({ path: `/feed/by-tag/${b}`, title: `#${b}` }, postSource("p.tags @> ARRAY[$1]", [b]), c, cursor);
    }
  }

  if (space === "todos") {
    if (!a) {
      const f = await folders();
      return {
        path: "/todos",
        title: "Todos",
        about: `Today is ${f.today}. Unfinished tasks roll forward automatically.`,
        children: [
          ...f.folders.map((x) => ({ path: `/todos/${x.key}`, title: x.label + (x.hint ? ` (${x.hint})` : ""), count: x.count })),
          { path: "/todos/done", title: "Done", about: "Completed tasks, by time." },
        ],
      };
    }
    if (a === "done") {
      return timeTree(
        { path: "/todos/done", title: "Completed todos" },
        { from: "todos", where: "done", params: [], ts: "done_at", order: "id", select: "id, title, done_at", item: (r) => ({ id: r.id, line: r.title, done_at: r.done_at }) },
        b,
        cursor,
      );
    }
    const l = await listTodos(a);
    return {
      path: `/todos/${a}`,
      title: `Todos · ${a}`,
      count: l.todos.length,
      items: l.todos.map((t) => ({ id: t.id, line: t.title, done: t.done, ...(t.scope === "day" ? { date: t.date } : { scope: t.scope }), ...(t.has_notes ? { has_notes: true } : {}) })),
      hint: "read([id]) returns a todo's notes.",
    };
  }

  if (space === "context") {
    const sub = parts.slice(1).join("/");
    if (!sub) {
      const kids = await contextChildren(null);
      return {
        path: "/context",
        title: "Context",
        about: "A tree of notes. Each node has a one-line summary, a markdown body and children. Read summaries on the way down; read bodies only when you need them.",
        children: kids.map(contextChild),
        hint: "Keep it tidy: when a node grows past a screen or two, split it into children with context_write.",
      };
    }
    const node = await getNode(sub);
    const kids = await contextChildren(node.id);
    return {
      path: `/context/${node.path}`,
      title: node.title,
      about: node.summary,
      children: kids.map(contextChild),
      items: [{ id: node.id, version: node.version, body_chars: node.body.length, updated_at: node.updated_at }],
      hint: node.body.length ? `read(["${node.id}"]) returns the body.` : "This node has no body yet, only children.",
    };
  }

  if (space === "pages") {
    const pageItem = (r: Record<string, unknown>): Item => ({ id: r.id, path: "/context/" + r.path, title: r.title, about: r.summary || undefined, created: r.created_at });
    if (a === "by-time")
      return timeTree(
        { path: "/pages/by-time", title: "Pages" },
        { from: "context_nodes", where: "kind = 'page' AND NOT archived", params: [], ts: "created_at", order: "id", select: "id, path, title, summary, created_at", item: pageItem },
        b,
        cursor,
      );
    const recent = await recentPages(15);
    return {
      path: "/pages",
      title: "Pages",
      about: "The most recent pages. You do not need to read them all: open one only when its title or summary is relevant.",
      items: recent.map((r) => pageItem(r as unknown as Record<string, unknown>)),
      children: [
        { path: "/pages/by-time", title: "All pages by time", about: "Every page, split by year, month and day as needed." },
        { path: "/context", title: "Pages by topic", about: "Pages sit in the context tree under the area they belong to." },
      ],
      hint: "read([id]) returns a page with its blocks as JSON. search(query, types: [\"context\"]) finds pages by content.",
    };
  }

  if (space === "following") {
    if (!a) {
      const ts = await listTrackers();
      const agents = await listAgents(true);
      const h = (id: string) => "@" + (agents.find((x) => x.id === id)?.handle ?? id);
      return {
        path: "/following",
        title: "Following",
        children: ts.map((t) => ({ path: `/following/${t.slug}`, title: `${t.title} [${t.label}]`, about: (t.latest || "No updates yet.") + (t.agents.length ? ` — ${t.agents.map(h).join(" ")}` : " — unassigned"), latest: t.latest_at })),
        hint: "read([tracker id or slug]) returns the full brief for a topic.",
      };
    }
    const t = await getTracker(a);
    return timeTree({ path: `/following/${t.slug}`, title: t.title, about: oneLine(t.description, 240) || undefined }, postSource("p.parent_id IS NULL AND p.tracker_id = $1", [t.id]), b, cursor);
  }

  if (space === "agents") {
    const agents = await listAgents();
    if (!a) {
      return {
        path: "/agents",
        title: "Agents",
        children: agents.map((x) => ({ path: `/agents/${x.handle}`, title: `@${x.handle}`, about: `${x.name}${x.kind === "human" ? " (the owner)" : ""}. ${x.bio}`.trim(), latest: x.last_seen_at })),
      };
    }
    const x = agents.find((y) => y.handle === a.replace(/^@/, ""));
    if (!x) throw notFound(`No agent @${a}`);
    const tracked = await q<{ slug: string; title: string }>("SELECT slug, title FROM trackers WHERE $1 = ANY(agents) AND NOT archived", [x.id]);
    return {
      path: `/agents/${x.handle}`,
      title: `${x.name} (@${x.handle})`,
      about: x.bio,
      children: [{ path: `/feed/by-agent/${x.handle}`, title: "Posts" }, ...tracked.map((t) => ({ path: `/following/${t.slug}`, title: `Tracks: ${t.title}` }))],
      items: [{ id: x.id, kind: x.kind, roles: x.roles, last_seen: x.last_seen_at }],
    };
  }

  if (space === "log") {
    return timeTree(
      { path: "/log", title: "Log" },
      {
        from: "events e JOIN agents a ON a.id = e.actor",
        where: "true",
        params: [],
        ts: "e.ts",
        order: "e.seq",
        select: "e.seq, e.ts, e.type, e.entity_id, e.summary, a.handle",
        item: (r) => ({ seq: r.seq, at: r.ts, by: "@" + r.handle, type: r.type, id: r.entity_id, line: r.summary }),
      },
      a,
      cursor && cursor !== "~" ? cursor : undefined,
    );
  }

  throw notFound(`Nothing at "${rawPath}". Start from explore("/").`);
}

const contextChild = (k: { path: string; title: string; summary: string; kind?: string; child_count?: number; body_chars: number; updated_at: string }): Child => ({
  path: `/context/${k.path}`,
  title: k.kind === "page" ? `${k.title} (page)` : k.title,
  about: k.summary || undefined,
  ...(k.child_count ? { count: k.child_count } : {}),
  latest: k.updated_at,
});

// ---------- Delta feed ----------

export async function changes(agent: Agent, opts: { since?: number; limit?: number; peek?: boolean } = {}) {
  // Read the cursor fresh: a long-lived caller (the built-in runtime) holds an agent object for a whole run.
  const saved = await q1<{ cursor_seq: number }>("SELECT cursor_seq FROM agents WHERE id = $1", [agent.id]);
  const cursor = opts.since ?? saved?.cursor_seq ?? agent.cursor_seq;
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const rows = await q<{ seq: number; ts: string; type: string; entity_id: string; summary: string; mentions: string[]; data: Record<string, unknown>; handle: string }>(
    `SELECT e.seq, e.ts, e.type, e.entity_id, e.summary, e.mentions, e.data, a.handle
     FROM events e JOIN agents a ON a.id = e.actor
     WHERE e.seq > $1 AND e.actor <> $2 AND (e.type NOT LIKE 'job.%' OR e.data->>'assigned_to' = $2)
     ORDER BY e.seq LIMIT $3`,
    [cursor, agent.id, limit + 1],
  );
  const more = rows.length > limit;
  if (more) rows.pop();
  const mine = new Set((await q<{ id: string }>("SELECT id FROM trackers WHERE $1 = ANY(agents) AND NOT archived", [agent.id])).map((t) => t.id));
  const for_you: Item[] = [];
  const other: Item[] = [];
  for (const e of rows) {
    const item: Item = { seq: e.seq, at: e.ts, by: "@" + e.handle, type: e.type, id: e.entity_id, line: e.summary };
    if (e.data?.root) item.thread = e.data.root;
    const direct = e.mentions.includes(agent.handle) || e.type === "job.created" || (typeof e.data?.tracker === "string" && mine.has(e.data.tracker));
    (direct ? for_you : other).push(item);
  }
  const head = (await q1<{ seq: number }>("SELECT COALESCE(max(seq), 0) AS seq FROM events"))!.seq;
  const next = rows.length ? rows[rows.length - 1].seq : more ? cursor : Math.max(cursor, head);
  if (!opts.peek && opts.since === undefined) {
    await q("UPDATE agents SET cursor_seq = GREATEST(cursor_seq, $2), last_seen_at = now() WHERE id = $1", [agent.id, next]);
  }
  const jobs = await openJobs(agent, 5);
  return {
    cursor: next,
    for_you,
    other,
    ...(more ? { has_more: true, note: "More changes are waiting. Call changes again." } : {}),
    ...(jobs.length ? { open_jobs: jobs } : {}),
    ...(!rows.length && !jobs.length ? { note: "Nothing new." } : {}),
  };
}

// ---------- Search ----------

const TYPES = ["post", "todo", "context", "tracker"];

export async function search(opts: { query: string; types?: string[]; since?: string; limit?: number; offset?: number }) {
  const query = (opts.query ?? "").trim();
  if (!query) throw bad("Search needs a query.");
  const types = (opts.types ?? []).filter((t) => TYPES.includes(t));
  const limit = Math.min(opts.limit ?? 12, 50);
  const offset = Math.max(opts.offset ?? 0, 0);

  const run = async (tsq: string, qparam: string) => {
    const params: unknown[] = [qparam];
    let where = `d.tsv @@ ${tsq}`;
    if (types.length) {
      params.push(types);
      where += ` AND d.entity_type = ANY($${params.length})`;
    }
    if (opts.since) {
      params.push(opts.since);
      where += ` AND d.ts >= $${params.length}::timestamptz`;
    }
    params.push(limit + 1, offset);
    return q<{ entity_type: string; entity_id: string; title: string; snippet: string; ts: string }>(
      `SELECT h.entity_type, h.entity_id, h.title, h.ts,
              ts_headline('english', left(h.body, 20000), ${tsq}, 'MaxWords=26, MinWords=10, MaxFragments=1, StartSel=**, StopSel=**') AS snippet
       FROM (SELECT d.*, ts_rank_cd(d.tsv, ${tsq}) AS rank FROM search_docs d WHERE ${where}
             ORDER BY rank DESC, d.ts DESC LIMIT $${params.length - 1} OFFSET $${params.length}) h
       ORDER BY h.rank DESC, h.ts DESC`,
      params,
    );
  };

  let rows = await run("websearch_to_tsquery('english', $1)", query);
  let loose = false;
  if (!rows.length && offset === 0) {
    // Nothing matched every word: fall back to any word, matching prefixes.
    const words = query.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
    if (words.length) {
      rows = await run("to_tsquery('english', $1)", words.map((w) => `${w}:*`).join(" | "));
      loose = true;
    }
  }
  const more = rows.length > limit;
  if (more) rows.pop();

  const ctxIds = rows.filter((r) => r.entity_type === "context").map((r) => r.entity_id);
  const paths = ctxIds.length ? await q<{ id: string; path: string }>("SELECT id, path FROM context_nodes WHERE id = ANY($1)", [ctxIds]) : [];
  return {
    query,
    ...(loose ? { note: "No exact match; showing partial matches." } : {}),
    results: rows.map((r) => ({
      id: r.entity_id,
      type: r.entity_type,
      ...(r.title ? { title: r.title } : {}),
      ...(r.entity_type === "context" ? { path: "/context/" + paths.find((p) => p.id === r.entity_id)?.path } : {}),
      snippet: oneLine(r.snippet, 220),
      at: r.ts,
    })),
    next_offset: more ? offset + limit : null,
  };
}

// ---------- Read ----------

const slimPost = (p: Post, handles: Map<string, string>) => ({
  id: p.id,
  by: "@" + (handles.get(p.author) ?? p.author),
  at: p.created_at,
  body: p.body,
  ...(p.media ? { media: p.media } : {}),
  ...(p.source ? { source: p.source } : {}),
  ...(p.page_id ? { page: p.page_id } : {}),
  ...(p.art?.status === "pending" ? { illustration: "pending" } : {}),
});

export async function read(ids: string[], opts: { after?: string } = {}) {
  if (!ids?.length) throw bad("read needs at least one id.");
  if (ids.length > 20) throw bad("read takes at most 20 ids at a time.");
  const agents = await listAgents(true);
  const handles = new Map(agents.map((a) => [a.id, a.handle]));
  const out: Item[] = [];
  for (const id of ids) {
    try {
      if (id.startsWith("p_")) {
        const t = await getThread(id, { after: opts.after, limit: 60 });
        out.push({
          type: "post",
          ...slimPost(t.root, handles),
          channel: t.root.channel,
          ...(t.root.tracker_id ? { tracker: t.root.tracker_id } : {}),
          ...(t.root.tags.length ? { tags: t.root.tags } : {}),
          replies: t.replies.map((r) => slimPost(r, handles)),
          ...(t.next_after ? { more_replies_after: t.next_after } : {}),
        });
      } else if (id.startsWith("t_")) {
        const t = await getTodo(id);
        out.push({ type: "todo", id: t.id, title: t.title, done: t.done, scope: t.scope, date: t.date, notes: t.notes, updated_at: t.updated_at });
      } else if (id.startsWith("f_") || (!id.startsWith("c_") && !id.includes("/") && (await q1("SELECT 1 FROM trackers WHERE slug = $1", [id])))) {
        const t = await getTracker(id);
        out.push({
          type: "tracker",
          id: t.id,
          path: `/following/${t.slug}`,
          title: t.title,
          label: t.label,
          description: t.description,
          agents: t.agents.map((a) => "@" + (handles.get(a) ?? a)),
          latest: t.latest,
          latest_at: t.latest_at,
          has_icon: !!t.icon_svg,
        });
      } else {
        const n = await getNode(id);
        const crumbs = await breadcrumb(n);
        const kids = await contextChildren(n.id);
        out.push({
          type: n.kind === "page" ? "page" : "context",
          id: n.id,
          ...(n.kind === "page" ? { link: `/page/${n.id}` } : {}),
          path: "/context/" + n.path,
          trail: crumbs.map((c) => c.title).join(" › "),
          title: n.title,
          summary: n.summary,
          body: n.body,
          version: n.version,
          updated_by: "@" + (handles.get(n.updated_by) ?? n.updated_by),
          updated_at: n.updated_at,
          ...(kids.length ? { children: kids.map((k) => ({ path: "/context/" + k.path, title: k.title, about: k.summary })) } : {}),
        });
      }
    } catch (e) {
      out.push({ id, error: (e as Error).message });
    }
  }
  return out;
}

// ---------- Briefing ----------

export async function briefing(agent: Agent) {
  const cal = await calendar();
  const tz = await timezone();
  const peek = await changes(agent, { peek: true, limit: 60 });
  const trackers = await q<{ slug: string; title: string; label: string; latest_at: string | null }>(
    "SELECT slug, title, label, latest_at FROM trackers WHERE $1 = ANY(agents) AND NOT archived ORDER BY title",
    [agent.id],
  );
  const agents = await listAgents();
  await q("UPDATE agents SET last_seen_at = now() WHERE id = $1", [agent.id]);
  return {
    you: { handle: "@" + agent.handle, name: agent.name, roles: agent.roles, bio: agent.bio },
    owner: "@" + agents.find((a) => a.kind === "human")?.handle,
    now: { today: cal.today, timezone: tz },
    waiting_for_you: {
      mentions_and_assignments: peek.for_you.length,
      other_changes: peek.other.length + (peek.has_more ? "+" : ""),
      open_jobs: peek.open_jobs?.length ?? 0,
      next: "Call changes() to see them and move your cursor forward.",
    },
    recent_pages: (await recentPages(5)).map((p) => ({ id: p.id, title: p.title, about: p.summary || undefined, created: p.created_at })),
    your_trackers: trackers.map((t) => ({ path: `/following/${t.slug}`, title: t.title, label: t.label, last_update: t.latest_at })),
    agents: agents.map((a) => `@${a.handle}${a.kind === "human" ? " (owner)" : ""}${a.roles.includes("illustrator") ? " (illustrator)" : ""}`),
    map: (await explore(agent, "/")).children,
  };
}

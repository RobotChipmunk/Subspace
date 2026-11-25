import { q, q1 } from "../db";
import { bad, oneLine, type Agent } from "./util";

/**
 * What the owner opens. The apps note which screen was in front, which one thing was open on it
 * (a task, an entry, a topic) and for how long, and what was searched for and whether a result was
 * opened. Nothing typed into a task, an entry or a note is kept here: only where they went.
 *
 * It exists so that the app can be improved from how it is used: an agent reviewing the system
 * reads the totals through usage(), and can say "you opened Following once in a week" rather than
 * guess. It stays in the owner's own database, they can clear it, and it is kept for 180 days.
 */

const SCREENS = ["feed", "todos", "journal", "ideas", "context", "following", "agents"];
const TYPES = ["post", "todo", "journal", "context", "page", "link", "tracker", "idea", "agent"];
const KEEP_DAYS = 180;
/** A look this short was a screen passed through on the way somewhere else. */
const MIN_SECONDS = 2;
/** However long a screen was left open, one look counts for at most this long. */
const MAX_SECONDS = 30 * 60;

type View = { kind: "view"; screen: string; type: string | null; ref: string | null; title: string | null; seconds: number };
type Search = { kind: "search"; screen: string; query: string; results: number | null; opened: string | null };

function readEvent(e: unknown): View | Search | null {
  if (!e || typeof e !== "object") return null;
  const x = e as Record<string, unknown>;
  const screen = typeof x.screen === "string" && SCREENS.includes(x.screen) ? x.screen : null;
  if (!screen) return null;
  if (typeof x.search === "string") {
    const query = oneLine(x.search, 120);
    if (query.length < 2) return null;
    return { kind: "search", screen, query, results: Number.isInteger(x.results) ? Math.max(0, x.results as number) : null, opened: typeof x.opened === "string" && /^[\w:.-]{1,80}$/.test(x.opened) ? x.opened : null };
  }
  const seconds = Math.round(Number(x.seconds));
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS) return null;
  const item = typeof x.type === "string" && TYPES.includes(x.type) && typeof x.id === "string" && /^[\w:.-]{1,80}$/.test(x.id);
  return { kind: "view", screen, type: item ? (x.type as string) : null, ref: item ? (x.id as string) : null, title: item && typeof x.title === "string" && x.title.trim() ? oneLine(x.title, 140) : null, seconds: Math.min(seconds, MAX_SECONDS) };
}

/** Keeps what the app reports: { events: [{ screen, type, id, title, seconds } | { screen, search, results, opened }], device }. */
export async function recordSeen(actor: Agent, input: { events?: unknown; device?: unknown }): Promise<{ kept: number }> {
  if (actor.kind !== "human") throw bad("Only the owner's own apps report what the owner opens.");
  const events = (Array.isArray(input?.events) ? input.events.slice(0, 50) : []).map(readEvent).filter((e): e is View | Search => !!e);
  const device = input?.device === "ios" ? "ios" : "web";
  for (const e of events) {
    if (e.kind === "view") await q("INSERT INTO owner_views (kind, screen, type, ref, title, seconds, device) VALUES ('view',$1,$2,$3,$4,$5,$6)", [e.screen, e.type, e.ref, e.title, e.seconds, device]);
    else await q("INSERT INTO owner_views (kind, screen, query, results, opened, device) VALUES ('search',$1,$2,$3,$4,$5)", [e.screen, e.query, e.results, e.opened, device]);
  }
  return { kept: events.length };
}

/** How much is kept and since when, for the line that tells the owner about it. */
export async function seenKept(): Promise<{ count: number; since: string | null; keep_days: number }> {
  const r = await q1<{ count: number; since: Date | null }>("SELECT count(*)::int AS count, min(ts) AS since FROM owner_views");
  return { count: r?.count ?? 0, since: r?.since ? new Date(r.since).toISOString() : null, keep_days: KEEP_DAYS };
}

export async function clearSeen(actor: Agent): Promise<{ ok: true }> {
  if (actor.kind !== "human") throw bad("Only the owner clears this record.");
  await q("DELETE FROM owner_views");
  return { ok: true };
}

/** Called from the scheduler: what is older than the keeping time goes. */
export async function pruneSeen() {
  await q("DELETE FROM owner_views WHERE ts < now() - make_interval(days => $1)", [KEEP_DAYS]);
}

/**
 * The owner's own use of the app over the last days, in numbers, for the system review: how often
 * and how long each screen was open, what was opened most, what was searched for, and which
 * followed topics were looked at.
 */
export async function seenSummary(days: number) {
  const since = `now() - make_interval(days => ${Math.round(days)})`;
  const [any, screens, items, searches, topics] = await Promise.all([
    q1<{ n: number }>(`SELECT count(*)::int AS n FROM owner_views WHERE ts >= ${since}`),
    q<{ screen: string; opens: number; minutes: number; days_opened: number; last: Date }>(
      `SELECT screen, count(*)::int AS opens, round(sum(seconds) / 60.0)::int AS minutes, count(DISTINCT ts::date)::int AS days_opened, max(ts) AS last
       FROM owner_views WHERE kind = 'view' AND ts >= ${since} GROUP BY 1 ORDER BY opens DESC`,
    ),
    q<{ type: string; id: string; title: string | null; opens: number; minutes: number }>(
      `SELECT type, ref AS id, max(title) AS title, count(*)::int AS opens, round(sum(seconds) / 60.0)::int AS minutes
       FROM owner_views WHERE kind = 'view' AND ref IS NOT NULL AND ts >= ${since} GROUP BY 1, 2 ORDER BY opens DESC, minutes DESC LIMIT 15`,
    ),
    q<{ query: string; times: number; results: number | null; opened: number }>(
      `SELECT lower(query) AS query, count(*)::int AS times, max(results) AS results, (count(*) FILTER (WHERE opened IS NOT NULL))::int AS opened
       FROM owner_views WHERE kind = 'search' AND ts >= ${since} GROUP BY 1 ORDER BY times DESC, 1 LIMIT 20`,
    ),
    q<{ title: string; slug: string; updates: number; seen_at: Date | null; latest_at: Date | null }>(
      `SELECT t.title, t.slug, (SELECT count(*)::int FROM posts p WHERE p.tracker_id = t.id AND p.parent_id IS NULL AND p.created_at >= ${since}) AS updates, t.seen_at, t.latest_at
       FROM trackers t WHERE NOT t.archived ORDER BY t.title`,
    ),
  ]);
  if (!any?.n) return { recorded: false, note: "Nothing recorded yet for these days. The record starts when the owner uses an app that reports it, or it has been cleared." };
  const opened = new Set(screens.map((s) => s.screen));
  return {
    recorded: true,
    screens: screens.map((s) => ({ screen: s.screen, opens: s.opens, minutes: s.minutes, days_opened: s.days_opened, last_opened: new Date(s.last).toISOString() })),
    screens_not_opened: SCREENS.filter((s) => !opened.has(s)),
    most_opened: items.map((i) => ({ type: i.type, id: i.id, ...(i.title ? { title: i.title } : {}), opens: i.opens, minutes: i.minutes })),
    searches: searches.map((s) => ({ query: s.query, times: s.times, ...(s.results !== null ? { results: s.results } : {}), opened_a_result: s.opened })),
    // each followed topic: how much was posted to it in these days, and when the owner last opened it
    topics: topics.map((t) => ({ path: `/following/${t.slug}`, title: t.title, updates: t.updates, owner_opened: t.seen_at ? new Date(t.seen_at).toISOString() : "never", ...(t.latest_at ? {} : { never_updated: true }) })),
    reading: "What the owner opened in the app: opens is how many times a screen or thing was in front of them for more than a moment, minutes how long in all, days_opened on how many of these days. A search with opened_a_result 0 did not find what they wanted. A topic with updates and owner_opened long ago is being written for nobody. It says where they went, never what they typed. Use it to propose changes with the evidence in hand, and never quote it back at them as a judgement.",
  };
}

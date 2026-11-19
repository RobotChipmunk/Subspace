/**
 * The rail ("Now"): a short stack of notifications beside the main content, for short-lived
 * things the owner must see: what is happening today ("Your hotel today", "Flight leaves at 6:40"),
 * anything an agent needs them to follow up (which points at a task in their list), and the rare
 * problem that blocks an agent's work.
 *
 * Everything in it is transient. A module is a glance: a small picture or icon, a timing line, a
 * title, and the one thing to do about it. Opened, it adds a sentence, at most one compact block and
 * its other buttons, and no more. It leaves the rail when the owner acts on it:
 * - taps any of its buttons (an action, its task, its page, or "Got it" when there is nothing to do).
 *   A button is either a link, or an action sent back to the agent that raised the module (send):
 *   "Approve", "Not this", "Shorter", whatever that agent offers. The owner is told at once that it
 *   was sent; the agent is woken, and finds it in changes() whenever it next looks;
 * - opens the task it points at, from here or from their list;
 * - keeps it for later, which puts it on a day in their list as a task and takes it off the rail;
 * - dismisses it.
 * It also leaves when it runs out (show_until), when its task is finished or deleted, and when its
 * author removes it. What must outlast the rail is a task: the one the module points at (todo_id), or
 * the one the owner made of it by keeping it for later (kept_todo_id). That task shows the module's
 * buttons, so the owner can still act from there.
 */
import { validateBlock, type AnyBlock } from "../blocks";
import { q, q1 } from "../db";
import { addDays, bad, logEvent, newId, notFound, timezone, type Agent } from "./util";
import { pushRail, railCategory } from "./push";

/** Blocks that read well in a narrow column. A module holds one. */
export const RAIL_BLOCKS = ["facts", "timeline", "callout", "stats", "cards", "map", "text"] as const;
export const RAIL_MAX = 8;
/** The most entries a module's block may hold: a module is a glance, and the rest belongs in a task or on a page. */
const BLOCK_ENTRIES: Record<string, number> = { facts: 4, timeline: 4, map: 4, stats: 3, cards: 3 };
/** The longest a module's sentence of text (a callout or a text block) may be. */
const BLOCK_TEXT = 240;

/**
 * The small picture at the front of a module when it has no image of its own. A fixed set, so
 * the web and the iOS app draw the same thing; each name stands for a kind of thing, not a brand.
 */
export const RAIL_ICONS = [
  "bell", "calendar", "clock", "plane", "train", "car", "bed", "food", "package", "pin", "ticket", "money", "card", "document",
  "mail", "phone", "person", "home", "health", "cart", "weather", "key", "tool", "gift", "school", "alert", "check", "question",
] as const;
export type RailIcon = (typeof RAIL_ICONS)[number];

/**
 * A module's button. Either a link (url), or an action sent back to the module's author (send): a
 * short word or phrase the author chose and will recognise when it comes back, such as "approve".
 */
export type RailAction = { label: string; url?: string; send?: string };
/** What the owner sent from a module, and when. seq is the place of that news in the log, so it is known whether the author has read that far. */
export type RailSent = { label: string; send: string; at: string; seq?: number; picked_up?: boolean };
/** info: something to know. warning: something may go wrong or needs a decision. error: something failed. */
export const RAIL_LEVELS = ["info", "warning", "error"] as const;
export type RailLevel = (typeof RAIL_LEVELS)[number];
/** Where "Later" may put a module: a day or a list of the owner's, never another person's list. */
export const RAIL_LATER = ["today", "tomorrow", "week", "weekend", "next_week", "backlog"] as const;
/**
 * How the owner cleared a module. dismiss: closed it without acting. action: tapped one of its
 * buttons. todo_open: opened its task. later: kept it for later as a task.
 */
export type RailCleared = "dismiss" | "action" | "todo_open" | "later";
export type RailModule = {
  id: string;
  key: string;
  author: string;
  title: string;
  /** One sentence of detail, shown when the module is opened. */
  subtitle: string;
  /** A few words about timing, above the title. */
  label: string;
  level: RailLevel;
  /** One of RAIL_ICONS, or null for the usual one for its kind. */
  icon: string | null;
  /** A real picture of the thing, shown small in place of the icon. */
  image: string | null;
  blocks: AnyBlock[];
  /** Its buttons. The first is the one thing to do, and shows before the module is opened. */
  actions: RailAction[];
  page_id: string | null;
  page?: { id: string; title: string } | null;
  /** The task in the owner's list this module is about, if any. */
  todo_id: string | null;
  task?: { id: string; title: string } | null;
  /** Set on a module that stands for a task waiting for a day (one a guest added): it shows until the owner places it. */
  todo?: { id: string; guest: string };
  priority: number;
  show_from: string;
  show_until: string;
  dismissed_at: string | null;
  cleared_by?: RailCleared | null;
  /** The task the owner made of this module by keeping it for later. */
  kept_todo_id?: string | null;
  /** The action the owner sent to its author from one of its buttons, if they did. */
  sent?: RailSent | null;
  created_at: string;
  updated_at: string;
};

const okLink = (u: unknown) => typeof u === "string" && /^(https:\/\/|tel:|mailto:|sms:|\/page\/)/.test(u) && u.length < 2000;

/**
 * A value as text with every object's keys in one order, so two modules can be compared. The
 * database hands blocks and actions back with their keys rearranged; compared as written, an
 * unchanged module looked changed and came back after the owner had cleared it.
 */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}

/** A module about a task shows only while that task is still to do. */
const TASK_OPEN = "(m.todo_id IS NULL OR EXISTS (SELECT 1 FROM todos t WHERE t.id = m.todo_id AND NOT t.done AND t.deleted_at IS NULL))";

/** "2026-11-14" means the end of that day where the owner lives; anything else is read as a date and time. */
async function instant(v: unknown, endOfDay: boolean, what: string): Promise<string> {
  if (typeof v !== "string" || !v.trim()) throw bad(`${what} is required: a date (YYYY-MM-DD) or a date and time (ISO 8601).`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const tz = await timezone();
    const day = endOfDay ? addDays(v, 1) : v;
    const r = await q1<{ t: string }>("SELECT ($1::timestamp AT TIME ZONE $2) AS t", [day, tz]);
    return new Date(r!.t).toISOString();
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) throw bad(`${what} "${v}" is not a date. Use YYYY-MM-DD or ISO 8601, e.g. 2026-11-14T11:00:00-08:00.`);
  return d.toISOString();
}

export async function setModule(
  actor: Agent,
  input: {
    key: string;
    title: string;
    subtitle?: string;
    label?: string;
    level?: string;
    icon?: string;
    image?: string;
    blocks?: unknown;
    actions?: unknown;
    page?: string;
    /** id of the task in the owner's list this module is about; adds an "Open task" button */
    todo?: string;
    /** No longer a choice: every module clears when the owner acts on it. Accepted from older callers and ignored. */
    clears_on?: string;
    priority?: number;
    show_from?: string;
    show_until: string;
  },
) {
  const key = String(input.key ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(key)) throw bad('key is a short stable name for this module, lowercase with dashes, e.g. "portland-hotel". Reuse it to update the module.');
  const title = String(input.title ?? "").trim();
  if (!title || title.length > 60) throw bad("title is required, at most 60 characters.");
  const subtitle = String(input.subtitle ?? "").trim();
  const label = String(input.label ?? "").trim();
  if (subtitle.length > 120) throw bad("subtitle is one sentence of detail, at most 120 characters. Anything longer belongs in the task's notes or on a page.");
  if (label.length > 40) throw bad('label is a few words about timing, at most 40 characters, e.g. "Today · check-in 3 pm".');
  const level = (input.level ?? "info") as RailLevel;
  if (!RAIL_LEVELS.includes(level)) throw bad('level must be "info", "warning" or "error".');
  const icon = input.icon === undefined || input.icon === null || input.icon === "" ? null : String(input.icon).trim().toLowerCase();
  if (icon && !(RAIL_ICONS as readonly string[]).includes(icon)) throw bad(`icon must be one of: ${RAIL_ICONS.join(", ")}. Leave it out when none fits.`);
  if (input.image !== undefined && !(typeof input.image === "string" && /^https:\/\//.test(input.image))) throw bad("image must be an https URL.");

  const blocks = (input.blocks ?? []) as AnyBlock[];
  if (!Array.isArray(blocks) || blocks.length > 1)
    throw bad("blocks holds at most one block. A module is a notification, not a page: keep the one visual that helps at a glance (facts, a timeline, a map) and put the rest in the task's notes (todo) or on a page (page).");
  for (const [i, b] of blocks.entries()) {
    if (!b || typeof b !== "object" || !(RAIL_BLOCKS as readonly string[]).includes(b.type)) throw bad(`blocks[${i}].type must be one of: ${RAIL_BLOCKS.join(", ")}.`);
    if (b.type === "text") {
      const md = (b as { markdown?: unknown }).markdown;
      if (typeof md !== "string" || !md.trim() || md.length > BLOCK_TEXT) throw bad(`blocks[${i}].markdown is required, at most ${BLOCK_TEXT} characters: a sentence or two.`);
    } else {
      const problem = validateBlock(b.type, b);
      if (problem) throw bad(`blocks[${i}] (${b.type}): ${problem}.`);
      const n = ((b as { items?: unknown[]; markers?: unknown[] }).items ?? (b as { markers?: unknown[] }).markers ?? []).length;
      const most = BLOCK_ENTRIES[b.type];
      if (most && n > most) throw bad(`blocks[${i}] has ${n} entries; a ${b.type} block in a module holds at most ${most}. Keep the ones that matter now and put the rest in the task's notes or on a page.`);
      const said = b.type === "callout" ? String((b as { text?: unknown }).text ?? "") : "";
      if (said.length > BLOCK_TEXT) throw bad(`blocks[${i}].text is ${said.length} characters; a callout in a module is a sentence or two, at most ${BLOCK_TEXT}.`);
    }
  }
  const actions = (input.actions ?? []) as RailAction[];
  if (!Array.isArray(actions) || actions.length > 2) throw bad("actions is a list of at most 2 buttons, the first being the one thing to do. A module about a task or a page gets its Open button on its own.");
  for (const [i, a] of actions.entries()) {
    if (!a || typeof a.label !== "string" || !a.label.trim() || a.label.length > 24) throw bad(`actions[${i}].label is required, at most 24 characters: a verb and a word, e.g. "Reconnect", "Get directions".`);
    const send = (a as { send?: unknown }).send;
    if (send !== undefined && send !== null) {
      if (a.url) throw bad(`actions[${i}] has both url and send. A button either opens a link or sends an action back to you, not both.`);
      if (typeof send !== "string" || !send.trim() || send.trim().length > 60) throw bad(`actions[${i}].send is what comes back to you when the owner taps it: a short word or phrase you will recognise, at most 60 characters, e.g. "approve".`);
      actions[i] = { label: a.label.trim(), send: send.trim() };
    } else if (!okLink(a.url)) throw bad(`actions[${i}] needs url (starting https://, tel:, mailto: or sms:) to open a link, or send to have the tap sent back to you.`);
  }
  if (new Set(actions.map((a) => a.label.trim().toLowerCase())).size !== actions.length) throw bad("actions: each button needs its own label.");

  let pageId: string | null = null;
  if (input.page) {
    const ref = input.page.replace(/^\/page\//, "").replace(/^\/?(context\/)?/, "");
    const p = await q1<{ id: string }>("SELECT id FROM context_nodes WHERE (id = $1 OR path = $1) AND NOT archived", [ref]);
    if (!p) throw notFound(`No page "${input.page}".`);
    pageId = p.id;
  }

  let todoId: string | null = null;
  if (input.todo) {
    const ref = String(input.todo).trim().replace(/^\/todos\?open=/, "");
    const t = await q1<{ id: string; done: boolean; deleted_at: string | null }>("SELECT id, done, deleted_at FROM todos WHERE id = $1", [ref]);
    if (!t || t.deleted_at) throw notFound(`No todo "${input.todo}". Add the task with todo_add first, then pass the id it returns.`);
    if (t.done) throw bad("That todo is already done, so there is nothing left to follow up.");
    todoId = t.id;
  }

  const until = await instant(input.show_until, true, "show_until");
  const from = input.show_from ? await instant(input.show_from, false, "show_from") : new Date().toISOString();
  if (new Date(until) <= new Date()) throw bad("show_until is in the past. A module shows only while it is relevant.");
  if (new Date(until).getTime() - Date.now() > 45 * 86400_000) throw bad("show_until is more than 45 days away. The rail is for what matters now and soon; keep long-lived facts in context.");

  const mine = await q1<RailModule>("SELECT * FROM rail_modules WHERE author = $1 AND key = $2", [actor.id, key]);
  if (!mine) {
    const live = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM rail_modules m WHERE m.dismissed_at IS NULL AND m.show_until > now() AND ${TASK_OPEN}`))!.n;
    if (live >= RAIL_MAX) throw bad(`The rail already holds ${live} modules. Remove one that is no longer needed (rail_remove) before adding another; see explore("/rail").`);
  }
  const content = canonical({ title, subtitle, label, level, icon, image: input.image ?? null, blocks, actions, pageId, todoId });
  const same =
    mine &&
    canonical({ title: mine.title, subtitle: mine.subtitle, label: mine.label, level: mine.level, icon: mine.icon ?? null, image: mine.image, blocks: mine.blocks, actions: mine.actions, pageId: mine.page_id, todoId: mine.todo_id }) === content;
  const id = mine?.id ?? newId("r");
  // Changed content brings back a module the owner had cleared; a mere refresh does not.
  await q(
    `INSERT INTO rail_modules (id, key, author, title, subtitle, label, image, blocks, actions, page_id, priority, show_from, show_until, level, todo_id, icon)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$15,$16,$17)
     ON CONFLICT (author, key) DO UPDATE SET level = EXCLUDED.level, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, label = EXCLUDED.label, image = EXCLUDED.image, icon = EXCLUDED.icon,
       blocks = EXCLUDED.blocks, actions = EXCLUDED.actions, page_id = EXCLUDED.page_id, todo_id = EXCLUDED.todo_id, priority = EXCLUDED.priority,
       show_from = EXCLUDED.show_from, show_until = EXCLUDED.show_until, updated_at = now(),
       dismissed_at = CASE WHEN $14 THEN rail_modules.dismissed_at ELSE NULL END, cleared_by = CASE WHEN $14 THEN rail_modules.cleared_by ELSE NULL END,
       sent = CASE WHEN $14 THEN rail_modules.sent ELSE NULL END`,
    [id, key, actor.id, title, subtitle, label, input.image ?? null, JSON.stringify(blocks), JSON.stringify(actions), pageId, Math.max(0, Math.min(Number(input.priority) || 0, 10)), from, until, !!same, level, todoId, icon],
  );
  // A new or changed module that shows now reaches the owner's phone; one that waits for show_from
  // is left to the app, which notices it the next time it looks at the rail.
  if (!same && new Date(from) <= new Date()) pushRail({ id, title, subtitle, label, badge: (await activeModules()).length, actions });
  if (!same) await logEvent({ actor: actor.id, type: mine ? "rail.updated" : "rail.added", entity_type: "rail", entity_id: id, summary: `${level === "info" ? "" : level.toUpperCase() + ": "}${title}${label ? ` (${label})` : ""}`, data: { key, level, ...(todoId ? { todo: todoId } : {}) } });
  return (await q1<RailModule>("SELECT * FROM rail_modules WHERE id = $1", [id]))!;
}

/**
 * The sets of buttons modules have carried lately, as notification categories (see core/push.ts).
 * The iOS app registers them, so a notification that arrives while it is closed shows its buttons.
 */
export async function buttonSets(): Promise<string[]> {
  const rows = await q<{ actions: RailAction[] }>("SELECT actions FROM rail_modules WHERE updated_at > now() - interval '90 days' AND jsonb_array_length(actions) > 0 ORDER BY updated_at DESC LIMIT 200");
  return [...new Set(rows.map((r) => railCategory(r.actions)).filter((c): c is string => !!c))].slice(0, 40);
}

/** What the owner sees now: warnings and errors, then tasks a guest added that still need a day, then the rest. */
export async function activeModules(): Promise<RailModule[]> {
  const { waitingModules } = await import("./guests");
  const [stored, waiting] = await Promise.all([storedModules(), waitingModules()]);
  const urgent = stored.filter((m) => m.level !== "info");
  return [...urgent, ...waiting, ...stored.filter((m) => m.level === "info")];
}

async function storedModules(): Promise<RailModule[]> {
  const rows = await q<RailModule>(
    `SELECT m.* FROM rail_modules m WHERE m.dismissed_at IS NULL AND m.show_from <= now() AND m.show_until > now() AND ${TASK_OPEN}
     ORDER BY CASE m.level WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, m.priority DESC, m.show_until, m.created_at`,
  );
  const ids = [...new Set(rows.map((r) => r.page_id).filter(Boolean))] as string[];
  const pages = ids.length ? await q<{ id: string; title: string }>("SELECT id, title FROM context_nodes WHERE id = ANY($1) AND NOT archived", [ids]) : [];
  const taskIds = [...new Set(rows.map((r) => r.todo_id).filter(Boolean))] as string[];
  const tasks = taskIds.length ? await q<{ id: string; title: string }>("SELECT id, title FROM todos WHERE id = ANY($1)", [taskIds]) : [];
  return rows.map((r) => ({ ...r, page: pages.find((p) => p.id === r.page_id) ?? null, task: tasks.find((t) => t.id === r.todo_id) ?? null }));
}

/** Everything not yet expired, including modules scheduled for later and ones the owner has cleared. For agents. */
export async function allModules() {
  return q<RailModule & { handle: string; clears_on: string; task_done: boolean | null }>(
    `SELECT m.*, a.handle, (SELECT t.done OR t.deleted_at IS NOT NULL FROM todos t WHERE t.id = m.todo_id) AS task_done
     FROM rail_modules m JOIN agents a ON a.id = m.author WHERE m.show_until > now() ORDER BY m.dismissed_at IS NOT NULL, m.priority DESC, m.show_until`,
  );
}

export async function getModule(ref: string) {
  const m = await q1<RailModule & { clears_on: string }>("SELECT * FROM rail_modules WHERE id = $1 OR key = $1 ORDER BY updated_at DESC LIMIT 1", [ref]);
  if (!m) throw notFound(`No rail module "${ref}".`);
  return m;
}

/**
 * Why a module is no longer showing, if it is not, in the words agents are given. A module cleared
 * before this was recorded (cleared_by empty) is told apart by what it used to clear on.
 */
export function railGone(m: { dismissed_at: string | null; cleared_by?: string | null; clears_on?: string; kept_todo_id?: string | null; task_done?: boolean | null; sent?: RailSent | null }) {
  // what the owner sent back from one of its buttons, whenever they did
  const sent = m.sent ? { sent: m.sent.send, sent_label: m.sent.label, sent_at: m.sent.at } : {};
  if (!m.dismissed_at) return m.task_done ? { task_done: true, ...sent } : sent;
  const by = m.cleared_by ?? (m.clears_on && m.clears_on !== "dismiss" ? "action" : "dismiss");
  if (by === "dismiss") return { dismissed_by_owner: true, ...sent };
  return { cleared_by_owner: by, ...(by === "later" && m.kept_todo_id ? { kept_as: m.kept_todo_id } : {}), ...sent };
}

/** Says in the log that a module left the rail and why, addressed to the agent that put it there. */
async function logGone(actor: Agent, m: RailModule, type: string, by: string, summary: string, more: Record<string, unknown> = {}) {
  const author = await q1<{ handle: string }>("SELECT handle FROM agents WHERE id = $1", [m.author]);
  await logEvent({ actor: actor.id, type, entity_type: "rail", entity_id: m.id, summary, data: { key: m.key, by, author: author?.handle, ...(m.todo_id ? { todo: m.todo_id } : {}), ...more } });
}

/** An agent removes its own module by key; the owner dismisses any module by id. */
export async function removeModule(actor: Agent, ref: string) {
  const m =
    actor.kind === "human"
      ? await q1<RailModule>("SELECT * FROM rail_modules WHERE id = $1", [ref])
      : await q1<RailModule>("SELECT * FROM rail_modules WHERE author = $1 AND (key = $2 OR id = $2)", [actor.id, ref]);
  if (!m) throw notFound(actor.kind === "human" ? "No such module." : `You have no rail module "${ref}". You can only remove your own.`);
  if (actor.kind === "human") await q("UPDATE rail_modules SET dismissed_at = now(), cleared_by = 'dismiss' WHERE id = $1", [m.id]);
  else await q("DELETE FROM rail_modules WHERE id = $1", [m.id]);
  if (actor.kind === "human") await logGone(actor, m, "rail.dismissed", "dismiss", m.title);
  else await logEvent({ actor: actor.id, type: "rail.removed", entity_type: "rail", entity_id: m.id, summary: m.title, data: { key: m.key } });
  return { ok: true };
}

/**
 * The owner tapped one of a module's buttons (an action, its page, its task, or "Got it"). That
 * is what the module was there for, so it leaves the rail. Its author is told which button.
 */
export async function moduleActed(actor: Agent, id: string, label?: unknown): Promise<{ cleared: boolean; sent?: { label: string; to: { name: string; handle: string } | null } | null }> {
  if (actor.kind !== "human") return { cleared: false };
  const tapped = typeof label === "string" ? label.trim().slice(0, 40) : "";
  const before = await q1<RailModule>("SELECT * FROM rail_modules WHERE id = $1", [id]);
  const sends = before?.actions?.find((a) => a.send && a.label === tapped);
  if (before && sends) return moduleSent(actor, before, sends);
  const m = await q1<RailModule>("UPDATE rail_modules SET dismissed_at = now(), cleared_by = 'action' WHERE id = $1 AND dismissed_at IS NULL RETURNING *", [id]);
  if (m) await logGone(actor, m, "rail.cleared", "action", `${m.title}: the owner ${tapped ? `chose "${tapped}"` : "acted on it"}`, tapped ? { action: tapped } : {});
  return { cleared: !!m };
}

/**
 * The owner tapped a button that sends an action back to the module's author. The module has done
 * its job and leaves the rail; the action is kept on it, the author is woken, and it waits under
 * for_you in the author's changes() until it looks. The answer comes back at once, whether or not
 * the agent is running, so the owner can be told it was sent. It can be sent from the task a module
 * became, after the module itself has gone; it is sent once, and a second tap changes nothing.
 */
async function moduleSent(actor: Agent, m: RailModule, action: RailAction) {
  const author = await q1<{ handle: string; name: string }>("SELECT handle, name FROM agents WHERE id = $1", [m.author]);
  const to = author ? { name: author.name, handle: author.handle } : null;
  const sent: RailSent = { label: action.label, send: action.send!, at: new Date().toISOString() };
  const done = await q1<RailModule>(
    `UPDATE rail_modules SET sent = $2::jsonb, cleared_by = CASE WHEN dismissed_at IS NULL THEN 'action' ELSE cleared_by END, dismissed_at = COALESCE(dismissed_at, now())
     WHERE id = $1 AND sent IS NULL RETURNING *`,
    [m.id, JSON.stringify(sent)],
  );
  if (!done) return { cleared: false, sent: m.sent ? { label: m.sent.label, to } : null };
  const seq = await logEvent({
    actor: actor.id,
    type: "rail.cleared",
    entity_type: "rail",
    entity_id: m.id,
    summary: `${m.title}: the owner chose "${action.label}"`,
    // naming the author is what wakes it
    mentions: author ? [author.handle] : [],
    data: { key: m.key, by: "action", author: author?.handle, action: action.label, sent: action.send, ...(m.todo_id ? { todo: m.todo_id } : {}) },
  });
  await q("UPDATE rail_modules SET sent = sent || jsonb_build_object('seq', $2::bigint) WHERE id = $1", [m.id, seq]);
  // A module that asks about a house rule is answered here, by the server: an approved change is
  // applied exactly as proposed, whether or not its agent ever runs again.
  const { decideByModule, isProposalModule } = await import("./rules");
  if (isProposalModule(m.key)) await decideByModule(m.id, action.send === "approve");
  return { cleared: true, sent: { label: action.label, to } };
}

/** An answer the owner sent to an agent from one of its modules, as the Agents screen lists it. */
export type SentAnswer = { id: string; agent_id: string; title: string; label: string; at: string; picked_up: boolean };

/**
 * The answers the owner has sent to agents in the last two weeks, newest first: which module,
 * which button, when, and whether the agent has read far enough to have seen it. An agent that
 * has acted usually removes its module, and the answer goes with it.
 */
export async function sentAnswers(): Promise<SentAnswer[]> {
  return q<SentAnswer>(
    `SELECT m.id, m.author AS agent_id, m.title, m.sent->>'label' AS label, m.sent->>'at' AS at,
            COALESCE(a.cursor_seq >= (m.sent->>'seq')::bigint, false) AS picked_up
     FROM rail_modules m JOIN agents a ON a.id = m.author
     WHERE m.sent IS NOT NULL AND (m.sent->>'at')::timestamptz > now() - interval '14 days'
     ORDER BY (m.sent->>'at')::timestamptz DESC LIMIT 60`,
  );
}

/** What a module says beyond its title, as the notes of the task it becomes: its sentence, then its block. */
function keptNotes(m: RailModule): string {
  const parts = [m.subtitle?.trim() ?? ""];
  for (const b of m.blocks ?? []) {
    if (b.type === "text") parts.push(String((b as { markdown?: unknown }).markdown ?? "").trim());
    else {
      const { type, ...fields } = b as AnyBlock & Record<string, unknown>;
      parts.push("```" + type + "\n" + JSON.stringify(fields) + "\n```");
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

/**
 * "Later": the owner is not acting on a module now and does not want to lose it. It goes on a day
 * in their list as a task and leaves the rail. A module that is already about a task (todo_id), or
 * was kept before and comes back changed, moves that task instead of making a second one. The task
 * keeps the module's buttons (see railFor), and the module's author is told which task it became.
 */
export async function moduleLater(actor: Agent, id: string, view: unknown) {
  if (actor.kind !== "human") throw bad("Only the owner keeps a module for later.");
  if (typeof view !== "string" || !(RAIL_LATER as readonly string[]).includes(view)) throw bad(`view says where the task goes: ${RAIL_LATER.join(", ")}.`);
  const m = await q1<RailModule>("SELECT * FROM rail_modules WHERE id = $1", [id]);
  if (!m) throw notFound("No such module.");
  // todos reads the rail too, so it is loaded when needed rather than at the top
  const { createTodo, updateTodo, markAgentText } = await import("./todos");
  const refs = [m.todo_id, m.kept_todo_id].filter(Boolean) as string[];
  const open = refs.length ? await q<{ id: string }>("SELECT id FROM todos WHERE id = ANY($1) AND NOT done AND deleted_at IS NULL", [refs]) : [];
  const has = refs.find((r) => open.some((t) => t.id === r));
  let todo = has;
  if (has) await updateTodo(actor, has, { view });
  else {
    // the words are the agent's, so they are marked as its own, like anything an agent writes in a task
    const author = await q1<{ handle: string }>("SELECT handle FROM agents WHERE id = $1", [m.author]);
    const notes = keptNotes(m);
    todo = (await createTodo(actor, { title: m.title, view, notes: notes && author ? markAgentText(notes, author.handle) : notes })).id;
  }
  await q("UPDATE rail_modules SET dismissed_at = now(), cleared_by = 'later', kept_todo_id = $2 WHERE id = $1", [m.id, todo === m.todo_id ? m.kept_todo_id ?? null : todo]);
  await logGone(actor, m, "rail.cleared", "later", `${m.title}: the owner kept it for later as a task`, { todo });
  return { todo };
}

/** What a task shows of the module it came from, so the owner can still act from the task. */
export type TodoRail = { id: string; key: string; author: string; title: string; label: string; actions: RailAction[]; page_id: string | null; kept: boolean; /** what the owner sent its author from one of its buttons; picked_up once the author has read that far */ sent: RailSent | null };
/**
 * The module a task is tied to, as SQL for a column named rail: the one that points at it, or the
 * one it was kept from. It is there while the module is (its author removes it once the matter is
 * settled), so a task never offers a button for something that has passed.
 */
export const TODO_RAIL = `(SELECT jsonb_build_object('id', m.id, 'key', m.key, 'author', m.author, 'title', m.title, 'label', m.label, 'actions', m.actions, 'page_id', m.page_id, 'kept', m.kept_todo_id IS NOT DISTINCT FROM todos.id,
     'sent', CASE WHEN m.sent IS NULL THEN NULL ELSE m.sent || jsonb_build_object('picked_up', COALESCE((SELECT a.cursor_seq >= (m.sent->>'seq')::bigint FROM agents a WHERE a.id = m.author), false)) END)
   FROM rail_modules m WHERE m.todo_id = todos.id OR m.kept_todo_id = todos.id ORDER BY m.updated_at DESC LIMIT 1) AS rail`;

/**
 * Something happened to a task that modules point at.
 * - todo_open: the owner has it open, which is the same as tapping "Open task": its modules leave
 *   the rail for good.
 * - todo_done, todo_deleted: nothing is left to follow up, so every module about it is gone from
 *   the rail. They are hidden rather than dismissed (see TASK_OPEN), so unticking the task, or
 *   bringing it back from the bin, shows them again.
 * Each module's author is told.
 */
export async function taskChanged(actor: Agent, todoId: string, what: "todo_open" | "todo_done" | "todo_deleted") {
  const rows =
    what === "todo_open"
      ? await q<RailModule>("UPDATE rail_modules SET dismissed_at = now(), cleared_by = 'todo_open' WHERE todo_id = $1 AND dismissed_at IS NULL AND show_from <= now() AND show_until > now() RETURNING *", [todoId])
      : await q<RailModule>("SELECT * FROM rail_modules WHERE todo_id = $1 AND dismissed_at IS NULL AND show_until > now()", [todoId]);
  const said = { todo_open: "the owner opened the task", todo_done: "the task is done", todo_deleted: "the task was deleted" }[what];
  for (const m of rows) await logGone(actor, m, "rail.cleared", what, `${m.title}: ${said}`);
  return rows.length;
}

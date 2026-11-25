import { checkBlocks, mendBlocks } from "../blocks";
import { q, q1 } from "../db";
import { listPlan, planScope, readPlan, type PlanItem } from "./plan";
import { TODO_RAIL, taskChanged, type TodoRail } from "./rail";
import { getPost, REPLY_MAX, REPLY_SLACK, resolvePage, tooLong, withPages, type Post } from "./posts";
import { addDays, agentById, bad, cleanTags, defaultAgent, findMentions, indexDoc, listGuests, logEvent, mondayOf, newId, notFound, oneLine, timezone, todayIn, unindexDoc, weekday, type Agent } from "./util";

export type Todo = {
  id: string;
  title: string;
  notes: string;
  /** guest: on a guest's list and not yet placed on a day by the owner. */
  scope: "day" | "week" | "backlog" | "guest";
  date: string | null;
  position: number;
  done: boolean;
  done_at: string | null;
  ai_unseen: boolean;
  created_by: string;
  /**
   * Set when the task belongs to a guest's shared list ("From Meredith"). It is a category, not a
   * place: the task stays in that list whatever day it is given, and the guest can see and edit it.
   */
  guest_id: string | null;
  /** How often the task comes round again. Finishing it creates the next one, counted from the day it was finished. */
  repeat: Repeat | null;
  /** On a finished repeating task: the task that was created to follow it. */
  next_id: string | null;
  /** The day that following task is on, while it exists. */
  next_date?: string | null;
  /** Short labels the lists can be narrowed to ("finance", "house"). At most six. */
  tags: string[];
  /** The line of the plan the task is part of (a priority, or a part of one), if any. */
  plan_id: string | null;
  /** That line's name, as the lists show it. */
  plan?: string | null;
  /** The agent the task has been given to, if any (an agent's id). */
  assignee?: string | null;
  /** How many things have been said in the task's conversation. */
  said?: number;
  /** The rail module this task is tied to, while that module exists: the one pointing at it, or the one it was kept from with "Later". */
  rail?: TodoRail | null;
  created_at: string;
  updated_at: string;
};

export const REPEATS = ["daily", "every_3_days", "weekly", "biweekly", "monthly", "yearly"] as const;
export type Repeat = (typeof REPEATS)[number];

/** The day a repeating task comes round again, counted from the day it was finished. Month ends are kept in range (31 January gives 28 February). */
export function nextDate(from: string, repeat: Repeat): string {
  if (repeat === "daily") return addDays(from, 1);
  if (repeat === "every_3_days") return addDays(from, 3);
  if (repeat === "weekly") return addDays(from, 7);
  if (repeat === "biweekly") return addDays(from, 14);
  const [y, m, d] = from.split("-").map(Number);
  const ny = repeat === "yearly" ? y + 1 : m === 12 ? y + 1 : y;
  const nm = repeat === "yearly" ? m : m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export type Folder = { key: string; label: string; hint?: string; count: number; guest?: string };
/** A tag in use on the tasks, with how many unfinished tasks carry it. */
export type TagCount = { tag: string; count: number };
/** How long a deleted task can still be brought back. */
export const BIN_DAYS = 15;
export type BinnedTodo = { id: string; title: string; done: boolean; has_notes: boolean; deleted_at: string; days_left: number };

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PLAN_NAME = "(SELECT p.title FROM plan_items p WHERE p.id = todos.plan_id) AS plan";
const NEXT_DATE = "(SELECT n.date FROM todos n WHERE n.id = todos.next_id AND n.deleted_at IS NULL) AS next_date";
/** What makes two tasks neighbours in one ordered list: the same day, week or list (and, while waiting on a guest's list, the same guest). */
const PLACE = "scope, date, (CASE WHEN scope = 'guest' THEN guest_id END)";
const SAID = "(SELECT count(*)::int FROM posts s WHERE s.todo_id = todos.id) AS said";
const LIST_COLS = `id, title, scope, date, position, done, done_at, ai_unseen, created_by, guest_id, repeat, next_id, tags, plan_id, assignee, created_at, updated_at, (notes <> '') AS has_notes, ${NEXT_DATE}, ${PLAN_NAME}, ${SAID}`;

/** Unfinished tasks never get left behind: past days roll to today, past weeks roll to this week. */
async function rollover(today: string) {
  const monday = mondayOf(today);
  await q("UPDATE todos SET date = $1 WHERE scope = 'day' AND NOT done AND date < $1", [today]);
  await q("UPDATE todos SET date = $1 WHERE scope = 'week' AND NOT done AND date < $1", [monday]);
}

export async function calendar() {
  const today = todayIn(await timezone());
  const monday = mondayOf(today);
  return { today, monday, saturday: addDays(monday, 5), sunday: addDays(monday, 6), nextMonday: addDays(monday, 7), dow: weekday(today) };
}

/** A view by any of the spellings people and agents reach for: "next week", "this-week", "Next_Week". */
const VIEW_ALIASES: Record<string, string> = { this_week: "week", thisweek: "week", nextweek: "next_week", this_weekend: "weekend", someday: "backlog", everything: "all" };
export function viewName(view: string): string {
  if (view.startsWith("guest:") || /^\d{4}-\d{2}-\d{2}$/.test(view)) return view;
  const v = view.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return VIEW_ALIASES[v] ?? v;
}

type Spec = { where: string; params: unknown[]; add: { scope: string; date: string | null; guest_id?: string } };

/** Where a view's tasks live, and where a task added to that view should go. */
function viewSpec(viewIn: string, cal: Awaited<ReturnType<typeof calendar>>): Spec {
  const { today, monday, saturday, sunday, nextMonday } = cal;
  const view = viewName(viewIn);
  // everything on a guest's list, placed on a day or not; a task added here starts without a day
  if (view.startsWith("guest:")) return { where: "guest_id = $1", params: [view.slice(6)], add: { scope: "guest", date: null, guest_id: view.slice(6) } };
  if (view === "today") return { where: "scope = 'day' AND date = $1", params: [today], add: { scope: "day", date: today } };
  if (view === "tomorrow") return viewSpec(addDays(today, 1), cal);
  if (view === "week")
    return {
      where: "((scope = 'day' AND date BETWEEN $1 AND $2) OR (scope = 'week' AND date = $1))",
      params: [monday, sunday],
      add: { scope: "week", date: monday },
    };
  if (view === "weekend")
    return { where: "scope = 'day' AND date BETWEEN $1 AND $2", params: [saturday, sunday], add: { scope: "day", date: today > saturday ? today : saturday } };
  if (view === "next_week")
    return {
      where: "((scope = 'day' AND date BETWEEN $1 AND $2) OR (scope = 'week' AND date = $1))",
      params: [nextMonday, addDays(nextMonday, 6)],
      add: { scope: "week", date: nextMonday },
    };
  // dated beyond next week: nothing else shows these until their week comes
  if (view === "later") return { where: "((scope = 'day' AND date > $1) OR (scope = 'week' AND date > $2))", params: [addDays(nextMonday, 6), nextMonday], add: { scope: "day", date: addDays(nextMonday, 7) } };
  if (view === "backlog") return { where: "scope = 'backlog'", params: [], add: { scope: "backlog", date: null } };
  // every task, wherever it is: a view across the lists, so a task added to it goes on today
  if (view === "all") return { where: "TRUE", params: [], add: { scope: "day", date: today } };
  if (/^\d{4}-\d{2}-\d{2}$/.test(view)) return { where: "scope = 'day' AND date = $1", params: [view], add: { scope: "day", date: view } };
  throw bad(`Unknown view "${view}". Use today, tomorrow, week, weekend, next_week, later, backlog, all or a YYYY-MM-DD date.`);
}

export async function folders(): Promise<{ today: string; folders: Folder[]; bin: number; tags: TagCount[]; plan: PlanItem[] }> {
  const cal = await calendar();
  await rollover(cal.today);
  await emptyOldBin();
  const list: { key: string; label: string; hint?: string; guest?: string }[] = [
    { key: "week", label: "This week" },
    { key: "today", label: "Today", hint: DAY_NAMES[cal.dow] },
  ];
  // The remaining weekdays up to Friday, then the weekend (unless we're already in it).
  for (let d = cal.dow + 1; d <= 5; d++) list.push({ key: addDays(cal.monday, d - 1), label: d === cal.dow + 1 ? "Tomorrow" : DAY_NAMES[d], hint: d === cal.dow + 1 ? DAY_NAMES[d] : undefined });
  if (cal.dow <= 5) list.push({ key: "weekend", label: "Weekend" });
  else if (cal.dow === 6) list.push({ key: cal.sunday, label: "Tomorrow", hint: "Sunday" });
  list.push({ key: "next_week", label: "Next week" }, { key: "later", label: "Later" }, { key: "backlog", label: "Backlog" }, { key: "all", label: "All" });
  for (const g of await listGuests()) list.push({ key: `guest:${g.id}`, label: `From ${g.name}`, guest: g.id });

  const out: Folder[] = [];
  for (const f of list) {
    const spec = viewSpec(f.key, cal);
    const r = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM todos WHERE deleted_at IS NULL AND NOT done AND ${spec.where}`, spec.params);
    // "Later" is there only while something is dated that far ahead
    if (f.key === "later" && !r?.n) continue;
    out.push({ ...f, count: r?.n ?? 0 });
  }
  const bin = (await q1<{ n: number }>("SELECT count(*)::int AS n FROM todos WHERE deleted_at IS NOT NULL"))!.n;
  return { today: cal.today, folders: out, bin, tags: await tagCounts(), plan: await listPlan() };
}

/** Every tag in use, most used first. The count is of unfinished tasks, so a tag stays known after its tasks are done. */
export async function tagCounts(): Promise<TagCount[]> {
  return q<TagCount>("SELECT tag, (count(*) FILTER (WHERE NOT done))::int AS count FROM todos, unnest(tags) AS tag WHERE deleted_at IS NULL GROUP BY tag ORDER BY 2 DESC, lower(tag)");
}

/** Tags as given (a list, or one string with commas), tidied, each in the spelling the tasks already use. */
async function readTags(raw: unknown): Promise<string[]> {
  const tags = cleanTags(typeof raw === "string" ? raw.split(",") : raw);
  if (!tags.length) return tags;
  const known = await q<{ tag: string }>("SELECT DISTINCT tag FROM todos, unnest(tags) AS tag WHERE deleted_at IS NULL AND lower(tag) = ANY($1)", [tags.map((t) => t.toLowerCase())]);
  return tags.map((t) => known.find((k) => k.tag.toLowerCase() === t.toLowerCase())?.tag ?? t);
}

/** A task as search finds it: its title, then its notes and tags. */
const indexTodo = (t: Pick<Todo, "id" | "title" | "notes" | "tags">) => indexDoc("todo", t.id, t.title, t.tags?.length ? `${t.notes}\n${t.tags.join(", ")}` : t.notes);

export async function listTodos(view: string, opts: { tags?: string[]; /** a line of the plan (a priority brings its parts with it), or "none" for the tasks that are part of nothing */ plan?: string } = {}) {
  const cal = await calendar();
  await rollover(cal.today);
  const spec = viewSpec(view, cal);
  // Finished tasks stay visible in the undated lists only for a day so they keep moving.
  const guest = view.startsWith("guest:");
  const all = view === "all";
  const doneClause = view === "backlog" || guest || all ? "AND (NOT done OR done_at > now() - interval '1 day')" : "";
  // A guest's list spans every day: what still needs a day comes first, then by day, with the backlog last.
  // "All" runs by day too, with the backlog and what still waits for a day at the end.
  const order = guest
    ? "(scope = 'guest') DESC, (scope = 'backlog'), date, scope DESC, position, id"
    : all
      ? "(scope = 'guest'), (scope = 'backlog'), date, scope DESC, position, id"
      : "date NULLS FIRST, scope DESC, position, id";
  // narrowed to tasks carrying every one of these tags, whatever their capitals
  const wanted = cleanTags(opts.tags).map((t) => t.toLowerCase());
  const params = [...spec.params];
  let tagClause = "";
  if (wanted.length) {
    params.push(wanted);
    tagClause = `AND $${params.length}::text[] <@ ARRAY(SELECT lower(x) FROM unnest(tags) AS x)`;
  }
  if (opts.plan === "none") tagClause += " AND plan_id IS NULL";
  else if (opts.plan) {
    params.push(await planScope(opts.plan));
    tagClause += ` AND plan_id = ANY($${params.length})`;
  }
  // ord is where a task stands among those on its day or list, 1 first, as the owner arranged them.
  // It is counted before the tags narrow the list, so it is the same number however the list is asked for.
  const todos = await q<Todo & { has_notes: boolean; ord: number }>(
    `SELECT * FROM (
       SELECT ${LIST_COLS}, (row_number() OVER (PARTITION BY ${PLACE} ORDER BY position, id))::int AS ord
       FROM todos WHERE deleted_at IS NULL AND ${spec.where} ${doneClause}
     ) t WHERE true ${tagClause} ORDER BY ${order}`,
    params,
  );
  return { view, today: cal.today, todos };
}

export async function getTodo(id: string): Promise<Todo> {
  const t = await q1<Todo>(`SELECT *, ${NEXT_DATE}, ${PLAN_NAME}, ${TODO_RAIL}, ${SAID} FROM todos WHERE id = $1`, [id]);
  if (!t) throw notFound("No such todo");
  return t;
}

/**
 * The owner has a task open in front of them. That is the same as tapping "Open task" on a rail
 * module that points at it, so any such module leaves the rail.
 */
export async function openTodo(actor: Agent, id: string): Promise<Todo> {
  const t = await getTodo(id);
  if (actor.kind === "human" && !(t as Todo & { deleted_at?: string | null }).deleted_at) await taskChanged(actor, id, "todo_open");
  return t;
}

async function nextPosition(scope: string, date: string | null) {
  const r = await q1<{ p: number }>("SELECT COALESCE(max(position), 0) + 1 AS p FROM todos WHERE scope = $1 AND date IS NOT DISTINCT FROM $2", [scope, date]);
  return r!.p;
}

/** An order as an agent gives it: a whole number, 1 for first. */
function readOrder(v: unknown): number {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw bad("order is a whole number, 1 for first in the task's day or list.");
  return n;
}

/**
 * Puts a task at a place in the order of its day or list, counted as the lists count it: 1 is
 * first, and anything past the end is last. The tasks around it keep their order.
 */
async function placeAt(t: { id: string; scope: string; date: string | null; guest_id: string | null }, order: number) {
  // finished tasks that have dropped out of an undated list are not counted, as they are not shown
  const others = await q<{ id: string }>(
    `SELECT id FROM todos
     WHERE deleted_at IS NULL AND id <> $1 AND scope = $2 AND date IS NOT DISTINCT FROM $3
       AND ($2 <> 'guest' OR guest_id IS NOT DISTINCT FROM $4)
       AND (scope IN ('day', 'week') OR NOT done OR done_at > now() - interval '1 day')
     ORDER BY position, id`,
    [t.id, t.scope, t.date, t.guest_id],
  );
  const ids = others.map((o) => o.id);
  ids.splice(Math.min(order - 1, ids.length), 0, t.id);
  await q("UPDATE todos t SET position = o.ord FROM unnest($1::text[]) WITH ORDINALITY AS o(id, ord) WHERE t.id = o.id", [ids]);
}

function guardBlocks(actor: Agent, md: string) {
  if (actor.kind !== "agent") return;
  const problems = checkBlocks(md);
  if (problems.length) throw bad(`${problems.join(" ")} Fix the block and send it again. See guide("pages") for each block's fields.`);
}

/** Wraps each line an agent wrote in <ins> so the editor can show exactly what changed and who did it. */
export function markAgentText(md: string, handle: string): string {
  let fence = false;
  const stamp = new Date().toISOString();
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fence = !fence;
        return line;
      }
      if (fence || !line.trim() || /^\s*(!\[|---+\s*$|\|)/.test(line)) return line;
      const m = line.match(/^(\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s+)?)(.*)$/)!;
      if (!m[2].trim()) return line;
      return `${m[1]}<ins data-agent="${handle}" data-ts="${stamp}">${m[2]}</ins>`;
    })
    .join("\n");
}

async function afterWrite(actor: Agent, t: Todo, type: string, summary: string, extraMentions: string[] = [], extraData: Record<string, unknown> = {}) {
  await indexTodo(t);
  // A guest's task carries someone else's words: an @handle in its title must not call on the owner's agents.
  const mentions = [...new Set([...(t.guest_id ? [] : await findMentions(t.title)), ...extraMentions])];
  await logEvent({ actor: actor.id, type, entity_type: "todo", entity_id: t.id, summary, mentions, data: { scope: t.scope, date: t.date, ...extraData } });
}

function readRepeat(v: unknown): Repeat | null {
  if (v === null || v === "" || v === "none" || v === "never") return null;
  if (!REPEATS.includes(v as Repeat)) throw bad(`Unknown repeat "${v}". Use ${REPEATS.join(", ")} or none.`);
  return v as Repeat;
}

/** The next round of a repeating task that has just been finished: the same task, on its next day. */
async function createNext(actor: Agent, t: Todo, today: string): Promise<string> {
  const id = newId("t");
  const date = nextDate(today, t.repeat!);
  await q("INSERT INTO todos (id, title, notes, scope, date, position, created_by, guest_id, repeat, tags, plan_id) VALUES ($1,$2,$3,'day',$4,$5,$6,$7,$8,$9,$10)", [
    id, t.title, t.notes, date, await nextPosition("day", date), t.created_by, t.guest_id, t.repeat, t.tags ?? [], t.plan_id ?? null,
  ]);
  const next = await getTodo(id);
  await indexTodo(next);
  await logEvent({ actor: actor.id, type: "todo.created", entity_type: "todo", entity_id: id, summary: `${t.title} (repeats ${t.repeat})`, mentions: [], data: { scope: "day", date, repeat_of: t.id } });
  return id;
}

/** The agent a task is given to, from an id or an @handle; null, "" or "none" for nobody. */
async function readAssignee(v: unknown): Promise<Agent | null> {
  if (v === null || v === "" || v === "none") return null;
  if (typeof v !== "string") throw bad("assignee is an agent's @handle, or null to take the task back.");
  const ref = v.trim().replace(/^@/, "");
  const a = await q1<{ id: string }>("SELECT id FROM agents WHERE (id = $1 OR handle = lower($1)) AND kind = 'agent' AND NOT archived", [ref]);
  if (!a) throw bad(`No agent "${v}". A task is given to one of the owner's agents, by its @handle.`);
  return agentById(a.id);
}

export async function createTodo(actor: Agent, input: { title: string; view?: string; notes?: string; repeat?: string | null; tags?: string[] | string; /** the line of the plan it is part of */ plan?: string | null; /** where it goes among the tasks of its day or list, 1 first; left out, it goes last */ order?: number; /** the agent it is given to, by @handle or id */ assignee?: string | null }) {
  const title = (input.title ?? "").trim();
  if (!title) throw bad("Todo needs a title.");
  const cal = await calendar();
  const { add } = viewSpec(input.view || "today", cal);
  if (add.guest_id && !(await listGuests()).some((g) => g.id === add.guest_id)) throw bad(`Unknown view "${input.view}".`);
  const id = newId("t");
  // small slips in an agent's blocks are put right rather than refused (see mendBlocks)
  if (actor.kind === "agent" && input.notes) input = { ...input, notes: mendBlocks(input.notes) };
  if (input.notes) guardBlocks(actor, input.notes);
  const notes = input.notes ? (actor.kind === "agent" ? markAgentText(input.notes, actor.handle) : input.notes) : "";
  const repeat = input.repeat === undefined ? null : readRepeat(input.repeat);
  const tags = input.tags === undefined ? [] : await readTags(input.tags);
  const order = input.order === undefined || input.order === null ? null : readOrder(input.order);
  const plan = input.plan === undefined ? null : await readPlan(input.plan);
  const to = input.assignee === undefined ? null : await readAssignee(input.assignee);
  await q("INSERT INTO todos (id, title, notes, scope, date, position, created_by, ai_unseen, guest_id, repeat, tags, plan_id, assignee) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [
    id, title.slice(0, 300), notes, add.scope, add.date, await nextPosition(add.scope, add.date), actor.id, actor.kind === "agent", add.guest_id ?? null, repeat, tags, plan, to?.id ?? null,
  ]);
  if (order !== null) await placeAt({ id, scope: add.scope, date: add.date, guest_id: add.guest_id ?? null }, order);
  const t = await getTodo(id);
  // whoever it is given to is told, as if named
  await afterWrite(actor, t, "todo.created", to && to.id !== actor.id ? `${title} (given to @${to.handle})` : title, [...(await findMentions(notes)), ...(to && to.id !== actor.id ? [to.handle] : [])], to && to.id !== actor.id ? { assignee: to.handle } : {});
  return t;
}

export async function updateTodo(
  actor: Agent,
  id: string,
  patch: {
    title?: string;
    done?: boolean;
    view?: string;
    notes?: string;
    notes_append?: string;
    notes_replace?: { find: string; replace: string };
    seen?: boolean;
    /** daily, every_3_days, weekly, biweekly, monthly, yearly; null or "none" to stop repeating */
    repeat?: string | null;
    /** the whole set of tags, replacing what is there; an empty list takes them all off */
    tags?: string[] | string;
    /** the line of the plan it is part of; null, "" or "none" takes it out of the plan */
    plan?: string | null;
    /** where it goes among the tasks of its day or list (after any move in the same change), 1 first */
    order?: number;
    /** the agent it is given to, by @handle or id; null, "" or "none" takes it back */
    assignee?: string | null;
  },
) {
  const before = await getTodo(id);
  const order = patch.order === undefined || patch.order === null ? null : readOrder(patch.order);
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  let summary = before.title;
  let type = "todo.updated";
  let newMentions: string[] = [];

  if (patch.title !== undefined && patch.title.trim() && patch.title !== before.title) {
    set("title", patch.title.trim().slice(0, 300));
    summary = patch.title.trim();
  }
  const repeat = patch.repeat === undefined ? before.repeat : readRepeat(patch.repeat);
  if (repeat !== before.repeat) set("repeat", repeat);
  if (patch.tags !== undefined) {
    const tags = await readTags(patch.tags);
    if (tags.join("\n") !== (before.tags ?? []).join("\n")) set("tags", tags);
  }
  if (patch.plan !== undefined) {
    const plan = await readPlan(patch.plan);
    if (plan !== (before.plan_id ?? null)) set("plan_id", plan);
  }
  // Giving the task to an agent tells that agent, as naming it would.
  let given: Agent | null = null;
  if (patch.assignee !== undefined) {
    const to = await readAssignee(patch.assignee);
    if ((to?.id ?? null) !== (before.assignee ?? null)) {
      set("assignee", to?.id ?? null);
      if (to && to.id !== actor.id) given = to;
    }
  }
  // made after the update, so the next round carries any new title or notes from the same change
  let makeNext = false;
  if (patch.done !== undefined && patch.done !== before.done) {
    set("done", patch.done);
    set("done_at", patch.done ? new Date().toISOString() : null);
    type = patch.done ? "todo.completed" : "todo.reopened";
    const next = before.next_id ? await q1<{ done: boolean }>("SELECT done FROM todos WHERE id = $1", [before.next_id]) : null;
    if (patch.done) makeNext = !!repeat && !next;
    else if (next && !next.done) {
      // ticked by mistake and unticked: the round it created goes too, so nothing is doubled
      await q("DELETE FROM todos WHERE id = $1", [before.next_id]);
      await unindexDoc("todo", before.next_id!);
      set("next_id", null);
    }
  }
  if (patch.view) {
    const { add } = viewSpec(patch.view, await calendar());
    // Only a task already shared with a guest can go back to their list; moving another task there would show it to them.
    // Moving one there takes it off its day. Giving it a day never takes it off the list: guest_id is left alone.
    if (add.guest_id && add.guest_id !== before.guest_id) throw bad("Only tasks from that person can be moved to their list.");
    if (add.scope !== before.scope || add.date !== before.date) {
      set("scope", add.scope);
      set("date", add.date);
      set("position", await nextPosition(add.scope, add.date));
      summary = `${before.title} → ${patch.view}`;
    }
  }

  // small slips in an agent's blocks are put right rather than refused (see mendBlocks)
  if (actor.kind === "agent" && patch.notes_append) patch = { ...patch, notes_append: mendBlocks(patch.notes_append) };
  if (actor.kind === "agent" && patch.notes_replace?.replace) patch = { ...patch, notes_replace: { ...patch.notes_replace, replace: mendBlocks(patch.notes_replace.replace) } };
  let notes: string | undefined;
  if (patch.notes !== undefined) {
    // Whole-document writes come from the editor (the owner). Agents make targeted, marked edits.
    if (actor.kind === "agent") throw bad("Agents edit notes with notes_append or notes_replace so their changes are marked for review.");
    notes = patch.notes;
  } else if (patch.notes_append) {
    const add = actor.kind === "agent" ? markAgentText(patch.notes_append, actor.handle) : patch.notes_append;
    notes = before.notes.trim() ? `${before.notes.trimEnd()}\n\n${add}` : add;
  } else if (patch.notes_replace) {
    const { find, replace } = patch.notes_replace;
    if (!find || !before.notes.includes(find)) throw bad("notes_replace.find was not found in the notes. Read the todo first and copy the exact text.");
    notes = before.notes.replace(find, actor.kind === "agent" ? markAgentText(replace, actor.handle) : replace);
  }
  if (notes !== undefined && notes !== before.notes) {
    guardBlocks(actor, patch.notes_append ?? patch.notes_replace?.replace ?? "");
    if (notes.length > 400_000) throw bad("Notes are too long.");
    set("notes", notes);
    const was = new Set(await findMentions(before.notes));
    newMentions = (await findMentions(notes)).filter((h) => !was.has(h));
    if (actor.kind === "agent") {
      set("ai_unseen", true);
      type = "todo.notes_edited";
    } else if (newMentions.length) {
      type = "todo.mentioned";
      summary = `${before.title}: asked ${newMentions.map((h) => "@" + h).join(", ")} for help`;
    }
  }
  if (patch.seen) set("ai_unseen", false);

  if (sets.length === 1 && order === null) return before;
  if (sets.length === 1) summary = `${before.title}: moved to place ${order} in its list`;
  await q(`UPDATE todos SET ${sets.join(", ")} WHERE id = $1`, params);
  if (order !== null) await placeAt(await getTodo(id), order);
  // a finished task has nothing left to follow up: whatever the rail says about it goes
  if (patch.done === true && !before.done) await taskChanged(actor, id, "todo_done");
  let t = await getTodo(id);
  if (makeNext) {
    await q("UPDATE todos SET next_id = $2 WHERE id = $1", [id, await createNext(actor, t, todayIn(await timezone()))]);
    t = await getTodo(id);
  }
  // Routine typing in notes by the owner isn't news; everything else is logged.
  const quiet = actor.kind === "human" && type === "todo.updated" && notes !== undefined && sets.length === 2;
  const onlySeen = patch.seen && sets.length === 2;
  if (given) {
    // one event says it was given, whatever else changed with it
    await afterWrite(actor, t, "todo.assigned", `${t.title}: given to @${given.handle}`, [...newMentions, given.handle], { assignee: given.handle });
  } else if (!quiet && !onlySeen) await afterWrite(actor, t, type, summary, newMentions);
  else await indexTodo(t);
  return t;
}

// ---------- A task's conversation ----------
// What is asked and answered about a task is said on the task: one conversation each, kept apart
// from its notes, which hold the lasting result. The owner and any agent can speak in it. Whoever
// the task is given to hears everything said there, as does everyone who has already spoken; the
// owner sees the task marked until they have looked. On a task shared with another person, that
// person reads the whole conversation.

/** Everything said on a task, oldest first. */
export async function todoThread(id: string, limit = 200): Promise<Post[]> {
  return withPages(await q<Post>("SELECT * FROM posts WHERE todo_id = $1 ORDER BY id LIMIT $2", [id, Math.min(limit, 500)]));
}

export async function sayOnTodo(actor: Agent, id: string, bodyIn: string, page?: string | null): Promise<Post> {
  if (actor.kind === "guest") throw bad("Only the owner and their agents speak in a task's conversation.");
  const t = await getTodo(id);
  if ((t as Todo & { deleted_at?: string | null }).deleted_at) throw notFound("No such todo");
  const body = (bodyIn ?? "").trim();
  if (!body) throw bad("Message is empty.");
  if (body.length > REPLY_MAX + REPLY_SLACK) throw tooLong("Message", body.length, REPLY_MAX);
  const postId = newId("p");
  const mentions = await findMentions(body);
  const pageId = await resolvePage(page);
  await q("INSERT INTO posts (id, author, channel, body, mentions, page_id, todo_id) VALUES ($1,$2,'todo',$3,$4,$5,$6)", [postId, actor.id, body, mentions, pageId, id]);
  await indexDoc("post", postId, t.title, body);
  // who hears it: whoever the task is given to, every agent that has spoken on it, anyone named
  const spoke = await q<{ handle: string }>("SELECT DISTINCT a.handle FROM posts p JOIN agents a ON a.id = p.author WHERE p.todo_id = $1 AND a.kind = 'agent' AND NOT a.archived AND p.author <> $2", [id, actor.id]);
  const holder = t.assignee && t.assignee !== actor.id ? await agentById(t.assignee) : null;
  const tell = [...new Set([...mentions, ...spoke.map((s) => s.handle), ...(holder && !holder.archived ? [holder.handle] : [])])];
  // the owner speaking to nobody in particular, on a task given to nobody, is heard by the default agent, as in chat
  if (!tell.length && actor.kind === "human") {
    const usual = await defaultAgent();
    if (usual) tell.push(usual.handle);
  }
  // an agent's words are new to the owner: the task shows that until they have looked
  await q(`UPDATE todos SET updated_at = now()${actor.kind === "agent" ? ", ai_unseen = true" : ""} WHERE id = $1`, [id]);
  await logEvent({ actor: actor.id, type: "todo.said", entity_type: "todo", entity_id: id, summary: `${t.title}: ${oneLine(body, 200)}`, mentions: tell, data: { post: postId, named: mentions } });
  return (await getPost(postId))!;
}

export async function reorderTodos(actor: Agent, ids: string[]) {
  if (!ids.length) return;
  await q("UPDATE todos t SET position = o.ord FROM unnest($1::text[]) WITH ORDINALITY AS o(id, ord) WHERE t.id = o.id", [ids]);
}

/** Deleting moves a task to the bin. It leaves every list and search at once, and can be restored for BIN_DAYS days. */
export async function deleteTodo(actor: Agent, id: string, forever = false) {
  const t = await getTodo(id);
  if (forever) {
    if (await q1("DELETE FROM todos WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id", [id])) await dropThreads([id]);
    return;
  }
  if ((t as Todo & { deleted_at?: string | null }).deleted_at) return;
  await taskChanged(actor, id, "todo_deleted");
  await q("UPDATE todos SET deleted_at = now() WHERE id = $1", [id]);
  await unindexDoc("todo", id);
  await logEvent({ actor: actor.id, type: "todo.deleted", entity_type: "todo", entity_id: id, summary: t.title });
}

/** Puts a binned task back exactly where it was. */
export async function restoreTodo(actor: Agent, id: string) {
  const t = await getTodo(id);
  await q("UPDATE todos SET deleted_at = NULL WHERE id = $1", [id]);
  await indexTodo(t);
  await logEvent({ actor: actor.id, type: "todo.restored", entity_type: "todo", entity_id: id, summary: t.title });
  return getTodo(id);
}

/** What is in the bin, most recently deleted first. */
export async function binnedTodos(): Promise<BinnedTodo[]> {
  await emptyOldBin();
  return q<BinnedTodo>(
    `SELECT id, title, done, (notes <> '') AS has_notes, deleted_at,
            GREATEST(1, CEIL(EXTRACT(EPOCH FROM (deleted_at + make_interval(days => $1) - now())) / 86400))::int AS days_left
     FROM todos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200`,
    [BIN_DAYS],
  );
}

/** Tasks binned more than BIN_DAYS days ago are removed for good. Runs whenever the lists are read; no scheduler needed. */
async function emptyOldBin() {
  const gone = await q<{ id: string }>("DELETE FROM todos WHERE deleted_at < now() - make_interval(days => $1) RETURNING id", [BIN_DAYS]);
  if (gone.length) await dropThreads(gone.map((g) => g.id));
}

/** A task removed for good takes its conversation with it. */
async function dropThreads(ids: string[]) {
  const posts = await q<{ id: string }>("DELETE FROM posts WHERE todo_id = ANY($1) RETURNING id", [ids]);
  if (posts.length) await q("DELETE FROM search_docs WHERE entity_type = 'post' AND entity_id = ANY($1)", [posts.map((p) => p.id)]);
}

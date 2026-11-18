import { checkBlocks } from "../blocks";
import { q, q1 } from "../db";
import { TODO_RAIL, taskChanged, type TodoRail } from "./rail";
import { addDays, bad, cleanTags, findMentions, indexDoc, listGuests, logEvent, mondayOf, newId, notFound, timezone, todayIn, unindexDoc, weekday, type Agent } from "./util";

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
const NEXT_DATE = "(SELECT n.date FROM todos n WHERE n.id = todos.next_id AND n.deleted_at IS NULL) AS next_date";
const LIST_COLS = `id, title, scope, date, position, done, done_at, ai_unseen, created_by, guest_id, repeat, next_id, tags, created_at, updated_at, (notes <> '') AS has_notes, ${NEXT_DATE}`;

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

type Spec = { where: string; params: unknown[]; add: { scope: string; date: string | null; guest_id?: string } };

/** Where a view's tasks live, and where a task added to that view should go. */
function viewSpec(view: string, cal: Awaited<ReturnType<typeof calendar>>): Spec {
  const { today, monday, saturday, sunday, nextMonday } = cal;
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

export async function folders(): Promise<{ today: string; folders: Folder[]; bin: number; tags: TagCount[] }> {
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
  return { today: cal.today, folders: out, bin, tags: await tagCounts() };
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

export async function listTodos(view: string, opts: { tags?: string[] } = {}) {
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
  const tagClause = wanted.length ? `AND $${spec.params.length + 1}::text[] <@ ARRAY(SELECT lower(x) FROM unnest(tags) AS x)` : "";
  const todos = await q<Todo & { has_notes: boolean }>(
    `SELECT ${LIST_COLS} FROM todos WHERE deleted_at IS NULL AND ${spec.where} ${doneClause} ${tagClause} ORDER BY ${order}`,
    wanted.length ? [...spec.params, wanted] : spec.params,
  );
  return { view, today: cal.today, todos };
}

export async function getTodo(id: string): Promise<Todo> {
  const t = await q1<Todo>(`SELECT *, ${NEXT_DATE}, ${TODO_RAIL} FROM todos WHERE id = $1`, [id]);
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

async function afterWrite(actor: Agent, t: Todo, type: string, summary: string, extraMentions: string[] = []) {
  await indexTodo(t);
  // A guest's task carries someone else's words: an @handle in its title must not call on the owner's agents.
  const mentions = [...new Set([...(t.guest_id ? [] : await findMentions(t.title)), ...extraMentions])];
  await logEvent({ actor: actor.id, type, entity_type: "todo", entity_id: t.id, summary, mentions, data: { scope: t.scope, date: t.date } });
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
  await q("INSERT INTO todos (id, title, notes, scope, date, position, created_by, guest_id, repeat, tags) VALUES ($1,$2,$3,'day',$4,$5,$6,$7,$8,$9)", [
    id, t.title, t.notes, date, await nextPosition("day", date), t.created_by, t.guest_id, t.repeat, t.tags ?? [],
  ]);
  const next = await getTodo(id);
  await indexTodo(next);
  await logEvent({ actor: actor.id, type: "todo.created", entity_type: "todo", entity_id: id, summary: `${t.title} (repeats ${t.repeat})`, mentions: [], data: { scope: "day", date, repeat_of: t.id } });
  return id;
}

export async function createTodo(actor: Agent, input: { title: string; view?: string; notes?: string; repeat?: string | null; tags?: string[] | string }) {
  const title = (input.title ?? "").trim();
  if (!title) throw bad("Todo needs a title.");
  const cal = await calendar();
  const { add } = viewSpec(input.view || "today", cal);
  if (add.guest_id && !(await listGuests()).some((g) => g.id === add.guest_id)) throw bad(`Unknown view "${input.view}".`);
  const id = newId("t");
  if (input.notes) guardBlocks(actor, input.notes);
  const notes = input.notes ? (actor.kind === "agent" ? markAgentText(input.notes, actor.handle) : input.notes) : "";
  const repeat = input.repeat === undefined ? null : readRepeat(input.repeat);
  const tags = input.tags === undefined ? [] : await readTags(input.tags);
  await q("INSERT INTO todos (id, title, notes, scope, date, position, created_by, ai_unseen, guest_id, repeat, tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [
    id, title.slice(0, 300), notes, add.scope, add.date, await nextPosition(add.scope, add.date), actor.id, actor.kind === "agent", add.guest_id ?? null, repeat, tags,
  ]);
  const t = await getTodo(id);
  await afterWrite(actor, t, "todo.created", title, await findMentions(notes));
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
  },
) {
  const before = await getTodo(id);
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

  if (sets.length === 1) return before;
  await q(`UPDATE todos SET ${sets.join(", ")} WHERE id = $1`, params);
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
  if (!quiet && !onlySeen) await afterWrite(actor, t, type, summary, newMentions);
  else await indexTodo(t);
  return t;
}

export async function reorderTodos(actor: Agent, ids: string[]) {
  if (!ids.length) return;
  await q("UPDATE todos t SET position = o.ord FROM unnest($1::text[]) WITH ORDINALITY AS o(id, ord) WHERE t.id = o.id", [ids]);
}

/** Deleting moves a task to the bin. It leaves every list and search at once, and can be restored for BIN_DAYS days. */
export async function deleteTodo(actor: Agent, id: string, forever = false) {
  const t = await getTodo(id);
  if (forever) {
    await q("DELETE FROM todos WHERE id = $1 AND deleted_at IS NOT NULL", [id]);
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
  await q("DELETE FROM todos WHERE deleted_at < now() - make_interval(days => $1)", [BIN_DAYS]);
}

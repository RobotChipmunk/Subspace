import { checkBlocks } from "../blocks";
import { q, q1 } from "../db";
import { addDays, bad, findMentions, indexDoc, listGuests, logEvent, mondayOf, newId, notFound, timezone, todayIn, unindexDoc, weekday, type Agent } from "./util";

export type Todo = {
  id: string;
  title: string;
  notes: string;
  /** guest: added by a guest and not yet placed on a day by the owner. */
  scope: "day" | "week" | "backlog" | "guest";
  date: string | null;
  position: number;
  done: boolean;
  done_at: string | null;
  ai_unseen: boolean;
  created_by: string;
  /** Set when the task belongs to a guest's shared list ("From Meredith"). The guest can see and edit it wherever it is. */
  guest_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Folder = { key: string; label: string; hint?: string; count: number; guest?: string };
/** How long a deleted task can still be brought back. */
export const BIN_DAYS = 15;
export type BinnedTodo = { id: string; title: string; done: boolean; has_notes: boolean; deleted_at: string; days_left: number };

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const LIST_COLS = "id, title, scope, date, position, done, done_at, ai_unseen, created_by, guest_id, created_at, updated_at, (notes <> '') AS has_notes";

/** Unfinished tasks never get left behind: past days roll to today, past weeks roll to this week. */
async function rollover(today: string) {
  const monday = mondayOf(today);
  await q("UPDATE todos SET date = $1 WHERE scope = 'day' AND NOT done AND date < $1", [today]);
  await q("UPDATE todos SET date = $1 WHERE scope = 'week' AND NOT done AND date < $1", [monday]);
}

export async function calendar() {
  const today = todayIn(await timezone());
  const monday = mondayOf(today);
  return { today, monday, saturday: addDays(monday, 5), sunday: addDays(monday, 6), nextMonday: addDays(monday, 7), lastMonday: addDays(monday, -7), dow: weekday(today) };
}

type Spec = { where: string; params: unknown[]; add: { scope: string; date: string | null; guest_id?: string } };

/** Where a view's tasks live, and where a task added to that view should go. */
function viewSpec(view: string, cal: Awaited<ReturnType<typeof calendar>>): Spec {
  const { today, monday, saturday, sunday, nextMonday, lastMonday } = cal;
  // a guest's tasks that the owner has not yet placed on a day
  if (view.startsWith("guest:")) return { where: "scope = 'guest' AND guest_id = $1", params: [view.slice(6)], add: { scope: "guest", date: null, guest_id: view.slice(6) } };
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
  // Unfinished tasks roll forward, so last week holds only what was finished then.
  if (view === "last_week")
    return {
      where: "((scope = 'day' AND date BETWEEN $1 AND $2) OR (scope = 'week' AND date = $1))",
      params: [lastMonday, addDays(lastMonday, 6)],
      add: { scope: "week", date: lastMonday },
    };
  if (view === "backlog") return { where: "scope = 'backlog'", params: [], add: { scope: "backlog", date: null } };
  if (/^\d{4}-\d{2}-\d{2}$/.test(view)) return { where: "scope = 'day' AND date = $1", params: [view], add: { scope: "day", date: view } };
  throw bad(`Unknown view "${view}". Use today, tomorrow, week, weekend, next_week, last_week, backlog or a YYYY-MM-DD date.`);
}

export async function folders(): Promise<{ today: string; folders: Folder[]; bin: number }> {
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
  list.push({ key: "next_week", label: "Next week" }, { key: "backlog", label: "Backlog" });
  for (const g of await listGuests()) list.push({ key: `guest:${g.id}`, label: `From ${g.name}`, guest: g.id });
  // Always last: the app lists it beneath Recently deleted.
  list.push({ key: "last_week", label: "Last week" });

  const out: Folder[] = [];
  for (const f of list) {
    const spec = viewSpec(f.key, cal);
    const r = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM todos WHERE deleted_at IS NULL AND NOT done AND ${spec.where}`, spec.params);
    out.push({ ...f, count: r?.n ?? 0 });
  }
  const bin = (await q1<{ n: number }>("SELECT count(*)::int AS n FROM todos WHERE deleted_at IS NOT NULL"))!.n;
  return { today: cal.today, folders: out, bin };
}

export async function listTodos(view: string) {
  const cal = await calendar();
  await rollover(cal.today);
  const spec = viewSpec(view, cal);
  // Finished tasks stay visible in backlog only for a day so the list keeps moving.
  const doneClause = view === "backlog" ? "AND (NOT done OR done_at > now() - interval '1 day')" : "";
  const todos = await q<Todo & { has_notes: boolean }>(
    `SELECT ${LIST_COLS} FROM todos WHERE deleted_at IS NULL AND ${spec.where} ${doneClause} ORDER BY date NULLS FIRST, scope DESC, position, id`,
    spec.params,
  );
  return { view, today: cal.today, todos };
}

export async function getTodo(id: string): Promise<Todo> {
  const t = await q1<Todo>("SELECT * FROM todos WHERE id = $1", [id]);
  if (!t) throw notFound("No such todo");
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
  await indexDoc("todo", t.id, t.title, t.notes);
  // A guest's task carries someone else's words: an @handle in its title must not call on the owner's agents.
  const mentions = [...new Set([...(t.guest_id ? [] : await findMentions(t.title)), ...extraMentions])];
  await logEvent({ actor: actor.id, type, entity_type: "todo", entity_id: t.id, summary, mentions, data: { scope: t.scope, date: t.date } });
}

export async function createTodo(actor: Agent, input: { title: string; view?: string; notes?: string }) {
  const title = (input.title ?? "").trim();
  if (!title) throw bad("Todo needs a title.");
  const cal = await calendar();
  const { add } = viewSpec(input.view || "today", cal);
  if (add.guest_id && !(await listGuests()).some((g) => g.id === add.guest_id)) throw bad(`Unknown view "${input.view}".`);
  const id = newId("t");
  if (input.notes) guardBlocks(actor, input.notes);
  const notes = input.notes ? (actor.kind === "agent" ? markAgentText(input.notes, actor.handle) : input.notes) : "";
  await q("INSERT INTO todos (id, title, notes, scope, date, position, created_by, ai_unseen, guest_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    id, title.slice(0, 300), notes, add.scope, add.date, await nextPosition(add.scope, add.date), actor.id, actor.kind === "agent", add.guest_id ?? null,
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
  if (patch.done !== undefined && patch.done !== before.done) {
    set("done", patch.done);
    set("done_at", patch.done ? new Date().toISOString() : null);
    type = patch.done ? "todo.completed" : "todo.reopened";
  }
  if (patch.view) {
    const { add } = viewSpec(patch.view, await calendar());
    // Only a task already shared with a guest can go back to their list; moving another task there would show it to them.
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
  const t = await getTodo(id);
  // Routine typing in notes by the owner isn't news; everything else is logged.
  const quiet = actor.kind === "human" && type === "todo.updated" && notes !== undefined && sets.length === 2;
  const onlySeen = patch.seen && sets.length === 2;
  if (!quiet && !onlySeen) await afterWrite(actor, t, type, summary, newMentions);
  else await indexDoc("todo", t.id, t.title, t.notes);
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
  await q("UPDATE todos SET deleted_at = now() WHERE id = $1", [id]);
  await unindexDoc("todo", id);
  await logEvent({ actor: actor.id, type: "todo.deleted", entity_type: "todo", entity_id: id, summary: t.title });
}

/** Puts a binned task back exactly where it was. */
export async function restoreTodo(actor: Agent, id: string) {
  const t = await getTodo(id);
  await q("UPDATE todos SET deleted_at = NULL WHERE id = $1", [id]);
  await indexDoc("todo", t.id, t.title, t.notes);
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

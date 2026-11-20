/**
 * The plan: what the owner is working towards for now, as a short outline. A priority is a line
 * at the top; it may have parts, one level down and no further. A task can be part of one line
 * (`todos.plan_id`), and most tasks (chores, errands) are part of none.
 *
 * The plan is for looking across the work. The day lists stay as they are: a task in the plan
 * still lives on its day, in its week or in the backlog.
 */
import { q, q1 } from "../db";
import { bad, logEvent, newId, notFound, type Agent } from "./util";

export type PlanItem = {
  id: string;
  /** The priority this is a part of; null for a priority itself. */
  parent_id: string | null;
  title: string;
  position: number;
  /** Unfinished tasks that are part of this line itself (a priority's parts are counted on the parts). */
  open: number;
  created_at: string;
  updated_at: string;
};

const COLS = `id, parent_id, title, position, created_at, updated_at,
  (SELECT count(*)::int FROM todos t WHERE t.plan_id = plan_items.id AND NOT t.done AND t.deleted_at IS NULL) AS open`;

/** The whole outline, in the owner's order: each priority followed by its parts. */
export async function listPlan(): Promise<PlanItem[]> {
  const rows = await q<PlanItem>(`SELECT ${COLS} FROM plan_items ORDER BY position, id`);
  return rows.filter((r) => !r.parent_id).flatMap((top) => [top, ...rows.filter((r) => r.parent_id === top.id)]);
}

export async function getPlanItem(id: string): Promise<PlanItem> {
  const r = await q1<PlanItem>(`SELECT ${COLS} FROM plan_items WHERE id = $1`, [id]);
  if (!r) throw notFound("No such line in the plan");
  return r;
}

/** The line a task is to be part of, as given: its id, or nothing (null, "", "none") for no line. */
export async function readPlan(v: unknown): Promise<string | null> {
  if (v === null || v === "" || v === "none") return null;
  if (typeof v !== "string") throw bad("plan is the id of a line in the plan, or none.");
  const r = await q1<{ id: string }>("SELECT id FROM plan_items WHERE id = $1", [v]);
  if (!r) throw bad(`No line in the plan has the id "${v}". The plan lists them with their ids.`);
  return r.id;
}

/** A line and, for a priority, its parts: the lines whose tasks count as being under it. */
export async function planScope(id: string): Promise<string[]> {
  return (await q<{ id: string }>("SELECT id FROM plan_items WHERE id = $1 OR parent_id = $1", [id])).map((r) => r.id);
}

async function lastPosition(parent: string | null) {
  return (await q1<{ p: number }>("SELECT COALESCE(max(position), 0) + 1 AS p FROM plan_items WHERE parent_id IS NOT DISTINCT FROM $1", [parent]))!.p;
}

const clean = (title: unknown) => (typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 200) : "");

/** A new priority, or with `parent` a new part of one. It goes last among its neighbours. */
export async function createPlanItem(actor: Agent, input: { title: string; parent?: string | null }): Promise<PlanItem> {
  const title = clean(input.title);
  if (!title) throw bad("A line in the plan needs a title.");
  let parent: string | null = null;
  if (input.parent) {
    const p = await getPlanItem(String(input.parent));
    // one level of parts and no more: the plan is an outline to glance at, not a tree to manage
    if (p.parent_id) throw bad("A part cannot have parts of its own. Add it to the priority instead.");
    parent = p.id;
  }
  const id = newId("pl");
  await q("INSERT INTO plan_items (id, parent_id, title, position, created_by) VALUES ($1,$2,$3,$4,$5)", [id, parent, title, await lastPosition(parent), actor.id]);
  await logEvent({ actor: actor.id, type: "plan.added", entity_type: "plan", entity_id: id, summary: title, data: parent ? { parent } : {} });
  return getPlanItem(id);
}

/** Renames a line, or puts it at a place among its neighbours (order: 1 for first). */
export async function updatePlanItem(actor: Agent, id: string, patch: { title?: string; order?: number }): Promise<PlanItem> {
  const before = await getPlanItem(id);
  const title = patch.title === undefined ? "" : clean(patch.title);
  if (title && title !== before.title) {
    await q("UPDATE plan_items SET title = $2, updated_at = now() WHERE id = $1", [id, title]);
    await logEvent({ actor: actor.id, type: "plan.renamed", entity_type: "plan", entity_id: id, summary: title });
  }
  if (patch.order !== undefined && patch.order !== null) {
    const n = Number(patch.order);
    if (!Number.isInteger(n) || n < 1) throw bad("order is a whole number, 1 for first.");
    const ids = (await q<{ id: string }>("SELECT id FROM plan_items WHERE parent_id IS NOT DISTINCT FROM $1 AND id <> $2 ORDER BY position, id", [before.parent_id, id])).map((r) => r.id);
    ids.splice(Math.min(n - 1, ids.length), 0, id);
    await q("UPDATE plan_items p SET position = o.ord FROM unnest($1::text[]) WITH ORDINALITY AS o(id, ord) WHERE p.id = o.id", [ids]);
  }
  return getPlanItem(id);
}

/**
 * Takes a line out of the plan, and a priority's parts with it. Nothing happens to the tasks:
 * they stay on their days and in their lists, and are simply part of nothing again.
 */
export async function deletePlanItem(actor: Agent, id: string) {
  const item = await getPlanItem(id);
  const ids = await planScope(id);
  await q("UPDATE todos SET plan_id = NULL WHERE plan_id = ANY($1)", [ids]);
  await q("DELETE FROM plan_items WHERE id = ANY($1)", [ids]);
  await logEvent({ actor: actor.id, type: "plan.removed", entity_type: "plan", entity_id: id, summary: item.title });
}

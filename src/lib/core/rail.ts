/**
 * The rail: a column of small modules beside the main content, for timely things the owner needs
 * to know that are not news. "Your hotel today", "Flight leaves at 6:40", "Passport expires in
 * three weeks". Each module is a title plus a few compact blocks (the same blocks pages use), has
 * an expiry so it clears itself, and is identified by a key so its author updates it in place.
 */
import { validateBlock, type AnyBlock } from "../blocks";
import { q, q1 } from "../db";
import { addDays, bad, logEvent, newId, notFound, timezone, type Agent } from "./util";

/** Blocks that read well in a narrow column. */
export const RAIL_BLOCKS = ["facts", "timeline", "callout", "stats", "cards", "map", "text"] as const;
export const RAIL_MAX = 8;

export type RailAction = { label: string; url: string };
export type RailModule = {
  id: string;
  key: string;
  author: string;
  title: string;
  subtitle: string;
  label: string;
  image: string | null;
  blocks: AnyBlock[];
  actions: RailAction[];
  page_id: string | null;
  page?: { id: string; title: string } | null;
  priority: number;
  show_from: string;
  show_until: string;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
};

const okLink = (u: unknown) => typeof u === "string" && /^(https:\/\/|tel:|mailto:|sms:|\/page\/)/.test(u) && u.length < 2000;

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
    image?: string;
    blocks?: unknown;
    actions?: unknown;
    page?: string;
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
  if (subtitle.length > 120) throw bad("subtitle is at most 120 characters.");
  if (label.length > 40) throw bad('label is a few words about timing, at most 40 characters, e.g. "Today · check-in 3 pm".');
  if (input.image !== undefined && !(typeof input.image === "string" && /^https:\/\//.test(input.image))) throw bad("image must be an https URL.");

  const blocks = (input.blocks ?? []) as AnyBlock[];
  if (!Array.isArray(blocks) || blocks.length > 3) throw bad("blocks is a list of at most 3 blocks. A module is a glance, not a page; put more on a page and link it.");
  for (const [i, b] of blocks.entries()) {
    if (!b || typeof b !== "object" || !(RAIL_BLOCKS as readonly string[]).includes(b.type)) throw bad(`blocks[${i}].type must be one of: ${RAIL_BLOCKS.join(", ")}.`);
    if (b.type === "text") {
      const md = (b as { markdown?: unknown }).markdown;
      if (typeof md !== "string" || !md.trim() || md.length > 500) throw bad(`blocks[${i}].markdown is required, at most 500 characters.`);
    } else {
      const problem = validateBlock(b.type, b);
      if (problem) throw bad(`blocks[${i}] (${b.type}): ${problem}.`);
      const n = ((b as { items?: unknown[]; markers?: unknown[] }).items ?? (b as { markers?: unknown[] }).markers ?? []).length;
      if (n > 8) throw bad(`blocks[${i}] has ${n} entries; a module block holds at most 8. Put the rest on a page.`);
    }
  }
  const actions = (input.actions ?? []) as RailAction[];
  if (!Array.isArray(actions) || actions.length > 3) throw bad("actions is a list of at most 3 buttons.");
  for (const [i, a] of actions.entries()) {
    if (!a || typeof a.label !== "string" || !a.label.trim() || a.label.length > 24) throw bad(`actions[${i}].label is required, at most 24 characters.`);
    if (!okLink(a.url)) throw bad(`actions[${i}].url must start with https://, tel:, mailto: or sms:.`);
  }

  let pageId: string | null = null;
  if (input.page) {
    const ref = input.page.replace(/^\/page\//, "").replace(/^\/?(context\/)?/, "");
    const p = await q1<{ id: string }>("SELECT id FROM context_nodes WHERE (id = $1 OR path = $1) AND NOT archived", [ref]);
    if (!p) throw notFound(`No page "${input.page}".`);
    pageId = p.id;
  }

  const until = await instant(input.show_until, true, "show_until");
  const from = input.show_from ? await instant(input.show_from, false, "show_from") : new Date().toISOString();
  if (new Date(until) <= new Date()) throw bad("show_until is in the past. A module shows only while it is relevant.");
  if (new Date(until).getTime() - Date.now() > 45 * 86400_000) throw bad("show_until is more than 45 days away. The rail is for what matters now and soon; keep long-lived facts in context.");

  const mine = await q1<RailModule>("SELECT * FROM rail_modules WHERE author = $1 AND key = $2", [actor.id, key]);
  if (!mine) {
    const live = (await q1<{ n: number }>("SELECT count(*)::int AS n FROM rail_modules WHERE dismissed_at IS NULL AND show_until > now()"))!.n;
    if (live >= RAIL_MAX) throw bad(`The rail already holds ${live} modules. Remove one that is no longer needed (rail_remove) before adding another; see explore("/rail").`);
  }
  const content = JSON.stringify({ title, subtitle, label, image: input.image ?? null, blocks, actions, pageId });
  const same = mine && JSON.stringify({ title: mine.title, subtitle: mine.subtitle, label: mine.label, image: mine.image, blocks: mine.blocks, actions: mine.actions, pageId: mine.page_id }) === content;
  const id = mine?.id ?? newId("r");
  // Changed content brings back a module the owner had dismissed; a mere refresh does not.
  await q(
    `INSERT INTO rail_modules (id, key, author, title, subtitle, label, image, blocks, actions, page_id, priority, show_from, show_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (author, key) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, label = EXCLUDED.label, image = EXCLUDED.image,
       blocks = EXCLUDED.blocks, actions = EXCLUDED.actions, page_id = EXCLUDED.page_id, priority = EXCLUDED.priority, show_from = EXCLUDED.show_from,
       show_until = EXCLUDED.show_until, updated_at = now(), dismissed_at = CASE WHEN $14 THEN rail_modules.dismissed_at ELSE NULL END`,
    [id, key, actor.id, title, subtitle, label, input.image ?? null, JSON.stringify(blocks), JSON.stringify(actions), pageId, Math.max(0, Math.min(Number(input.priority) || 0, 10)), from, until, !!same],
  );
  if (!same) await logEvent({ actor: actor.id, type: mine ? "rail.updated" : "rail.added", entity_type: "rail", entity_id: id, summary: `${title}${label ? ` (${label})` : ""}`, data: { key } });
  return (await q1<RailModule>("SELECT * FROM rail_modules WHERE id = $1", [id]))!;
}

/** What the owner sees now. */
export async function activeModules(): Promise<RailModule[]> {
  const rows = await q<RailModule>("SELECT * FROM rail_modules WHERE dismissed_at IS NULL AND show_from <= now() AND show_until > now() ORDER BY priority DESC, show_until, created_at");
  const ids = [...new Set(rows.map((r) => r.page_id).filter(Boolean))] as string[];
  const pages = ids.length ? await q<{ id: string; title: string }>("SELECT id, title FROM context_nodes WHERE id = ANY($1) AND NOT archived", [ids]) : [];
  return rows.map((r) => ({ ...r, page: pages.find((p) => p.id === r.page_id) ?? null }));
}

/** Everything not yet expired, including modules scheduled for later and ones the owner dismissed. For agents. */
export async function allModules() {
  return q<RailModule & { handle: string }>(
    "SELECT m.*, a.handle FROM rail_modules m JOIN agents a ON a.id = m.author WHERE m.show_until > now() ORDER BY m.dismissed_at IS NOT NULL, m.priority DESC, m.show_until",
  );
}

export async function getModule(ref: string) {
  const m = await q1<RailModule>("SELECT * FROM rail_modules WHERE id = $1 OR key = $1 ORDER BY updated_at DESC LIMIT 1", [ref]);
  if (!m) throw notFound(`No rail module "${ref}".`);
  return m;
}

/** An agent removes its own module by key; the owner dismisses any module by id. */
export async function removeModule(actor: Agent, ref: string) {
  const m =
    actor.kind === "human"
      ? await q1<RailModule>("SELECT * FROM rail_modules WHERE id = $1", [ref])
      : await q1<RailModule>("SELECT * FROM rail_modules WHERE author = $1 AND (key = $2 OR id = $2)", [actor.id, ref]);
  if (!m) throw notFound(actor.kind === "human" ? "No such module." : `You have no rail module "${ref}". You can only remove your own.`);
  if (actor.kind === "human") await q("UPDATE rail_modules SET dismissed_at = now() WHERE id = $1", [m.id]);
  else await q("DELETE FROM rail_modules WHERE id = $1", [m.id]);
  await logEvent({ actor: actor.id, type: actor.kind === "human" ? "rail.dismissed" : "rail.removed", entity_type: "rail", entity_id: m.id, summary: m.title, data: { key: m.key } });
  return { ok: true };
}

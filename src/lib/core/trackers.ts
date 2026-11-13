import { q, q1 } from "../db";
import { cleanSvg, createJob } from "./art";
import { bad, indexDoc, logEvent, newId, notFound, resolveAgents, slugify, unindexDoc, type Agent } from "./util";

export type Tracker = {
  id: string;
  slug: string;
  title: string;
  label: string;
  description: string;
  icon_svg: string | null;
  agents: string[];
  latest: string;
  latest_at: string | null;
  created_by: string;
  archived: boolean;
  created_at: string;
};

export const LABEL_MAX = 18;

function shortLabel(s: string) {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length > LABEL_MAX) throw bad(`Label "${t}" is too long. Labels are at most ${LABEL_MAX} characters, e.g. "Robotics" or "West Seattle".`);
  return t;
}

export async function listTrackers(): Promise<Tracker[]> {
  return q<Tracker>("SELECT * FROM trackers WHERE NOT archived ORDER BY latest_at DESC NULLS LAST, created_at DESC");
}

export async function getTracker(ref: string): Promise<Tracker> {
  const t = await q1<Tracker>("SELECT * FROM trackers WHERE (id = $1 OR slug = $1) AND NOT archived", [ref]);
  if (!t) throw notFound(`No tracker "${ref}"`);
  return t;
}

export async function createTracker(actor: Agent, input: { title: string; label?: string; description?: string; agents?: string[]; icon_svg?: string }) {
  const title = (input.title ?? "").trim();
  if (!title) throw bad("Tracker needs a title.");
  const label = input.label ? shortLabel(input.label) : title.length <= LABEL_MAX ? title : title.split(/\s+/).slice(0, 2).join(" ").slice(0, LABEL_MAX);
  const id = newId("f");
  let slug = slugify(title);
  if (await q1("SELECT 1 FROM trackers WHERE slug = $1", [slug])) slug = `${slug}-${id.slice(-4)}`;
  const icon = input.icon_svg ? cleanSvg(input.icon_svg, "icon") : null;
  // An agent that starts tracking something is assigned to it unless it says otherwise.
  const agents = await resolveAgents(input.agents ?? (actor.kind === "agent" ? [actor.id] : []));
  await q("INSERT INTO trackers (id, slug, title, label, description, icon_svg, agents, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [
    id, slug, title.slice(0, 80), label, input.description ?? "", icon, agents, actor.id,
  ]);
  await indexDoc("tracker", id, title, input.description ?? "");
  const handles = await q<{ handle: string }>("SELECT handle FROM agents WHERE id = ANY($1)", [agents]);
  await logEvent({ actor: actor.id, type: "tracker.created", entity_type: "tracker", entity_id: id, summary: `Now following: ${title}`, mentions: handles.map((h) => h.handle), data: { slug } });
  if (!icon) await createJob(actor, "icon", "tracker", id, `${title}. ${input.description ?? ""}`.trim());
  return getTracker(id);
}

export async function updateTracker(
  actor: Agent,
  ref: string,
  patch: { title?: string; label?: string; description?: string; agents?: string[]; add_agents?: string[]; remove_agents?: string[]; icon_svg?: string },
) {
  const t = await getTracker(ref);
  let agents = t.agents;
  if (patch.agents) agents = await resolveAgents(patch.agents);
  if (patch.add_agents) agents = [...new Set([...agents, ...(await resolveAgents(patch.add_agents))])];
  if (patch.remove_agents) {
    const rm = new Set(await resolveAgents(patch.remove_agents));
    agents = agents.filter((a) => !rm.has(a));
  }
  const title = patch.title?.trim() || t.title;
  const label = patch.label !== undefined ? shortLabel(patch.label) : t.label;
  const description = patch.description ?? t.description;
  const icon = patch.icon_svg ? cleanSvg(patch.icon_svg, "icon") : t.icon_svg;
  await q("UPDATE trackers SET title=$2, label=$3, description=$4, agents=$5, icon_svg=$6 WHERE id=$1", [t.id, title, label, description, agents, icon]);
  if (patch.icon_svg) await q("UPDATE jobs SET status = 'done', done_at = now() WHERE target_id = $1 AND status = 'open'", [t.id]);
  await indexDoc("tracker", t.id, title, description);
  const added = agents.filter((a) => !t.agents.includes(a));
  const handles = added.length ? await q<{ handle: string }>("SELECT handle FROM agents WHERE id = ANY($1)", [added]) : [];
  await logEvent({
    actor: actor.id,
    type: "tracker.updated",
    entity_type: "tracker",
    entity_id: t.id,
    summary: added.length ? `${title}: assigned ${handles.map((h) => "@" + h.handle).join(", ")}` : `${title} updated`,
    mentions: handles.map((h) => h.handle),
  });
  return getTracker(t.id);
}

export async function archiveTracker(actor: Agent, ref: string) {
  const t = await getTracker(ref);
  await q("UPDATE trackers SET archived = true, slug = slug || '~' || id WHERE id = $1", [t.id]);
  await q("UPDATE jobs SET status = 'cancelled' WHERE target_id = $1 AND status = 'open'", [t.id]);
  await unindexDoc("tracker", t.id);
  await logEvent({ actor: actor.id, type: "tracker.archived", entity_type: "tracker", entity_id: t.id, summary: `Stopped following: ${t.title}` });
}

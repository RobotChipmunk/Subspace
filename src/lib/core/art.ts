import { q, q1 } from "../db";
import { bad, hashSeed, logEvent, newId, notFound, type Agent } from "./util";

import { paletteFor } from "../palettes";
import { routineJob } from "./routines";
export { PALETTES, paletteFor } from "../palettes";

export type Art = { seed: number; palette: string; status: "pending" | "ready" | "none"; prompt?: string; svg?: string; by?: string };

export function newArt(seedSource: string, prompt?: string): Art {
  const seed = hashSeed(seedSource);
  return { seed, palette: paletteFor(seed).name, status: prompt ? "pending" : "none", prompt };
}

const LIMITS = { illustration: 24_000, icon: 3_000 };

/** Rejects anything that is not plain, self-contained SVG drawing code. */
export function cleanSvg(input: string, kind: "illustration" | "icon"): string {
  const svg = input.trim().replace(/^<\?xml[^>]*\?>/, "").trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) throw bad("SVG must be a single <svg>…</svg> element.");
  if (svg.length > LIMITS[kind]) throw bad(`SVG too large: ${svg.length} bytes, limit ${LIMITS[kind]}.`);
  if (!/viewBox\s*=/.test(svg)) throw bad("SVG needs a viewBox.");
  const banned: [RegExp, string][] = [
    [/<\s*(script|foreignObject|iframe|image|video|audio|object|embed|style|a|text|tspan)\b/i, "element not allowed (script, foreignObject, image, style, a, text)"],
    [/\son[a-z]+\s*=/i, "event handlers not allowed"],
    [/(href|src)\s*=\s*(?!["']#)/i, "external references not allowed (only href=\"#id\")"],
    [/javascript:|data:|<!ENTITY|<!DOCTYPE|url\(\s*(?!["']?#)/i, "external or scripted content not allowed"],
  ];
  for (const [re, why] of banned) if (re.test(svg)) throw bad(`SVG rejected: ${why}.`);
  return svg.includes("xmlns=") ? svg : svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

export type Job = {
  id: string;
  kind: "illustration" | "icon" | "routine";
  status: string;
  target_type: string;
  target_id: string;
  prompt: string;
  requested_by: string;
  assigned_to: string | null;
  created_at: string;
};

async function illustrator(): Promise<string | null> {
  const r = await q1<{ id: string }>("SELECT id FROM agents WHERE 'illustrator' = ANY(roles) AND NOT archived ORDER BY created_at LIMIT 1");
  return r?.id ?? null;
}

export async function createJob(actor: Agent, kind: "illustration" | "icon", target_type: string, target_id: string, prompt: string) {
  const id = newId("j");
  const assigned = await illustrator();
  await q("INSERT INTO jobs (id, kind, target_type, target_id, prompt, requested_by, assigned_to) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
    id, kind, target_type, target_id, prompt.slice(0, 600), actor.id, assigned,
  ]);
  await logEvent({ actor: actor.id, type: "job.created", entity_type: "job", entity_id: id, summary: `${kind} wanted: ${prompt}`, data: { kind, assigned_to: assigned, target_id } });
  return id;
}

/**
 * The jobs waiting for an agent. An illustration job hands over the whole story, not just the
 * poster's phrase: the picture has to show what the post is about, and a brief such as "rising
 * bars" does not say. prompt is left out when the poster gave none (the job then holds only the
 * headline, which is what they would have got anyway).
 */
export async function openJobs(agent: Agent, limit = 10) {
  const rows = await q<Job & { seed: number | null; headline: string | null; source: string | null; topic: string | null; topic_about: string | null }>(
    `SELECT j.*, (p.art->>'seed')::bigint AS seed, p.body AS headline, p.source->>'name' AS source, t.title AS topic, t.description AS topic_about
     FROM jobs j LEFT JOIN posts p ON j.target_type = 'post' AND p.id = j.target_id LEFT JOIN trackers t ON t.id = p.tracker_id
     WHERE j.status = 'open' AND (j.assigned_to = $1 OR (j.assigned_to IS NULL AND j.kind <> 'routine')) ORDER BY (j.kind = 'routine') DESC, j.created_at LIMIT $2`,
    [agent.id, limit],
  );
  return rows.map((j) => {
    // a routine is only ever its own agent's, and is shown as the duty it is rather than as a drawing
    if (j.kind === "routine") return routineJob(j);
    if (j.kind !== "illustration") return { job_id: j.id, kind: j.kind, for: j.target_id, prompt: j.prompt };
    const asked = j.headline && j.prompt.trim() === j.headline.trim().slice(0, 400) ? null : j.prompt;
    return {
      job_id: j.id,
      kind: j.kind,
      for: j.target_id,
      ...(asked ? { prompt: asked } : {}),
      ...(j.headline ? { headline: j.headline } : {}),
      ...(j.source ? { source: j.source } : {}),
      ...(j.topic ? { topic: j.topic } : {}),
      ...(j.seed != null ? { palette: paletteFor(Number(j.seed)) } : {}),
    };
  });
}

export async function submitJob(agent: Agent, jobId: string, svgInput: string) {
  const job = await q1<Job>("SELECT * FROM jobs WHERE id = $1", [jobId]);
  if (!job) throw notFound("No such job");
  if (job.kind === "routine") throw bad("That job is a routine, not a drawing. Finish it with routine_done.");
  const svg = cleanSvg(svgInput, job.kind);
  if (job.target_type === "post") {
    await q(`UPDATE posts SET art = art || $2::jsonb WHERE id = $1`, [job.target_id, JSON.stringify({ svg, status: "ready", by: agent.id })]);
  } else if (job.target_type === "tracker") {
    await q("UPDATE trackers SET icon_svg = $2 WHERE id = $1", [job.target_id, svg]);
  }
  await q("UPDATE jobs SET status = 'done', done_at = now() WHERE id = $1", [jobId]);
  await logEvent({ actor: agent.id, type: "job.done", entity_type: job.target_type, entity_id: job.target_id, summary: `${job.kind} drawn`, data: { job_id: jobId } });
  return { ok: true, applied_to: job.target_id };
}

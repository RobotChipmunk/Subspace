import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { q, q1 } from "../db";
import { createNode, getNode, updateNode, type ContextLite, type ContextNode } from "./context";
import { bad, type Agent } from "./util";

/**
 * Saved links. A link is a context node of kind "link": the address, a title, the owner's
 * one-line reason for keeping it (summary), a line on what it is (blurb) and optional notes
 * (body). They live in the context tree, so search, history and filing work as for any note.
 */

const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid|ref_src|ref_url|si|_hsenc|_hsmi|mkt_tok)$/i;

/** A clean address to store, and a key under which the same page is always recognised. */
export function normalizeUrl(raw: string): { url: string; key: string; host: string } {
  let s = (raw ?? "").trim();
  if (!s) throw bad("Give the link's address.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw bad(`"${raw}" is not a web address.`);
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || /\s/.test(u.hostname)) throw bad(`"${raw}" is not a web address.`);
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  const key = host + u.pathname.replace(/\/+$/, "") + (params ? "?" + params : "");
  return { url: u.toString().slice(0, 2000), key: key.slice(0, 2000), host };
}

// ---------- Reading a page's own title, site name and picture ----------

function isPrivate(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
}

/** Only public web hosts are fetched, so a saved link can never be used to reach something internal. */
async function publicHost(u: URL): Promise<boolean> {
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (h === "localhost" || /\.(local|internal|localhost)$/i.test(h)) return false;
  if (isIP(h)) return !isPrivate(h);
  try {
    const found = await lookup(h, { all: true });
    return found.length > 0 && found.every((a) => !isPrivate(a.address));
  } catch {
    return false;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", middot: "·" };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

function metaTag(html: string, name: string): string {
  const tag = html.match(new RegExp(`<meta\\b[^>]*\\b(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, "i"))?.[0];
  const content = tag?.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  return content ? decode(content[1] ?? content[2] ?? "") : "";
}

export type LinkMeta = { title?: string; site?: string; description?: string; image?: string };

/** Best effort and quick: a page that cannot be read still saves, with a title made from its address. */
export async function fetchMeta(url: string): Promise<LinkMeta> {
  try {
    const signal = AbortSignal.timeout(4500);
    let at = new URL(url);
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      if (!(await publicHost(at))) return {};
      res = await fetch(at, { redirect: "manual", signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; LinkPreview/1.0)", Accept: "text/html,application/xhtml+xml" } });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!next) break;
      at = new URL(next, at);
      res = null;
    }
    if (!res?.ok || !/html/i.test(res.headers.get("content-type") ?? "") || !res.body) return {};
    // the head is all that is needed; stop reading after a few hundred kilobytes
    const reader = res.body.getReader();
    const text = new TextDecoder();
    let html = "";
    while (html.length < 400_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += text.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    // many shops give the picture as http:// or //host/path; the same file is served over https
    const image = metaTag(html, "og:image:secure_url") || metaTag(html, "og:image") || metaTag(html, "twitter:image");
    let abs: string | undefined;
    try {
      abs = image ? new URL(image, at).toString().replace(/^http:\/\//, "https://") : undefined;
    } catch {}
    return {
      title: metaTag(html, "og:title") || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "") || undefined,
      site: metaTag(html, "og:site_name") || undefined,
      description: metaTag(html, "og:description") || metaTag(html, "description") || undefined,
      image: abs && /^https:\/\//.test(abs) ? abs : undefined,
    };
  } catch {
    return {};
  }
}

/** "noublie-pas-purple-sweatpants" becomes "Noublie pas purple sweatpants": a readable stand-in for a page title. */
function titleFromUrl(u: URL, host: string): string {
  const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_+]+/g, " ").trim();
  if (!last || /^\d+$/.test(last) || last.length < 3) return host;
  return last[0].toUpperCase() + last.slice(1);
}

/** Drops a trailing " | Site name" from a page title; the site is shown on its own. */
function tidyTitle(title: string, site: string): string {
  const cut = title.replace(/\s+[|·•–—-]\s+([^|·•–—-]+)$/, (m, tail: string) => (site && tail.trim().toLowerCase() === site.toLowerCase() ? "" : m));
  return (cut || title).trim();
}

export type LinkPreview = { url: string; title: string; site: string; description?: string; image?: string };

/**
 * What a link looks like before anyone opens it: its page's title, site, a line about it and its
 * picture. Nothing is saved. A page that cannot be read still gets a title made from its address.
 */
export async function previewLink(raw: string): Promise<LinkPreview> {
  const { url, host } = normalizeUrl(raw);
  const meta = await fetchMeta(url);
  const site = (meta.site || host).slice(0, 60);
  return {
    url,
    title: tidyTitle(meta.title || titleFromUrl(new URL(url), host), site).slice(0, 140),
    site,
    ...(meta.description ? { description: meta.description.slice(0, 300) } : {}),
    ...(meta.image ? { image: meta.image } : {}),
  };
}

const LINKS_AREA = "links";

/** Links nobody has filed yet go in one top-level area. */
async function inbox(actor: Agent): Promise<ContextNode> {
  const hit = await q1<ContextNode>("SELECT * FROM context_nodes WHERE path = $1 AND NOT archived", [LINKS_AREA]);
  return hit ?? createNode(actor, { title: "Links", summary: "Saved links that are not filed under a topic yet." });
}

export type LinkInput = { url: string; why?: string; about?: string; notes?: string; parent?: string | null; title?: string; site?: string; image?: string };

/** Saves a link, or updates the one already stored for the same page. */
export async function saveLink(actor: Agent, input: LinkInput): Promise<{ link: ContextNode; existed: boolean }> {
  const { url, key, host } = normalizeUrl(input.url);
  const why = input.why?.trim();
  const about = input.about?.trim();
  const notes = input.notes?.trim();

  const existing = await q1<{ id: string }>("SELECT id FROM context_nodes WHERE url_key = $1 AND NOT archived", [key]);
  if (existing) {
    const before = await getNode(existing.id);
    const link = await updateNode(actor, existing.id, {
      ...(why ? { summary: why } : {}),
      ...(about ? { about } : {}),
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      ...(notes && !before.body.includes(notes) ? { body_append: notes } : {}),
      ...(input.parent ? { parent: input.parent } : {}),
    });
    return { link, existed: true };
  }

  const given = { title: input.title?.trim(), site: input.site?.trim(), image: input.image?.trim() };
  const meta = given.title && given.site ? {} : await fetchMeta(url);
  const site = (given.site || meta.site || host).slice(0, 60);
  const title = tidyTitle(given.title || meta.title || titleFromUrl(new URL(url), host), site).slice(0, 120);
  const parent = input.parent ? await getNode(input.parent) : await inbox(actor);
  const link = await createNode(actor, {
    parent: parent.id,
    title,
    summary: why ?? "",
    body: notes ?? "",
    kind: "link",
    cover: given.image || meta.image,
    link: { url, key, site, blurb: (about || meta.description || "").slice(0, 400) },
  });
  return { link, existed: false };
}

export type LinkLite = ContextLite & { parent_title: string | null; parent_path: string | null };
export type LinkPage = { links: LinkLite[]; next: string | null; total: number };

/**
 * Saved links, newest first, one page at a time: everywhere, or inside one area. Ids are
 * time-ordered, so the page boundary is simply the last id seen. Each page is one index range
 * scan however many links there are.
 */
export async function listLinks(opts: { limit?: number; before?: string | null; parent?: string | null } = {}): Promise<LinkPage> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const params: unknown[] = [];
  let where = "n.kind = 'link' AND NOT n.archived";
  if (opts.parent) where += ` AND n.parent_id = $${params.push(opts.parent)}`;
  const total = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM context_nodes n WHERE ${where}`, params))!.n;
  if (opts.before) where += ` AND n.id < $${params.push(opts.before)}`;
  const rows = await q<LinkLite>(
    `SELECT n.id, n.parent_id, n.path, n.title, n.summary, n.kind, n.cover, n.url, n.site, n.blurb, n.version, n.updated_by, n.created_at, n.updated_at, length(n.body) AS body_chars,
            p.title AS parent_title, p.path AS parent_path
     FROM (SELECT * FROM context_nodes n WHERE ${where} ORDER BY n.id DESC LIMIT $${params.push(limit + 1)}) n
     LEFT JOIN context_nodes p ON p.id = n.parent_id
     ORDER BY n.id DESC`,
    params,
  );
  const more = rows.length > limit;
  if (more) rows.pop();
  return { links: rows, next: more ? rows[rows.length - 1].id : null, total };
}

/** The saved link for an address, however it is written, or null. One index lookup. */
export async function findByUrl(raw: string): Promise<ContextNode | null> {
  let key: string;
  try {
    key = normalizeUrl(raw).key;
  } catch {
    return null;
  }
  return q1<ContextNode>("SELECT * FROM context_nodes WHERE url_key = $1 AND NOT archived", [key]);
}

import { createHash, randomBytes } from "crypto";
import { q, q1 } from "../db";
import { wakeFor } from "./wake";

export type Agent = {
  id: string;
  handle: string;
  name: string;
  /** human: the owner. agent: one of the owner's agents. guest: another person, who reaches only their shared tasks. */
  kind: "human" | "agent" | "guest";
  bio: string;
  roles: string[];
  cursor_seq: number;
  last_seen_at: string | null;
  archived: boolean;
  created_at: string;
  has_token?: boolean;
  /** Guests: whether a passcode has been issued. */
  has_passcode?: boolean;
  /** Built-in runtime settings, without the key. */
  runtime?: {
    enabled: boolean;
    model: string;
    effort: string;
    context: number;
    web: boolean;
    key_hint: string | null;
    last_run?: { at: string; status: string; detail?: string; steps?: number; input_tokens?: number; output_tokens?: number; model?: string } | null;
  } | null;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const bad = (m: string) => new ApiError(400, m);
export const notFound = (what = "Not found") => new ApiError(404, what);

/** Time-sortable ids: prefix + base36 millisecond clock + random tail. */
export function newId(prefix: string): string {
  const t = Date.now().toString(36).padStart(9, "0");
  const r = parseInt(randomBytes(4).toString("hex"), 16).toString(36).padStart(7, "0").slice(-5);
  return `${prefix}_${t}${r}`;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function hashSeed(s: string): number {
  return parseInt(sha256(s).slice(0, 8), 16);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "untitled"
  );
}

export function oneLine(s: string, max = 140): string {
  const t = s
    .replace(/<[^>]+>/g, "")
    .replace(/[#*_`>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

const AGENT_COLS = "id, handle, name, kind, bio, roles, cursor_seq, last_seen_at, archived, created_at, token_hash IS NOT NULL AS has_token, passcode_hash IS NOT NULL AS has_passcode, runtime - 'key_enc' AS runtime";

export async function listAgents(includeArchived = false): Promise<Agent[]> {
  return q<Agent>(`SELECT ${AGENT_COLS} FROM agents WHERE kind <> 'guest' ${includeArchived ? "" : "AND NOT archived"} ORDER BY kind DESC, created_at`);
}

/** Guests are kept apart from agents everywhere: they are not mentioned, assigned or listed with them. */
export async function listGuests(): Promise<Agent[]> {
  return q<Agent>(`SELECT ${AGENT_COLS} FROM agents WHERE kind = 'guest' AND NOT archived ORDER BY created_at`);
}

export async function agentByToken(token: string): Promise<Agent | null> {
  return q1<Agent>(`SELECT ${AGENT_COLS} FROM agents WHERE token_hash = $1 AND kind = 'agent' AND NOT archived`, [sha256(token)]);
}

export async function agentById(id: string): Promise<Agent | null> {
  return q1<Agent>(`SELECT ${AGENT_COLS} FROM agents WHERE id = $1`, [id]);
}

export async function agentByHandle(handle: string, kind: "agent" | "guest"): Promise<Agent | null> {
  return q1<Agent>(`SELECT ${AGENT_COLS} FROM agents WHERE handle = $1 AND kind = $2 AND NOT archived`, [handle.toLowerCase(), kind]);
}

export async function ownerAgent(): Promise<Agent> {
  const a = await q1<Agent>(`SELECT ${AGENT_COLS} FROM agents WHERE kind = 'human' ORDER BY created_at LIMIT 1`);
  if (!a) throw new Error("No owner");
  return a;
}

/** Accepts an agent id or @handle and returns the agent id. */
export async function resolveAgents(refs: string[]): Promise<string[]> {
  if (!refs.length) return [];
  const clean = refs.map((r) => r.replace(/^@/, "").toLowerCase());
  const rows = await q<{ id: string }>("SELECT id FROM agents WHERE (lower(handle) = ANY($1) OR id = ANY($2)) AND NOT archived AND kind <> 'guest'", [clean, refs]);
  return rows.map((r) => r.id);
}

/** Finds @handles in text that belong to real agents. Returns handles. */
export async function findMentions(text: string): Promise<string[]> {
  const found = new Set<string>();
  for (const m of text.matchAll(/(^|[^\w@/])@([a-zA-Z0-9_-]{2,32})/g)) found.add(m[2].toLowerCase());
  if (!found.size) return [];
  const rows = await q<{ handle: string }>("SELECT handle FROM agents WHERE handle = ANY($1) AND NOT archived AND kind <> 'guest'", [[...found]]);
  return rows.map((r) => r.handle);
}

export async function logEvent(e: {
  actor: string;
  type: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  mentions?: string[];
  data?: Record<string, unknown>;
}): Promise<number> {
  const r = await q1<{ seq: number }>(
    "INSERT INTO events (actor, type, entity_type, entity_id, summary, mentions, data) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING seq",
    [e.actor, e.type, e.entity_type, e.entity_id, oneLine(e.summary, 200), e.mentions ?? [], JSON.stringify(e.data ?? {})],
  );
  wakeFor(e);
  return r!.seq;
}

/** Tags as people write them: trimmed, at most 30 characters each, no repeats (whatever the capitals), at most six. */
export function cleanTags(raw: unknown): string[] {
  const out: string[] = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const tag = typeof t === "string" ? t.replace(/[\s,#]+/g, " ").trim().slice(0, 30).trim() : "";
    if (tag && !out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 6);
}

export async function indexDoc(entity_type: string, entity_id: string, title: string, body: string) {
  await q(
    `INSERT INTO search_docs (entity_type, entity_id, title, body, ts) VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, ts = now()`,
    [entity_type, entity_id, title, body],
  );
}

export async function unindexDoc(entity_type: string, entity_id: string) {
  await q("DELETE FROM search_docs WHERE entity_type = $1 AND entity_id = $2", [entity_type, entity_id]);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await q1<{ value: T }>("SELECT value FROM settings WHERE key = $1", [key]);
  return r ? r.value : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await q("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
}

// ---- Dates (all todo logic runs in the owner's timezone) ----

export async function timezone(): Promise<string> {
  return getSetting("timezone", "America/Los_Angeles");
}

export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday */
export function weekday(date: string): number {
  const d = new Date(date + "T00:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

export function mondayOf(date: string): string {
  return addDays(date, 1 - weekday(date));
}

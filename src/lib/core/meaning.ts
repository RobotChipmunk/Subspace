/**
 * Search by meaning, beside search by words.
 *
 * Word search (Postgres full text) finds a note only when it holds the words asked for. With an
 * OpenAI API key on the server (OPENAI_API_KEY), every searchable thing also gets an embedding:
 * a list of numbers that places it near other text that means the same. A search then also looks
 * for what lies nearest the query's own embedding, so "vacation" finds the note about a holiday.
 *
 * - Without a key nothing here runs and search is by words alone, as before.
 * - What is sent to OpenAI is the text that search already covers (titles, notes, tasks, posts,
 *   journal entries), each cut to its first 6,000 characters, and the words of each query.
 * - Embeddings are made a little after a thing is written, on the scheduler's heartbeat (and
 *   whenever the app is in use), not in the request that wrote it. Until then it is found by its
 *   words only.
 * - Vectors are 256 numbers kept in an ordinary real[] column and compared in SQL, so no database
 *   extension is needed. That is quick enough for some thousands of things; with far more, the
 *   pgvector extension and an index would be the next step.
 */
import { q } from "../db";

const MODEL = "text-embedding-3-small";
const DIMS = 256;
const TEXT_CHARS = 6000;
/** Below this likeness two texts are not about the same thing, and the match is left out. */
const FLOOR = 0.3;

/** A stand-in embedder for tests, never for production: it knows words, and a handful of words that mean the same. */
const fake = () => process.env.SUBSPACE_EMBED_FAKE === "1" && process.env.NODE_ENV !== "production";

export const meaningOn = () => !!process.env.OPENAI_API_KEY || fake();

const SAME: Record<string, string> = { holiday: "travel", holidays: "travel", vacation: "travel", trip: "travel", journey: "travel", car: "vehicle", automobile: "vehicle" };
function fakeEmbed(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const raw of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
    const w = SAME[raw] ?? raw.replace(/(ing|ed|es|s)$/, "");
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[Math.abs(h) % DIMS] += 1;
  }
  const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / len);
}

async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  if (fake()) return texts.map(fakeEmbed);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: MODEL, dimensions: DIMS, input: texts.map((t) => t || " ") }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  const out: number[][] = [];
  for (const d of body.data) out[d.index] = d.embedding;
  if (out.length !== texts.length || out.some((e) => !Array.isArray(e) || e.length !== DIMS)) throw new Error("OpenAI embeddings: the reply did not match what was sent.");
  return out;
}

const DOC_TEXT = `title || E'\\n' || left(body, ${TEXT_CHARS})`;

/**
 * Gives an embedding to things written or changed since they last had one. Returns how many it
 * did. Safe to call often and from several places: doing one twice only repeats the work.
 */
export async function embedPending(batches = 2, size = 48): Promise<number> {
  if (!meaningOn()) return 0;
  let done = 0;
  for (let i = 0; i < batches; i++) {
    const rows = await q<{ entity_type: string; entity_id: string; text: string; sum: string }>(
      `SELECT entity_type, entity_id, ${DOC_TEXT} AS text, md5(${DOC_TEXT}) AS sum FROM search_docs
       WHERE embedded_md5 IS DISTINCT FROM md5(${DOC_TEXT}) ORDER BY ts DESC LIMIT $1`,
      [size],
    );
    if (!rows.length) break;
    const vectors = await embed(rows.map((r) => r.text));
    for (const [k, r] of rows.entries()) {
      await q("UPDATE search_docs SET embedding = $3::real[], embedded_md5 = $4 WHERE entity_type = $1 AND entity_id = $2", [r.entity_type, r.entity_id, vectors[k], r.sum]);
    }
    done += rows.length;
    if (rows.length < size) break;
  }
  return done;
}

export type Near = { entity_type: string; entity_id: string; title: string; start: string; ts: string; score: number };

/**
 * The things whose meaning lies nearest some text, best first. `where` narrows them with a test
 * over the search_docs row "d" (kinds, dates, what an agent may see), with its own parameters
 * numbered from $2. Empty when search by meaning is off, or when it fails: word search carries on.
 */
export async function nearest(text: string, opts: { where?: string; params?: unknown[]; limit?: number } = {}): Promise<Near[]> {
  if (!meaningOn() || !text.trim()) return [];
  try {
    const [vector] = await embed([text.slice(0, TEXT_CHARS)]);
    const rows = await q<Near>(
      `SELECT * FROM (
         SELECT d.entity_type, d.entity_id, d.title, left(d.body, 300) AS start, d.ts,
                (SELECT sum(a * b) FROM unnest(d.embedding, $1::real[]) AS pair(a, b))::float8 AS score
         FROM search_docs d WHERE d.embedding IS NOT NULL ${opts.where ? `AND ${opts.where}` : ""}
       ) s WHERE s.score >= ${FLOOR} ORDER BY s.score DESC, s.ts DESC LIMIT ${Math.min(Math.max(opts.limit ?? 12, 1), 60)}`,
      [vector, ...(opts.params ?? [])],
    );
    return rows;
  } catch (e) {
    console.error("meaning: search by meaning failed, falling back to words", (e as Error).message);
    return [];
  }
}

/** Puts two rankings of the same kind of thing into one order: what both rank well comes first. */
export function fuse<T>(lists: T[][], key: (x: T) => string): T[] {
  const score = new Map<string, number>();
  const item = new Map<string, T>();
  for (const list of lists) {
    list.forEach((x, rank) => {
      const k = key(x);
      score.set(k, (score.get(k) ?? 0) + 1 / (60 + rank));
      if (!item.has(k)) item.set(k, x);
    });
  }
  return [...item.keys()].sort((a, b) => score.get(b)! - score.get(a)!).map((k) => item.get(k)!);
}

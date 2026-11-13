/**
 * Page blocks: structured sections an agent can place inside any page (a todo's notes, a context
 * page). In the stored markdown a block is a fenced code block whose language is the block type
 * and whose body is JSON:
 *
 *   ```cards
 *   {"layout":"carousel","items":[{"title":"Nostrana","rating":4.6,"price":"$$$"}]}
 *   ```
 *
 * That keeps pages plain markdown: easy for a model to read and write, and readable anywhere.
 * The app draws each block as a designed component. This file is the single definition of what
 * a block may contain; the server validates against it and the renderer relies on it.
 */

export const BLOCK_TYPES = ["cards", "map", "columns", "stats", "table", "timeline", "callout", "proscons", "chart", "sources", "gallery", "facts"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const isBlockType = (s: string): s is BlockType => (BLOCK_TYPES as readonly string[]).includes(s);

export type CardItem = {
  title: string;
  subtitle?: string;
  image?: string;
  badge?: string;
  price?: string;
  rating?: number;
  reviews?: number | string;
  description?: string;
  meta?: string[];
  tags?: string[];
  url?: string;
  link_label?: string;
};
export type Blocks = {
  cards: { title?: string; layout?: "grid" | "carousel" | "list"; items: CardItem[] };
  map: { title?: string; markers: { title: string; lat: number; lng: number; note?: string; url?: string }[] };
  columns: { columns: AnyBlock[][] };
  stats: { title?: string; items: { label: string; value: string; delta?: string; trend?: "up" | "down" | "flat"; note?: string }[] };
  table: { title?: string; columns: string[]; rows: (string | number)[][]; highlight_column?: number; caption?: string };
  timeline: { title?: string; items: { when?: string; title: string; text?: string; url?: string }[] };
  callout: { tone?: "info" | "good" | "warn" | "decision"; title?: string; text: string };
  proscons: { title?: string; pros: string[]; cons: string[] };
  chart: { kind: "bar" | "line"; title?: string; labels: string[]; series: { name?: string; values: number[] }[]; unit?: string };
  sources: { title?: string; items: { title: string; url: string; publisher?: string; date?: string; note?: string }[] };
  gallery: { title?: string; items: { image: string; caption?: string; url?: string }[] };
  facts: { title?: string; items: { label: string; value: string }[] };
};
/** A block nested inside `columns`: any block, or a run of markdown text. */
export type AnyBlock = ({ type: "text"; markdown: string } | { [K in BlockType]: { type: K } & Blocks[K] }[BlockType]) & { type: string };

// ---------- Validation ----------

const okUrl = (v: unknown) => typeof v === "string" && /^(https:\/\/|\/api\/media\/|\/page\/)/.test(v) && v.length < 2000;
const str = (v: unknown, max = 400) => typeof v === "string" && v.length > 0 && v.length <= max;
const optStr = (v: unknown, max = 400) => v === undefined || v === null || str(v, max);
const list = (v: unknown, min: number, max: number): v is unknown[] => Array.isArray(v) && v.length >= min && v.length <= max;

/** Returns a plain-language problem, or null when the block is valid. */
export function validateBlock(type: string, d: any, depth = 0): string | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "must be a JSON object";
  if (!optStr(d.title, 120)) return "title must be a short string";
  switch (type) {
    case "cards": {
      if (d.layout !== undefined && !["grid", "carousel", "list"].includes(d.layout)) return 'layout must be "grid", "carousel" or "list"';
      if (!list(d.items, 1, 40)) return "items must be a list of 1 to 40 cards";
      for (const [i, c] of d.items.entries()) {
        const at = `items[${i}]`;
        if (!c || typeof c !== "object") return `${at} must be an object`;
        if (!str(c.title, 140)) return `${at}.title is required (at most 140 characters)`;
        if (!optStr(c.subtitle, 140) || !optStr(c.badge, 30) || !optStr(c.price, 40) || !optStr(c.link_label, 40)) return `${at}: subtitle, badge, price and link_label must be short strings`;
        if (!optStr(c.description, 600)) return `${at}.description must be at most 600 characters`;
        if (c.image !== undefined && !okUrl(c.image)) return `${at}.image must be an https URL`;
        if (c.url !== undefined && !okUrl(c.url)) return `${at}.url must be an https URL`;
        if (c.rating !== undefined && !(typeof c.rating === "number" && c.rating >= 0 && c.rating <= 5)) return `${at}.rating must be a number from 0 to 5`;
        if (c.reviews !== undefined && !["number", "string"].includes(typeof c.reviews)) return `${at}.reviews must be a number or short string`;
        for (const k of ["meta", "tags"]) if (c[k] !== undefined && !(list(c[k], 0, 8) && c[k].every((s: unknown) => str(s, 60)))) return `${at}.${k} must be a list of up to 8 short strings`;
      }
      return null;
    }
    case "map": {
      if (!list(d.markers, 1, 40)) return "markers must be a list of 1 to 40 places";
      for (const [i, m] of d.markers.entries()) {
        if (!m || !str(m.title, 120)) return `markers[${i}].title is required`;
        if (typeof m.lat !== "number" || typeof m.lng !== "number" || Math.abs(m.lat) > 90 || Math.abs(m.lng) > 180) return `markers[${i}] needs numeric lat (-90 to 90) and lng (-180 to 180)`;
        if (!optStr(m.note, 200)) return `markers[${i}].note must be at most 200 characters`;
        if (m.url !== undefined && !okUrl(m.url)) return `markers[${i}].url must be an https URL`;
      }
      return null;
    }
    case "columns": {
      if (depth > 0) return "columns cannot be nested inside columns";
      if (!list(d.columns, 2, 3)) return "columns must be a list of 2 or 3 columns";
      for (const [i, col] of d.columns.entries()) {
        if (!list(col, 1, 6)) return `columns[${i}] must be a list of 1 to 6 blocks`;
        for (const [j, b] of (col as any[]).entries()) {
          const at = `columns[${i}][${j}]`;
          if (!b || typeof b !== "object" || typeof b.type !== "string") return `${at} needs a "type"`;
          if (b.type === "text") {
            if (!str(b.markdown, 4000)) return `${at}.markdown is required for a text block`;
          } else if (!isBlockType(b.type)) return `${at}.type "${b.type}" is not a block type`;
          else {
            const p = validateBlock(b.type, b, depth + 1);
            if (p) return `${at} (${b.type}): ${p}`;
          }
        }
      }
      return null;
    }
    case "stats": {
      if (!list(d.items, 1, 8)) return "items must be a list of 1 to 8 figures";
      for (const [i, s] of d.items.entries()) {
        if (!s || !str(s.label, 60) || !str(String(s.value ?? ""), 40)) return `items[${i}] needs a label and a value`;
        if (!optStr(s.delta, 30) || !optStr(s.note, 120)) return `items[${i}]: delta and note must be short strings`;
        if (s.trend !== undefined && !["up", "down", "flat"].includes(s.trend)) return `items[${i}].trend must be "up", "down" or "flat"`;
      }
      return null;
    }
    case "table": {
      if (!list(d.columns, 2, 8) || !d.columns.every((c: unknown) => typeof c === "string" && c.length <= 60)) return "columns must be a list of 2 to 8 short headings (the first may be empty)";
      if (!list(d.rows, 1, 40)) return "rows must be a list of 1 to 40 rows";
      for (const [i, r] of d.rows.entries()) {
        if (!Array.isArray(r) || r.length !== d.columns.length) return `rows[${i}] must have ${d.columns.length} cells, one per column`;
        if (!r.every((c: unknown) => ["string", "number"].includes(typeof c) && String(c).length <= 300)) return `rows[${i}] cells must be strings or numbers of at most 300 characters`;
      }
      if (d.highlight_column !== undefined && !(Number.isInteger(d.highlight_column) && d.highlight_column >= 0 && d.highlight_column < d.columns.length)) return "highlight_column must be a column index";
      if (!optStr(d.caption, 200)) return "caption must be at most 200 characters";
      return null;
    }
    case "timeline": {
      if (!list(d.items, 1, 40)) return "items must be a list of 1 to 40 entries";
      for (const [i, t] of d.items.entries()) {
        if (!t || !str(t.title, 160)) return `items[${i}].title is required`;
        if (!optStr(t.when, 40) || !optStr(t.text, 500)) return `items[${i}]: when must be short and text at most 500 characters`;
        if (t.url !== undefined && !okUrl(t.url)) return `items[${i}].url must be an https URL`;
      }
      return null;
    }
    case "callout":
      if (d.tone !== undefined && !["info", "good", "warn", "decision"].includes(d.tone)) return 'tone must be "info", "good", "warn" or "decision"';
      return str(d.text, 800) ? null : "text is required (at most 800 characters)";
    case "proscons":
      for (const k of ["pros", "cons"]) if (!(list(d[k], 0, 10) && d[k].every((s: unknown) => str(s, 200)))) return `${k} must be a list of up to 10 short strings`;
      return d.pros.length + d.cons.length ? null : "give at least one pro or con";
    case "chart": {
      if (!["bar", "line"].includes(d.kind)) return 'kind must be "bar" or "line"';
      if (!list(d.labels, 2, 24) || !d.labels.every((l: unknown) => str(String(l), 30))) return "labels must be a list of 2 to 24 short labels";
      if (!list(d.series, 1, 4)) return "series must be a list of 1 to 4 series (fold anything more into Other)";
      for (const [i, s] of d.series.entries()) {
        if (!s || !Array.isArray(s.values) || s.values.length !== d.labels.length || !s.values.every((v: unknown) => typeof v === "number" && Number.isFinite(v))) return `series[${i}].values must be ${d.labels.length} numbers, one per label`;
        if (d.series.length > 1 && !str(s.name, 40)) return `series[${i}].name is required when there is more than one series`;
      }
      if (!optStr(d.unit, 12)) return "unit must be a short string";
      return null;
    }
    case "sources": {
      if (!list(d.items, 1, 40)) return "items must be a list of 1 to 40 sources";
      for (const [i, s] of d.items.entries()) {
        if (!s || !str(s.title, 200)) return `items[${i}].title is required`;
        if (!okUrl(s.url)) return `items[${i}].url must be an https URL`;
        if (!optStr(s.publisher, 60) || !optStr(s.date, 30) || !optStr(s.note, 300)) return `items[${i}]: publisher, date and note must be short strings`;
      }
      return null;
    }
    case "gallery": {
      if (!list(d.items, 1, 24)) return "items must be a list of 1 to 24 images";
      for (const [i, g] of d.items.entries()) {
        if (!g || !okUrl(g.image)) return `items[${i}].image must be an https URL`;
        if (!optStr(g.caption, 160)) return `items[${i}].caption must be at most 160 characters`;
        if (g.url !== undefined && !okUrl(g.url)) return `items[${i}].url must be an https URL`;
      }
      return null;
    }
    case "facts": {
      if (!list(d.items, 1, 24)) return "items must be a list of 1 to 24 label and value pairs";
      for (const [i, f] of d.items.entries()) if (!f || !str(f.label, 60) || !str(String(f.value ?? ""), 300)) return `items[${i}] needs a label and a value`;
      return null;
    }
  }
  return `"${type}" is not a block type`;
}

/** Finds the page blocks in a markdown document. */
export function findBlocks(md: string): { type: BlockType; text: string; line: number }[] {
  const out: { type: BlockType; text: string; line: number }[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^ {0,3}(`{3,}|~{3,})\s*([\w-]*)\s*$/);
    if (!open) continue;
    const start = i;
    const body: string[] = [];
    for (i++; i < lines.length && !new RegExp(`^ {0,3}${open[1][0]}{${open[1].length},}\\s*$`).test(lines[i]); i++) body.push(lines[i]);
    if (isBlockType(open[2])) out.push({ type: open[2], text: body.join("\n"), line: start + 1 });
  }
  return out;
}

/** Checks every block in a document. Returns one message per broken block; empty when all are fine. */
export function checkBlocks(md: string): string[] {
  const problems: string[] = [];
  for (const b of findBlocks(md)) {
    let data: unknown;
    try {
      data = JSON.parse(b.text);
    } catch (e) {
      problems.push(`The ${b.type} block on line ${b.line} is not valid JSON (${(e as Error).message}).`);
      continue;
    }
    const p = validateBlock(b.type, data);
    if (p) problems.push(`The ${b.type} block on line ${b.line}: ${p}.`);
  }
  return problems;
}

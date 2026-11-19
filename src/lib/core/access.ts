/**
 * What one agent may see and do. The owner sets it on the agent (Agents screen), so it holds for
 * every connection that agent makes, however it signs in.
 *
 *  read_only  it can look, and nothing else: every tool that adds or changes something is withheld.
 *  sections   the parts of the app it can see (feed, todos, journal, ideas, ...). null means all of them.
 *  context    the top-level sections of context it can see, by slug ("work", "me"). null means all.
 *
 * An agent with no rules sees everything, as agents always have. For an agent with rules, a thing
 * it may not see behaves as if it did not exist: it is absent from the map, from search, from
 * changes(), and reading it by id says there is no such thing.
 */
import { q } from "../db";
import { ApiError, bad, notFound, type Agent } from "./util";

export const SECTIONS = ["feed", "todos", "journal", "following", "pages", "links", "rail", "ideas"] as const;
export type Section = (typeof SECTIONS)[number];
export type AccessRules = { read_only: boolean; sections: Section[] | null; context: string[] | null };

/** The top levels of context that belong to a part of the app, and so follow that part's setting rather than the context list. */
const OWNED_TOPS: Record<string, Section> = { journal: "journal", links: "links" };
/** Kinds of context node that are also a part of the app. */
const KIND_SECTION: Record<string, Section> = { page: "pages", link: "links", journal: "journal" };

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Rules as the owner sends them, checked. Returns null when they amount to no restriction at all. */
export function readRules(raw: unknown): AccessRules | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw bad("access is an object: { read_only, sections, context }.");
  const r = raw as Record<string, unknown>;
  const list = (v: unknown, what: string): string[] | null => {
    if (v === null || v === undefined) return null;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw bad(`access.${what} is a list of names, or null for all.`);
    return [...new Set(v as string[])];
  };
  const sections = list(r.sections, "sections");
  if (sections?.some((s) => !(SECTIONS as readonly string[]).includes(s))) throw bad(`access.sections may hold: ${SECTIONS.join(", ")}.`);
  const context = list(r.context, "context");
  if (context?.some((s) => !SLUG.test(s))) throw bad("access.context holds the names of top-level context sections as they appear in their paths.");
  const rules: AccessRules = {
    read_only: r.read_only === true,
    sections: sections && sections.length === SECTIONS.length ? null : (sections as Section[] | null),
    context: context?.filter((s) => !OWNED_TOPS[s]) ?? null,
  };
  return rules.read_only || rules.sections || rules.context ? rules : null;
}

/** What an agent can see, as questions the rest of the code asks. */
export type Sight = {
  /** No rules at all: nothing is hidden and nothing is withheld. */
  full: boolean;
  readOnly: boolean;
  section: (s: Section) => boolean;
  /** A context node, by its path (without "/context/") and kind. */
  node: (n: { path: string; kind?: string | null }) => boolean;
  /** The same test as SQL over a context_nodes row with this alias ("n"), for lists and search. */
  nodeSql: (alias: string) => string;
};

const FULL: Sight = { full: true, readOnly: false, section: () => true, node: () => true, nodeSql: () => "TRUE" };

const lit = (xs: string[]) => (xs.length ? `ARRAY[${xs.filter((x) => SLUG.test(x)).map((x) => `'${x}'`).join(",")}]::text[]` : "ARRAY[]::text[]");

export function sightOf(agent: Agent | null | undefined): Sight {
  const rules = agent?.kind === "agent" ? (agent.access ?? null) : null;
  if (!rules) return FULL;
  const section = (s: Section) => !rules.sections || rules.sections.includes(s);
  const hiddenTops = Object.entries(OWNED_TOPS).filter(([, s]) => !section(s)).map(([top]) => top);
  const hiddenKinds = Object.entries(KIND_SECTION).filter(([, s]) => !section(s)).map(([kind]) => kind);
  const top = (slug: string) => {
    const owner = OWNED_TOPS[slug];
    if (owner) return section(owner);
    return !rules.context || rules.context.includes(slug);
  };
  return {
    full: false,
    readOnly: rules.read_only,
    section,
    node: (n) => top(n.path.split("/")[0]) && !hiddenKinds.includes(n.kind ?? "note"),
    nodeSql: (a) => {
      const t = `split_part(${a}.path, '/', 1)`;
      const tops = rules.context ? `(${t} = ANY(${lit([...rules.context, ...Object.keys(OWNED_TOPS)])}))` : "TRUE";
      return `(${tops} AND NOT (${t} = ANY(${lit(hiddenTops)})) AND NOT (${a}.kind = ANY(${lit(hiddenKinds)})))`;
    },
  };
}

/** For the error a hidden thing gives: the same as for a thing that is not there. */
export const hidden = (what = "Nothing by that id.") => notFound(what);

/** Stops an agent with rules from using the REST API, which has no notion of them. Agents work through MCP. */
export function restAllowed(actor: Agent) {
  if (!sightOf(actor).full) throw new ApiError(403, "This agent's access is limited: it connects through its MCP address only.");
}

/** The context nodes among these ids that the agent may see. */
export async function visibleNodes(sight: Sight, ids: string[]): Promise<Set<string>> {
  if (sight.full || !ids.length) return new Set(ids);
  const rows = await q<{ id: string }>(`SELECT n.id FROM context_nodes n WHERE n.id = ANY($1) AND ${sight.nodeSql("n")}`, [ids]);
  return new Set(rows.map((r) => r.id));
}

/** One line for the agent on what its access is, said at connection and in the briefing. */
export function describeAccess(agent: Agent, topLevels: { path: string; title: string }[]): string | null {
  const rules = agent.kind === "agent" ? (agent.access ?? null) : null;
  if (!rules) return null;
  const sight = sightOf(agent);
  const parts: string[] = [];
  if (rules.read_only) parts.push("You are read-only here: you can look, but not post, add or change anything, and you have no tools for it.");
  if (rules.sections) {
    const on = SECTIONS.filter((s) => sight.section(s));
    parts.push(on.length ? `Of the app you can see: ${on.join(", ")}.` : "You can see none of the app's own sections.");
  }
  if (rules.context) {
    const on = topLevels.filter((t) => sight.node({ path: t.path, kind: "note" }) && !OWNED_TOPS[t.path]).map((t) => t.title);
    parts.push(on.length ? `Of context you can see: ${on.join(", ")}.` : "You can see none of context.");
  }
  if (rules.sections || rules.context) parts.push("Everything else is outside your access by the owner's choice: it does not appear for you, and you should not ask for it or guess at it.");
  return parts.join(" ");
}

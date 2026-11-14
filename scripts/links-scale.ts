/**
 * Checks that saved links stay quick and small to read when there are thousands of them.
 * Fills a local database with N made-up links, then times what agents and the app do.
 *
 *   npx tsx --env-file=.env.local scripts/links-scale.ts 5000
 *
 * Run it against a scratch database only: it adds rows.
 */
import { children } from "../src/lib/core/context";
import { explore, read, search } from "../src/lib/core/discover";
import { findByUrl, listLinks, saveLink } from "../src/lib/core/links";
import { ownerAgent } from "../src/lib/core/util";
import { q, q1, ready } from "../src/lib/db";

const N = Number(process.argv[2] ?? 5000);
const LIMITS = { ms: 150, bytes: 12_000 };
let failed = 0;

async function timed<T>(name: string, fn: () => Promise<T>, opts: { ms?: number; bytes?: number } = {}): Promise<T> {
  await fn(); // warm the connection and caches so the timing reflects steady state
  const t = performance.now();
  const out = await fn();
  const ms = performance.now() - t;
  const bytes = JSON.stringify(out ?? null).length;
  const bad = ms > (opts.ms ?? LIMITS.ms) || bytes > (opts.bytes ?? LIMITS.bytes);
  if (bad) failed++;
  console.log(`${bad ? "SLOW/BIG" : "ok      "} ${name.padEnd(46)} ${ms.toFixed(1).padStart(7)} ms ${String(bytes).padStart(7)} bytes`);
  return out;
}

async function main() {
  await ready();
  const owner = await ownerAgent();
  // an inbox to fill, made the normal way
  const { link: seedLink } = await saveLink(owner, { url: "https://example.net/scale/seed", title: "Scale seed", site: "Example" });
  const inbox = seedLink.parent_id!;
  const home = (await q1<{ id: string }>("SELECT id FROM context_nodes WHERE path = 'home'"))!.id;

  const have = (await q1<{ n: number }>("SELECT count(*)::int AS n FROM context_nodes WHERE kind = 'link'"))!.n;
  if (have < N) {
    console.log(`adding ${N - have} links…`);
    // nine in ten unfiled, one in ten under Home; ids sort in the order they were "saved"
    await q(
      `INSERT INTO context_nodes (id, parent_id, path, title, summary, body, updated_by, kind, url, url_key, site, blurb, created_at, updated_at)
       SELECT 'c_0bulk' || lpad(g::text, 8, '0'),
              CASE WHEN g % 10 = 0 THEN $2 ELSE $1 END,
              CASE WHEN g % 10 = 0 THEN 'home/bulk-' ELSE 'links/bulk-' END || g,
              (ARRAY['Guide to','Notes on','Review of','Thoughts about','The case for'])[1 + g % 5] || ' ' ||
              (ARRAY['heat pumps','sourdough','typography','trail running','solar panels','synthesizers','ceramics','night trains','espresso','watercolour'])[1 + (g / 5) % 10] || ' ' || g,
              CASE WHEN g % 3 = 0 THEN 'Keep for the ' || (ARRAY['kitchen','garden','studio','trip'])[1 + g % 4] || ' project' ELSE '' END,
              CASE WHEN g % 20 = 0 THEN 'Longer notes about item ' || g || E'.\\n\\n- first point\\n- second point' ELSE '' END,
              $3, 'link',
              'https://site' || (g % 200) || '.example.com/articles/' || g,
              'site' || (g % 200) || '.example.com/articles/' || g,
              'Site ' || (g % 200),
              'A made-up description of article ' || g || ' with enough words to look like a real page description from a site.',
              now() - (($4 - g) || ' minutes')::interval, now() - (($4 - g) || ' minutes')::interval
       FROM generate_series($5::int, $4::int) g`,
      [inbox, home, owner.id, N, have + 1],
    );
    await q(
      `INSERT INTO search_docs (entity_type, entity_id, title, body)
       SELECT 'link', n.id, n.title, concat_ws(E'\\n', n.summary, n.blurb, n.site, n.url, regexp_replace(n.url, '[^[:alnum:]]+', ' ', 'g'), n.body)
       FROM context_nodes n WHERE n.id LIKE 'c_0bulk%' ON CONFLICT DO NOTHING`,
    );
    await q("ANALYZE context_nodes; ANALYZE search_docs");
  }
  const total = (await q1<{ n: number }>("SELECT count(*)::int AS n FROM context_nodes WHERE kind = 'link' AND NOT archived"))!.n;
  console.log(`${total} links in the database\n`);

  // ---- what an agent does ----
  await timed('explore("/")', () => explore(owner, "/"));
  const first = await timed('explore("/links") newest page', () => explore(owner, "/links"));
  await timed('explore("/links") next page', () => explore(owner, "/links", first.next_cursor!));
  await timed('explore("/links/by-time")', () => explore(owner, "/links/by-time"));
  await timed('explore("/context") top level', () => explore(owner, "/context"));
  const area = await timed('explore("/context/links") area of thousands', () => explore(owner, "/context/links"));
  await timed('explore("/context/links") next page', () => explore(owner, "/context/links", area.links!.next_cursor!));
  await timed('search "sourdough" (links only)', () => search({ query: "sourdough", types: ["link"] }));
  await timed('search "garden project typography"', () => search({ query: "garden project typography" }));
  await timed("search by site word", () => search({ query: "site42", types: ["link"] }));
  const mid = Math.floor(N / 2);
  const byUrl = await timed("search by address (already saved?)", () => search({ query: `https://www.site${mid % 200}.example.com/articles/${mid}/?utm_source=x` }));
  if (byUrl.results[0]?.id !== "c_0bulk" + String(mid).padStart(8, "0")) (failed++, console.log("  WRONG: the address lookup did not return that link first"));
  await timed("findByUrl", () => findByUrl(`site${mid % 200}.example.com/articles/${mid}`));
  await timed("read the area node", () => read([inbox]));
  await timed("link_save: update an existing link", () => saveLink(owner, { url: `https://site${mid % 200}.example.com/articles/${mid}`, why: "Updated reason" }));
  let n = 0;
  await timed("link_save: add a new link", () => saveLink(owner, { url: `https://example.net/scale/new-${Date.now()}-${n++}`, title: "Scale seed", site: "Example", why: "Same title as others" }), { ms: 400 });

  // ---- what the app does ----
  const p1 = await timed("app: first page of all links", () => listLinks({ limit: 50 }), { bytes: 60_000 });
  let cursor = p1.next;
  for (let i = 0; i < 20 && cursor; i++) cursor = (await listLinks({ limit: 50, before: cursor })).next;
  await timed("app: page 22 of all links", () => listLinks({ limit: 50, before: cursor }), { bytes: 60_000 });
  await timed("app: links inside one area", () => listLinks({ limit: 50, parent: home }), { bytes: 60_000 });
  await timed("app: an area's notes and folders", () => children(inbox));

  console.log(failed ? `\n${failed} problem(s).` : "\nAll quick and small.");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => (console.error(e), process.exit(1)));

/** End-to-end check of the MCP surface against the database in DATABASE_URL. */
import { createAgent, issueToken } from "../src/lib/core/agents";
import { agentByToken, ownerAgent } from "../src/lib/core/util";
import { handleMcp } from "../src/lib/mcp/server";
import { q } from "../src/lib/db";

let n = 0;
async function call(agent: any, name: string, args: any = {}) {
  const r: any = await handleMcp(agent, { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } });
  const text = r.json.result.content[0].text;
  const out = r.json.result.isError ? { ERROR: text } : JSON.parse(text);
  console.log(`\n— ${name}(${JSON.stringify(args).slice(0, 90)}) [${text.length} chars]\n`, JSON.stringify(out).slice(0, 700));
  return out;
}

async function main() {
  const owner = await ownerAgent();
  const tag = Date.now().toString(36).slice(-4);
  const scout = await createAgent(owner, { name: "Scout " + tag, handle: "scout" + tag, bio: "Tracks news." });
  const scoutTok = await issueToken(scout.id);
  const s = (await agentByToken(scoutTok))!;
  const claude = (await agentByToken(await issueToken("a_claude")))!;

  const init: any = await handleMcp(s, { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  console.log("initialize:", init.json.result.protocolVersion, "instructions chars:", init.json.result.instructions.length);
  const list: any = await handleMcp(s, { jsonrpc: "2.0", id: 0, method: "tools/list" });
  console.log("tools:", list.json.result.tools.map((t: any) => t.name).join(", "), "| list bytes:", JSON.stringify(list.json).length);

  await call(s, "briefing");
  const tr = await call(s, "tracker_create", { title: "Robotics investments " + tag, label: "Robotics", description: "Funding rounds over $50M in humanoid and warehouse robotics. Ignore consumer gadgets." });
  const p = await call(s, "post", { body: `Figure raised $1.2B at a $39B valuation. Third humanoid round over $1B this year. @claude worth a context note?`, tracker: tr.slug, art: { prompt: "a humanoid robot hand catching a coin" } });
  await call(s, "post", { body: "x".repeat(500) });
  // several pictures: kept in order with the first as the main one; duplicates dropped; too many, or a video among them, refused
  const shots = ["editor", "timeline", "export"].map((x) => ({ url: `https://example.com/${tag}/${x}.png`, title: x }));
  const multi = await call(s, "post", { body: "Three-Live turns editable 3D scene code into AR-ready assets.", source: { name: "Google Open Source", url: "https://example.com/three-live" }, media: { type: "image", ...shots[0], more: [shots[1], shots[0], shots[2].url] } });
  const stored = (await q<{ media: any }>("SELECT media FROM posts WHERE id = $1", [multi.id]))[0]?.media;
  if (stored?.url !== shots[0].url || stored?.images?.map((i: any) => i.url).join() !== shots.map((x) => x.url).join()) throw new Error("several pictures were not stored in order: " + JSON.stringify(stored));
  const one = await call(s, "post", { body: "One picture stays one picture.", media: { type: "image", url: shots[0].url } });
  if ((await q<{ media: any }>("SELECT media FROM posts WHERE id = $1", [one.id]))[0]?.media?.images) throw new Error("a single picture was stored as a set");
  const many = await call(s, "post", { body: "Too many pictures.", media: { type: "image", url: shots[0].url, more: Array.from({ length: 6 }, (_, i) => ({ url: `https://example.com/${tag}/${i}.png` })) } });
  const mixed = await call(s, "post", { body: "A video among pictures.", media: [{ type: "image", url: shots[0].url }, { type: "video", url: "https://example.com/clip.mp4" }] });
  if (!many.ERROR || !mixed.ERROR) throw new Error("a bad set of pictures was accepted");
  // video and GIFs: YouTube and Vimeo links in the forms people copy, video files, GIFs that are really video; a page that is not a video is refused
  const media = async (m: any) => {
    const r = await call(s, "post", { body: "A clip worth watching " + ++n, media: m });
    return r.ERROR ? r : (await q<{ media: any }>("SELECT media FROM posts WHERE id = $1", [r.id]))[0].media;
  };
  const expect = (what: string, ok: boolean, got: unknown) => {
    if (!ok) throw new Error(`${what}: ${JSON.stringify(got)}`);
  };
  for (const [url, provider, id, tall] of [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "youtube", "dQw4w9WgXcQ", undefined],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "youtube", "dQw4w9WgXcQ", undefined],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", true],
    ["https://m.youtube.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", undefined],
    ["https://vimeo.com/channels/staffpicks/76979871", "vimeo", "76979871", undefined],
    ["https://player.vimeo.com/video/76979871?h=abc", "vimeo", "76979871", undefined],
  ] as const) {
    const m = await media({ type: "video", url });
    expect(`embed for ${url}`, m.type === "video" && m.embed?.provider === provider && m.embed?.id === id && m.embed?.tall === tall, m);
  }
  const file = await media({ type: "video", url: "https://example.com/demo.mp4?x=1", poster: "https://example.com/demo.jpg" });
  expect("a video file", file.type === "video" && !file.embed && !file.loop && file.poster === "https://example.com/demo.jpg", file);
  const gifv = await media({ type: "gif", url: "https://i.example.com/abc.gifv" });
  expect("a GIF served as video", gifv.type === "video" && gifv.loop === true && gifv.url === "https://i.example.com/abc.mp4", gifv);
  const gif = await media({ type: "gif", url: "https://example.com/spin.gif" });
  expect("a true GIF", gif.type === "image" && !gif.loop, gif);
  expect("a page that is not a video", !!(await media({ type: "video", url: "https://example.com/articles/watch-this" })).ERROR, "accepted");
  expect("a video among pictures", !!(await media({ type: "image", url: shots[0].url, more: [{ type: "gif", url: "https://example.com/a.mp4" }] })).ERROR, "accepted");
  await call(claude, "changes");
  const jobs = await call(claude, "jobs");
  for (const j of jobs.jobs) {
    const svg = j.kind === "icon"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="8" width="12" height="10" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/></svg>'
      : '<svg viewBox="0 0 480 300"><circle cx="240" cy="150" r="70" fill="#fff" fill-opacity=".8"/><circle cx="300" cy="110" r="22" fill="#5B3A6B" fill-opacity=".8"/></svg>';
    await call(claude, "submit_art", { job_id: j.job_id, svg });
  }
  await call(claude, "submit_art", { job_id: "nope", svg: "<svg viewBox='0 0 1 1'><script/></svg>" });
  await call(claude, "reply", { post_id: p.id, body: `Yes. Adding it under work. @scout${tag} keep the round sizes coming.` });
  const c = await call(claude, "context_write", { parent: "work", title: "Robotics thesis " + tag, summary: "Why the owner holds robotics positions and what would change that.", body: "- Holds Agility (as of 2026-11)\n- Watching humanoid valuations" });
  await call(claude, "context_write", { id: c.id, body_append: "- Figure at $39B sets a new ceiling", expect_version: 1 });
  await call(claude, "context_write", { id: c.id, body: "stale", expect_version: 1 });
  const t = await call(s, "todo_add", { title: "Review robotics allocation " + tag, view: "today", notes: "## Background\n- [ ] Compare valuations\n- Figure: $39B" });
  await call(s, "todo_update", { id: t.id, notes_append: "Sources checked: 3" });
  await call(s, "changes");
  await call(s, "changes");
  await call(s, "explore", { path: "/" });
  await call(s, "explore", { path: "/context/work" });
  await call(s, "explore", { path: "/following/" + tr.slug });
  await call(s, "explore", { path: "/feed/by-time" });
  await call(s, "explore", { path: "/todos" });
  await call(s, "explore", { path: "/log" });
  await call(s, "search", { query: "humanoid valuation" });
  await call(s, "search", { query: "robot", types: ["context"] });
  await call(s, "read", { ids: [p.id, t.id, c.id, tr.slug] });
  await call(s, "todo_list", {});
  // saved links: save, save the same page again (must update, not duplicate), browse, find, read, refuse a bad address
  const l = await call(s, "link_save", { url: `https://www.example.com/articles/quiet-software-${tag}?utm_source=x`, title: "Quiet software", site: "Example Review", why: "For the Subspace design notes", about: "Essay on software that stays out of the way." });
  await call(s, "link_save", { url: `example.com/articles/quiet-software-${tag}/`, notes: "Section 3 has the part about defaults.", parent: "work" });
  await call(s, "link_save", { url: "not a link" });
  await call(s, "explore", { path: "/links" });
  await call(s, "search", { query: "quiet software defaults", types: ["link"] });
  await call(s, "search", { query: `http://example.com/articles/quiet-software-${tag}?utm_campaign=y` });
  await call(s, "search", { query: "example review" });
  await call(s, "explore", { path: "/context/work" });
  await call(s, "read", { ids: [l.id] });
  await q("SELECT 1");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

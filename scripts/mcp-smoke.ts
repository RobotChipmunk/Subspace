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

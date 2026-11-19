/** End-to-end check of the MCP surface against the database in DATABASE_URL. */
import { createAgent, issueToken } from "../src/lib/core/agents";
import { moduleActed, moduleLater, removeModule } from "../src/lib/core/rail";
import { deleteTodo, getTodo } from "../src/lib/core/todos";
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
  // a recorded preview: uploaded as data, then posted as a repeating clip; a file that is not what it claims is refused
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]).toString("base64");
  const up = await call(s, "media_upload", { data: webm, mime: "video/webm" });
  expect("an uploaded clip", /^\/api\/media\/m_\w+\.webm$/.test(up.url ?? "") || /\.webm$/.test(up.url ?? ""), up);
  const preview = await media({ type: "gif", url: up.url });
  expect("an uploaded preview posted as a GIF", preview.type === "video" && preview.loop === true, preview);
  // an agent whose app holds an older tool list has no "gif" to choose: the clip still plays, and the guide names the tools
  const stale = await media({ type: "image", url: up.url });
  expect("an uploaded preview posted as an image", stale.type === "video" && stale.loop === true, stale);
  const g = await call(s, "guide", { topic: "posting" });
  expect("the guide names the tools", g.tools?.includes("media_upload") && /old copy/.test(g.if_a_tool_is_missing ?? ""), g.tools);
  expect("a fake clip", !!(await call(s, "media_upload", { data: Buffer.from("not a video at all, just text").toString("base64"), mime: "video/mp4" })).ERROR, "accepted");
  const addr = await call(s, "media_upload");
  expect("an upload address", /\/api\/media\/upload\/[\w.-]+$/.test(addr.upload_to ?? ""), addr);
  await call(claude, "changes");
  const jobs = await call(claude, "jobs");
  // an illustration job hands over the story, so the picture can show what the post is about
  const drawing = jobs.jobs.find((j: any) => j.kind === "illustration" && j.for === p.id);
  if (!drawing?.headline?.startsWith("Figure raised") || !drawing.prompt || !drawing.topic || !drawing.palette?.ink) throw new Error("an illustration job does not carry the brief, the headline, the topic and the palette: " + JSON.stringify(drawing));
  // the guide's own worked example has to pass the rules it teaches
  const example = (await call(claude, "guide", { topic: "illustration" })).guide.match(/<svg[\s\S]*?<\/svg>/)?.[0];
  if (!example) throw new Error("guide(illustration) has no worked example");
  // a post with a brief too thin to draw from is told so; one with no brief is drawn from its headline alone
  const thin = await call(s, "post", { body: "Smoke test: the picture brief is too thin " + tag + ".", art: { prompt: "tech news" } });
  if (!/too thin/.test(thin.picture ?? "")) throw new Error("a thin art.prompt was not pointed out: " + JSON.stringify(thin));
  const bare = (await call(claude, "jobs")).jobs.find((j: any) => j.for === (thin.id as string));
  const none = await call(s, "post", { body: "Smoke test: no picture brief at all " + tag + "." });
  const fromHeadline = (await call(claude, "jobs")).jobs.find((j: any) => j.for === none.id);
  if (bare?.prompt !== "tech news" || !fromHeadline?.headline || "prompt" in fromHeadline) throw new Error("a job without a brief should carry the headline and no prompt: " + JSON.stringify([bare, fromHeadline]));
  jobs.jobs.push(bare, fromHeadline);
  for (const j of jobs.jobs) {
    const svg = j.kind === "icon"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="8" width="12" height="10" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/></svg>'
      : example;
    await call(claude, "submit_art", { job_id: j.job_id, svg });
  }
  await call(claude, "submit_art", { job_id: "nope", svg: "<svg viewBox='0 0 1 1'><script/></svg>" });
  await call(claude, "reply", { post_id: p.id, body: `Yes. Adding it under work. @scout${tag} keep the round sizes coming.` });
  // both agents are now in the thread: an owner reply naming nobody reaches both, and only one may take it
  const { createReply } = await import("../src/lib/core/posts");
  await call(s, "changes");
  await call(claude, "changes");
  const ask = await createReply(owner, p.id, "Can one of you add the round to the robotics page?");
  for (const who of [s, claude]) {
    const item = (await call(who, "changes")).for_you.find((i: any) => i.id === ask.id);
    if (item?.why !== "reply in a thread you are part of" || item.agents_in_thread?.length !== 1) throw new Error("an unnamed reply did not reach an agent in the thread: " + JSON.stringify(item));
  }
  const [c1, c2] = await Promise.all([call(s, "claim", { post_id: ask.id }), call(claude, "claim", { post_id: ask.id })]);
  if (c1.yours === c2.yours) throw new Error("exactly one agent should hold the claim: " + JSON.stringify([c1, c2]));
  if ((await call(c1.yours ? s : claude, "claim", { post_id: ask.id })).yours !== true) throw new Error("claiming again should still be yours");
  const named = await createReply(owner, p.id, `@scout${tag} and what was the previous round?`);
  const forClaude = (await call(claude, "changes")).for_you.find((i: any) => i.id === named.id);
  if (forClaude?.why !== "reply in a thread you are part of" || forClaude.mentions?.[0] !== `@scout${tag}`) throw new Error("a reply naming another agent should say so: " + JSON.stringify(forClaude));
  if ((await call(s, "changes")).for_you.find((i: any) => i.id === named.id)?.why !== "mentioned you") throw new Error("the named agent should see it was mentioned");
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
  {
    // order: each task says where it stands on its day; an agent can put one first, and the rest keep their order
    const before: { id: string; order: number }[] = (await call(s, "todo_list", { view: "today" })).todos;
    if (before.find((x) => x.id === t.id)?.order !== before.length) throw new Error("a task added without an order is not last on its day: " + JSON.stringify(before));
    await call(s, "todo_update", { id: t.id, order: 1 });
    const after: { id: string; order: number }[] = (await call(s, "todo_list", { view: "today" })).todos;
    if (after[0]?.id !== t.id || after[0].order !== 1) throw new Error("todo_update(order: 1) did not put the task first: " + JSON.stringify(after.slice(0, 3)));
    const rest = (l: { id: string }[]) => l.map((x) => x.id).filter((x) => x !== t.id).join();
    if (rest(after) !== rest(before)) throw new Error("placing one task changed the order of the others");
    if (after.map((x) => x.order).join() !== after.map((_, i) => i + 1).join()) throw new Error("orders on one day are not 1, 2, 3: " + JSON.stringify(after.map((x) => x.order)));
  }
  // a follow-up: a tagged task, and a rail module that points at it
  const followUp = await call(s, "todo_add", { title: "Decide on the smoke test " + tag, view: "week", tags: ["smoke"], notes: "Two options, pick one." });
  const onSubject = await call(s, "todo_list", { view: "all", tag: "smoke" });
  if (!onSubject.todos.some((x: { id: string }) => x.id === followUp.id)) throw new Error("todo_list(view: all, tag) did not return the tagged task");
  const railKey = "smoke-" + tag.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const until = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  // clears_on is what an app holding an older tool list still sends: accepted, and it changes nothing
  const pointer = await call(s, "rail_set", { key: railKey, icon: "question", title: "Smoke test: decide", todo: followUp.id, clears_on: "todo_open", show_until: until });
  if (pointer.todo !== followUp.id || pointer.icon !== "question") throw new Error("rail_set did not keep the task and the icon: " + JSON.stringify(pointer));
  // a module is a notification, not a page: a second block, a long block, a third button and an unknown icon are refused, each with a reason
  const fact = { type: "facts", items: [{ label: "Gate", value: "C7" }] };
  const tooMuch: [string, Record<string, unknown>, RegExp][] = [
    ["two blocks", { blocks: [fact, fact] }, /at most one block/],
    ["five facts", { blocks: [{ type: "facts", items: Array.from({ length: 5 }, (_, i) => ({ label: "Row " + i, value: "x" })) }] }, /at most 4/],
    ["a long callout", { blocks: [{ type: "callout", text: "word ".repeat(60) }] }, /sentence or two/],
    ["three buttons", { actions: ["One", "Two", "Three"].map((label) => ({ label, url: "https://example.com/" })) }, /at most 2 buttons/],
    ["an unknown icon", { icon: "rocket" }, /icon must be one of/],
  ];
  for (const [what, extra, why] of tooMuch) {
    const r = await call(s, "rail_set", { key: railKey + "-x", title: "Smoke test: too much", show_until: until, ...extra });
    if (!r.ERROR || !why.test(r.ERROR)) throw new Error(`rail_set accepted ${what}, or did not say why not: ${JSON.stringify(r)}`);
  }
  await call(s, "todo_update", { id: followUp.id, done: true });
  await call(s, "rail_remove", { key: pointer.key });
  // The owner acts on a module and it is gone: a tap on a button, then "Later", then closing it. Each time its author hears how.
  const parcel = { key: railKey + "-p", icon: "package", label: "Arrives today", title: "Smoke test parcel " + tag, subtitle: "Two boxes, signature needed.", blocks: [fact], actions: [{ label: "Track parcel", url: "https://example.com/track" }], show_until: until };
  const shown = await call(s, "rail_set", parcel);
  await call(s, "changes");
  const heardOf = async (type: string) => (await call(s, "changes")).for_you.find((i: any) => i.id === shown.id && i.type === type);
  const inRail = async () => (await call(s, "explore", { path: "/rail" })).items.find((i: any) => i.key === parcel.key);
  if (!(await moduleActed(owner, shown.id, "Track parcel")).cleared) throw new Error("a tap on a module's button did not clear it");
  const tapped = await heardOf("rail.cleared");
  if (tapped?.by_owner !== "action" || tapped.action !== "Track parcel") throw new Error("the author was not told which button the owner chose: " + JSON.stringify(tapped));
  // the same content does not put a cleared module back, and the answer says so; something new does
  const again = await call(s, "rail_set", parcel);
  if (again.cleared_by_owner !== "action" || !again.note) throw new Error("rail_set did not say that the owner had already cleared the module: " + JSON.stringify(again));
  const news = await call(s, "rail_set", { ...parcel, label: "Arrives tomorrow" });
  if (news.cleared_by_owner || (await inRail())?.cleared_by_owner) throw new Error("a module with something new to say did not come back");
  // "Later": it becomes a task of the owner's, carrying what the module said, and leaves the rail
  const later = await moduleLater(owner, shown.id, "tomorrow");
  const keptTask = await getTodo(later.todo!);
  if (keptTask.title !== parcel.title || !keptTask.notes.includes("Two boxes") || !keptTask.notes.includes("```facts") || !keptTask.rail?.kept || keptTask.rail.actions[0]?.label !== "Track parcel") throw new Error("the task a module was kept as does not carry it: " + JSON.stringify(keptTask));
  const put = await heardOf("rail.cleared");
  if (put?.by_owner !== "later" || put.todo !== later.todo) throw new Error("the author was not told the module became a task: " + JSON.stringify(put));
  const gone = await inRail();
  if (gone?.cleared_by_owner !== "later" || gone.kept_as !== later.todo) throw new Error("explore(/rail) does not say the module was kept for later: " + JSON.stringify(gone));
  // kept again after a change, it moves that task rather than making a second one
  await call(s, "rail_set", { ...parcel, label: "Arrives Friday" });
  if ((await moduleLater(owner, shown.id, "week")).todo !== later.todo) throw new Error("keeping a module for later twice made two tasks");
  // closed without acting
  await call(s, "rail_set", { ...parcel, label: "Arrives Saturday" });
  await removeModule(owner, shown.id);
  if (!(await heardOf("rail.dismissed")) || !(await inRail())?.dismissed_by_owner) throw new Error("the author was not told the owner dismissed the module");
  await call(s, "rail_remove", { key: parcel.key });
  if ((await getTodo(later.todo!)).rail) throw new Error("a task still offers the buttons of a module its author has removed");
  await deleteTodo(owner, later.todo!);
  await deleteTodo(owner, later.todo!, true);
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

  // The journal, from far to near, and an entry added on the owner's word.
  const je = await call(s, "journal_write", { text: "I want to spend more mornings drawing before work. Grateful for the quiet hour today.", title: "Mornings " + tag });
  if (!je.id || !je.mood || !je.gist) throw new Error("journal_write did not file the entry: " + JSON.stringify(je));
  const jtop = await call(s, "explore", { path: "/journal" });
  if (!jtop.children?.length) throw new Error("explore(/journal) lists no months");
  const jmonth = await call(s, "explore", { path: jtop.children[0].path });
  if (!jmonth.items?.some((i: any) => i.id === je.id && i.mood && i.gist)) throw new Error("the month does not give the new entry a line with its mood and gist");
  const jread = await call(s, "read", { ids: [je.id] });
  if (jread.items?.[0]?.type !== "journal" && jread[0]?.type !== "journal") console.log("note: read() shape for a journal entry:", JSON.stringify(jread).slice(0, 200));
  await call(s, "context_archive", { id: je.id });

  // What agents did is on record: every call above, with what it asked for and what it was shown.
  await call(s, "search", { query: "zzzqqq" + tag + "xk" });
  await call(s, "no_such_tool", {}).catch(() => {});
  const calls = await q<{ tool: string; ok: boolean; query: string | null; path: string | null; result_count: number | null; seen: string[]; refs: string[]; kind: string; client: string | null }>(
    "SELECT tool, ok, query, path, result_count, seen, refs, kind, client FROM agent_calls WHERE agent_id = $1 ORDER BY id", [s.id]);
  const need = (what: string, hit: boolean) => { if (!hit) throw new Error("agent log: " + what); };
  need("the calls were not recorded", calls.length > 20);
  need("the connection opening is missing", calls.some((c) => c.tool === "connect"));
  need("a search did not keep its query", calls.some((c) => c.tool === "search" && c.query === "quiet software defaults" && (c.result_count ?? 0) > 0));
  need("a search that found nothing is not recognisable", calls.some((c) => c.tool === "search" && c.query?.startsWith("zzzqqq") && c.result_count === 0));
  need("an explore did not keep its path", calls.some((c) => c.tool === "explore" && c.path === "/links"));
  need("a read did not keep what it opened", calls.some((c) => c.tool === "read" && c.refs.includes(l.id)));
  need("a listing did not keep what it showed", calls.some((c) => c.tool === "explore" && c.seen.length > 0));
  need("a failed call is missing", calls.some((c) => !c.ok && c.tool === "link_save"));
  need("an unknown tool is missing", calls.some((c) => !c.ok && c.tool === "no_such_tool"));
  need("reads and writes are not told apart", calls.some((c) => c.kind === "read") && calls.some((c) => c.kind === "write"));
  console.log(`\nagent log: ${calls.length} calls recorded for @${s.handle}, ${calls.filter((c) => !c.ok).length} failed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

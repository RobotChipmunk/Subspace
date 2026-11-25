/** End-to-end check of the MCP surface against the database in DATABASE_URL. */
import { createAgent, issueToken, updateAgent } from "../src/lib/core/agents";
import { moduleActed, moduleLater, removeModule, sentAnswers } from "../src/lib/core/rail";
import { assignRoutine, listRoutines, tick } from "../src/lib/core/routines";
import { decide, ensureSystem, pendingProposals } from "../src/lib/core/rules";
import { ensureCurrent, tellLapsed } from "../src/lib/core/current";
import { embedPending, meaningOn } from "../src/lib/core/meaning";
import { addItem, createIdea, deleteIdea, getIdea, listIdeas, makeTask, moreOf, notYet, pruneItem, setAsideNear, updateIdea, updateItem } from "../src/lib/core/ideas";
import { archiveNode, createNode, getNode } from "../src/lib/core/context";
import { deleteTodo, getTodo } from "../src/lib/core/todos";
import { agentByToken, defaultAgent, ownerAgent } from "../src/lib/core/util";
import { listChat, sendChat } from "../src/lib/core/posts";
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
  // the plan: a priority with a part, a task under the part, and the list narrowed to the priority
  {
    const top = await call(s, "plan_write", { title: "Ship the smoke test " + tag });
    const part = await call(s, "plan_write", { title: "Write it " + tag, parent: top.id });
    if (part.part_of !== top.id) throw new Error("plan_write(parent) did not make a part: " + JSON.stringify(part));
    const nested = await call(s, "plan_write", { title: "Too deep", parent: part.id });
    if (!nested.ERROR) throw new Error("a part was given a part of its own: " + JSON.stringify(nested));
    const planned = await call(s, "todo_add", { title: "Plan the smoke test " + tag, view: "backlog", plan: part.id });
    if (planned.plan !== part.id) throw new Error("todo_add(plan) did not put the task on the line: " + JSON.stringify(planned));
    const under = await call(s, "todo_list", { view: "all", plan: top.id });
    if (under.todos.length !== 1 || under.todos[0].id !== planned.id) throw new Error("todo_list(plan: a priority) did not return exactly the task under its part: " + JSON.stringify(under.todos));
    const outline = (await call(s, "briefing", {})).plan?.find((p: { id: string }) => p.id === top.id);
    if (outline?.parts?.[0]?.id !== part.id || outline.parts[0].open_tasks !== 1) throw new Error("the briefing does not carry the plan with its parts and open tasks: " + JSON.stringify(outline));
    await call(s, "todo_update", { id: planned.id, plan: "none" });
    if ((await call(s, "todo_list", { view: "all", plan: top.id })).todos.length) throw new Error('todo_update(plan: "none") left the task on its line');
    await call(s, "todo_update", { id: planned.id, plan: part.id, done: true });
    await call(s, "plan_write", { id: top.id, remove: true });
    if ((await call(s, "briefing", {})).plan?.some((p: { id: string }) => p.id === top.id)) throw new Error("plan_write(remove) left the priority in the plan");
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
  {
    // A button may send an action back to the module's author instead of opening a link. The owner's
    // tap clears the module, answers at once with who it went to, and reaches the author in changes().
    const both = await call(s, "rail_set", { key: railKey + "-s", title: "Smoke test: follow it?", show_until: until, actions: [{ label: "Follow it", url: "https://example.com/", send: "approve" }] });
    if (!both.ERROR || !/both url and send/.test(both.ERROR)) throw new Error("rail_set accepted a button with a link and a send: " + JSON.stringify(both));
    const neither = await call(s, "rail_set", { key: railKey + "-s", title: "Smoke test: follow it?", show_until: until, actions: [{ label: "Follow it" }] });
    if (!neither.ERROR || !/needs url/.test(neither.ERROR)) throw new Error("rail_set accepted a button that does nothing: " + JSON.stringify(neither));
    const ask = await call(s, "rail_set", { key: railKey + "-s", icon: "question", title: "Smoke test: follow it?", show_until: until, actions: [{ label: "Follow it", send: "approve" }, { label: "Not this", send: "decline" }] });
    await call(s, "changes");
    const tap = await moduleActed(owner, ask.id, "Follow it");
    const waitingFor = (await sentAnswers()).find((x) => x.id === ask.id);
    if (!waitingFor || waitingFor.agent_id !== s.id || waitingFor.label !== "Follow it" || waitingFor.picked_up) throw new Error("an answer just sent should be listed as waiting for its agent: " + JSON.stringify(waitingFor));
    if (!tap.cleared || tap.sent?.to?.handle !== s.handle || tap.sent.label !== "Follow it") throw new Error("a button that sends did not answer with who it went to: " + JSON.stringify(tap));
    const got = (await call(s, "changes")).for_you.find((i: any) => i.id === ask.id && i.type === "rail.cleared");
    if (got?.sent !== "approve" || got.action !== "Follow it" || got.by_owner !== "action") throw new Error("the author was not sent the action: " + JSON.stringify(got));
    if (!(await sentAnswers()).find((x) => x.id === ask.id)?.picked_up) throw new Error("an answer the agent has read is not marked as picked up");
    const again = await moduleActed(owner, ask.id, "Not this");
    if (again.cleared || again.sent?.label !== "Follow it") throw new Error("a second answer was taken after the first: " + JSON.stringify(again));
    const listed = (await call(s, "explore", { path: "/rail" })).items.find((i: any) => i.id === ask.id);
    if (listed?.sent !== "approve" || listed.cleared_by_owner !== "action") throw new Error("explore(/rail) does not show what was sent: " + JSON.stringify(listed));
    await call(s, "rail_remove", { key: railKey + "-s" });
  }
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

  {
    // Access: an agent the owner has limited sees only its part, as if the rest did not exist, and a read-only one has no tools that change things.
    const made = await createAgent(owner, { name: "Viewer " + tag, handle: "viewer" + tag, bio: "Looks, from elsewhere." });
    await updateAgent(owner, made.id, { access: { read_only: true, sections: ["todos"], context: ["work"] } });
    const viewer = (await agentByToken(await issueToken(made.id)))!;
    const offered: string[] = ((await handleMcp(viewer, { jsonrpc: "2.0", id: ++n, method: "tools/list" })) as any).json.result.tools.map((x: any) => x.name);
    for (const name of ["post", "reply", "todo_add", "todo_update", "context_write", "page_write", "rail_set", "journal_write", "link_save"]) if (offered.includes(name)) throw new Error(`a read-only agent was offered ${name}`);
    for (const name of ["briefing", "explore", "search", "read", "todo_list", "changes"]) if (!offered.includes(name)) throw new Error(`a read-only agent that sees todos was not offered ${name}`);
    const refusedWrite: any = await handleMcp(viewer, { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name: "todo_add", arguments: { title: "Should not exist " + tag } } });
    if (!refusedWrite.json.error) throw new Error("a read-only agent could call todo_add: " + JSON.stringify(refusedWrite.json));
    const vBrief = await call(viewer, "briefing");
    if (!/read-only/.test(vBrief.your_access ?? "") || vBrief.rail || vBrief.recent_pages) throw new Error("the briefing of a limited agent does not say so, or shows what it may not see: " + JSON.stringify(vBrief).slice(0, 400));
    const vMap: string[] = vBrief.map.map((x: any) => x.path);
    if (vMap.join() !== "/todos,/context,/agents,/routines") throw new Error("a limited agent's map shows " + vMap.join());
    const vCtx: string[] = (await call(viewer, "explore", { path: "/context" })).children.map((x: any) => x.path);
    if (vCtx.join() !== "/context/work") throw new Error("a limited agent sees these sections of context: " + vCtx.join());
    for (const path of ["/context/home", "/feed", "/feed/recent", "/journal", "/pages", "/links", "/rail", "/following", "/log"]) {
      const r = await call(viewer, "explore", { path });
      if (!r.ERROR) throw new Error(`a limited agent could explore ${path}`);
    }
    const homeNote = (await call(claude, "explore", { path: "/context/home/weekly-rhythm" })).items[0].id;
    const vRead = await call(viewer, "read", { ids: [homeNote, p.id, je.id, t.id, c.id] });
    const byId = (id: string) => vRead.find((x: any) => x.id === id);
    for (const id of [homeNote, p.id, je.id]) if (byId(id)?.error !== "Nothing by that id.") throw new Error("a limited agent read something outside its access: " + JSON.stringify(byId(id)).slice(0, 200));
    if (byId(t.id)?.type !== "todo" || byId(c.id)?.type !== "context") throw new Error("a limited agent could not read what it may see: " + JSON.stringify(vRead).slice(0, 300));
    const vHome = await call(viewer, "search", { query: "compost recycling" });
    if (vHome.results.some((x: any) => x.type !== "todo" && !(x.path ?? "").startsWith("/context/work"))) throw new Error("search found something in a hidden part: " + JSON.stringify(vHome.results));
    if (!(await call(claude, "search", { query: "compost recycling" })).results.some((x: any) => (x.path ?? "").startsWith("/context/home"))) throw new Error("the note the access test looks for is not in the seed any more");
    const vFound = await call(viewer, "search", { query: "robotics" });
    if (!vFound.results.length || vFound.results.some((x: any) => x.type === "post" || (x.path && !x.path.startsWith("/context/work")))) throw new Error("search for a limited agent returned the wrong things: " + JSON.stringify(vFound.results).slice(0, 400));
    // it hears only of changes to its part: a post is not news to it, a task is
    await call(viewer, "changes");
    await call(s, "post", { body: "Nothing a viewer should hear of " + tag + ".", art: { prompt: "a closed door at the end of a quiet corridor" } });
    const vTask = await call(s, "todo_add", { title: "Something a viewer may see " + tag, view: "backlog" });
    const vNews = await call(viewer, "changes");
    const heard = [...vNews.for_you, ...vNews.other];
    if (heard.some((x: any) => String(x.type).startsWith("post.")) || !heard.some((x: any) => x.id === vTask.id)) throw new Error("changes() for a limited agent: " + JSON.stringify(heard).slice(0, 400));
    // limits lifted: it is an ordinary agent again
    await updateAgent(owner, made.id, { access: null });
    const freed = (await agentByToken(await issueToken(made.id)))!;
    if (!(await call(freed, "explore", { path: "/feed" })).children) throw new Error("an agent whose limits were lifted still cannot see the feed");
    await updateAgent(owner, made.id, { archived: true });
  }

  {
    // Moving a note breaks nothing that names its old place: the old path goes on answering, for it and for what is beneath it.
    const area = await call(claude, "context_write", { parent: "home", title: "Moving test " + tag, summary: "A note that will be moved." });
    const inside = await call(claude, "context_write", { parent: area.id, title: "Inside it", summary: "A note beneath the one that moves.", body: "- Still here." });
    const moved = await call(claude, "context_write", { id: area.id, parent: "/" });
    if (moved.path === area.path || moved.path.startsWith("/context/home/")) throw new Error("the note did not move to the top level: " + JSON.stringify(moved));
    const byOld = await call(s, "read", { ids: [area.path, inside.path] });
    if (byOld[0]?.id !== area.id || byOld[1]?.id !== inside.id || !/moved/i.test(byOld[1]?.moved ?? "") || !byOld[1].path.startsWith(moved.path + "/")) throw new Error("a moved note is not found by its old path: " + JSON.stringify(byOld).slice(0, 400));
    if ((await call(s, "explore", { path: area.path })).path !== moved.path) throw new Error("explore() does not follow a moved path");
    const added = await call(s, "context_write", { parent: area.path, title: "Added by the old path", summary: "Written under where it used to be." });
    if (!added.path?.startsWith(moved.path + "/")) throw new Error("writing under an old path did not land in the new place: " + JSON.stringify(added));
    if (!(await call(s, "read", { ids: ["/context/home/never-was-" + tag] }))[0]?.error) throw new Error("a path that never existed was found");
    await call(claude, "context_archive", { id: area.id });
    if (!(await call(s, "read", { ids: [area.path] }))[0]?.error) throw new Error("an archived note still answers at its old path");
  }

  {
    // Ideas: the owner seeds a canvas; agents branch from what is there, a line at a time, within a daily budget; the owner's keeping and pruning steer what comes next.
    const idea = await createIdea(owner, { text: "A smoke test idea " + tag });
    const root = (await getIdea(idea.id)).items[0];
    if (!(await call(s, "idea_list")).ideas.some((x: any) => x.id === idea.id && x.state === "growing")) throw new Error("idea_list does not show a new idea");
    const read = await call(s, "idea_read", { id: idea.id });
    if (read.pieces?.[0]?.by !== "the owner" || read.may_add_today?.yours !== 3) throw new Error("idea_read: " + JSON.stringify(read).slice(0, 300));
    const refusals: [string, Record<string, unknown>, RegExp][] = [
      ["a piece that branches from nothing", { kind: "riff", text: "What if it were smaller?" }, /from/],
      ["a report", { from: root.id, kind: "riff", text: "x".repeat(300) }, /280/],
      ["something found with no source", { from: root.id, kind: "found", text: "It exists." }, /source/],
      ["an unknown kind", { from: root.id, kind: "essay", text: "Long." }, /kind is one of/],
    ];
    for (const [what, args, why] of refusals) {
      const r = await call(s, "idea_grow", { idea: idea.id, ...args });
      if (!r.ERROR || !why.test(r.ERROR)) throw new Error(`idea_grow accepted ${what}, or did not say why not: ${JSON.stringify(r)}`);
    }
    const first = await call(s, "idea_grow", { idea: idea.id, from: root.id, kind: "riff", text: "What if it were half the size?" });
    if (!first.id || first.may_add_today?.yours !== 2) throw new Error("idea_grow: " + JSON.stringify(first));
    const after = await getIdea(idea.id);
    const grown = after.items.find((x) => x.id === first.id)!;
    if (Math.hypot(grown.x - root.x, grown.y - root.y) < 150 || grown.seen) throw new Error("a grown piece should sit clear of what it grew from, and be new to the owner: " + JSON.stringify(grown));
    if (!after.links.some((l) => l.a === root.id && l.b === first.id)) throw new Error("a grown piece is not joined to what it grew from");
    const second = await call(s, "idea_grow", { idea: idea.id, from: first.id, kind: "question", text: "Who is it for?" });
    await call(s, "idea_grow", { idea: idea.id, from: root.id, kind: "counter", text: "It may be too small to be useful." });
    const over = await call(s, "idea_grow", { idea: idea.id, from: root.id, kind: "riff", text: "And one more." });
    if (!over.ERROR || !/your 3 for today/.test(over.ERROR)) throw new Error("an agent could add more than its share in a day: " + JSON.stringify(over));
    if (!(await call(s, "idea_connect", { idea: idea.id, a: root.id, b: second.id })).ERROR) throw new Error("a join was accepted without saying why");
    const joined = await call(s, "idea_connect", { idea: idea.id, a: root.id, b: second.id, label: "the real question" });
    if (joined.label !== "the real question") throw new Error("idea_connect: " + JSON.stringify(joined));
    // the owner keeps one and prunes another: the next read says so
    await updateItem(owner, first.id, { kept: true });
    await pruneItem(owner, second.id);
    const steered = await call(claude, "idea_read", { id: idea.id });
    if (!steered.steering.kept.includes("What if it were half the size?") || !steered.steering.pruned.includes("Who is it for?") || steered.pieces.some((x: any) => x.id === second.id)) throw new Error("idea_read does not carry the owner's steering: " + JSON.stringify(steered.steering));
    // press and hold: the agent that wrote the piece is asked for more
    await call(s, "changes");
    const asked = await moreOf(owner, first.id);
    if (!asked.to.includes(s.name)) throw new Error("asking for more did not go to the piece's agent: " + JSON.stringify(asked));
    if (!(await call(s, "changes")).for_you.some((i: any) => i.type === "idea.more" && i.id === idea.id)) throw new Error("the agent was not told the owner wants more");
    await updateIdea(owner, idea.id, { state: "resting" });
    const resting = await call(claude, "idea_grow", { idea: idea.id, from: root.id, kind: "riff", text: "While it rests." });
    if (!resting.ERROR || !/resting/.test(resting.ERROR)) throw new Error("a resting idea was grown: " + JSON.stringify(resting));

    // Resting and waking. A find wakes an idea that has rested a week, and nothing else does; one the owner leaves alone for a fortnight rests by itself.
    const find = { idea: idea.id, from: root.id, kind: "found", text: "A maker has just started selling one at half the size.", source: { name: "Example", url: "https://example.com/half-size" } };
    const tooSoon = await call(claude, "idea_grow", find);
    if (!tooSoon.ERROR || !/less than 7 days/.test(tooSoon.ERROR)) throw new Error("a find woke an idea the owner had only just put to rest: " + JSON.stringify(tooSoon));
    await q("UPDATE ideas SET rested_at = now() - interval '8 days' WHERE id = $1", [idea.id]);
    const listed = (await call(claude, "idea_list")).ideas.find((x: any) => x.id === idea.id);
    if (listed?.state !== "resting" || listed.may_wake !== true || !listed.resting_since) throw new Error("idea_list does not say a rested idea may be woken: " + JSON.stringify(listed));
    const woke = await call(claude, "idea_grow", find);
    if (!woke.woke || !woke.id) throw new Error("a find did not wake a resting idea: " + JSON.stringify(woke));
    const card = (await listIdeas()).find((x) => x.id === idea.id)!;
    if (card.state !== "growing" || card.woken_by !== claude.id) throw new Error("the owner is not shown what woke the idea: " + JSON.stringify(card));
    await q("UPDATE ideas SET owner_at = now() - interval '15 days', woke_at = now() - interval '15 days' WHERE id = $1", [idea.id]);
    const quiet = (await call(s, "idea_list")).ideas.find((x: any) => x.id === idea.id);
    if (quiet?.state !== "resting") throw new Error("an idea left alone for a fortnight did not rest: " + JSON.stringify(quiet));
    if ((await call(s, "idea_read", { id: idea.id })).resting?.by !== "itself, after a fortnight untouched") throw new Error("idea_read does not say the idea rested by itself");
    await addItem(owner, idea.id, { text: "Back to this " + tag, x: 300, y: 300 });
    if ((await getIdea(idea.id)).idea.state !== "growing") throw new Error("the owner adding to an idea that fell asleep did not wake it");

    // Found by search, and opened by read, like anything else.
    const hits = await call(s, "search", { query: "smoke test idea " + tag, types: ["idea"] });
    if (!hits.results?.some((x: any) => x.id === idea.id && x.type === "idea" && x.path === "/ideas/" + idea.id)) throw new Error("search does not find an idea: " + JSON.stringify(hits).slice(0, 300));
    const opened = (await call(s, "read", { ids: [idea.id] }))[0];
    if (opened?.type !== "idea" || !opened.pieces?.length) throw new Error("read does not open an idea: " + JSON.stringify(opened).slice(0, 300));

    // Two ideas with something in common: an agent pairs them, the owner sees each from the other, and one set aside is not suggested again.
    const other = await createIdea(owner, { text: "A second smoke test idea " + tag });
    if (!(await call(s, "idea_relate", { a: idea.id, b: other.id })).ERROR) throw new Error("two ideas were paired without saying what they share");
    const pair = await call(s, "idea_relate", { a: idea.id, b: other.id, label: "both about size" });
    if (!pair.id) throw new Error("idea_relate: " + JSON.stringify(pair));
    const near = (await getIdea(other.id)).near;
    if (near.length !== 1 || near[0].idea.id !== idea.id || near[0].label !== "both about size") throw new Error("the other idea does not show the pairing: " + JSON.stringify(near));
    if ((await call(claude, "idea_read", { id: idea.id })).near?.[0]?.idea !== other.id) throw new Error("idea_read does not carry what an idea is near");
    await setAsideNear(owner, pair.id);
    if ((await getIdea(idea.id)).near.length) throw new Error("a pairing set aside is still shown");
    const again = await call(claude, "idea_relate", { a: other.id, b: idea.id, label: "same thing really" });
    if (!again.ERROR || !/set this pairing aside/.test(again.ERROR)) throw new Error("a pairing the owner set aside was suggested again: " + JSON.stringify(again));

    // Ready to act on: an agent names the first step, the owner says not yet or makes the task with one tap, and the agent hears which.
    const unkept = await call(s, "idea_ripe", { idea: other.id, step: "Do the thing" });
    if (!unkept.ERROR || !/kept/.test(unkept.ERROR)) throw new Error("an idea with nothing kept was called ready: " + JSON.stringify(unkept));
    await call(s, "changes");
    if (!(await call(s, "idea_ripe", { idea: idea.id, step: "Build one at half the size " + tag })).ok) throw new Error("idea_ripe was refused on an idea with something kept");
    if ((await getIdea(idea.id)).ripe?.step !== "Build one at half the size " + tag || !(await listIdeas()).find((x) => x.id === idea.id)!.ripe) throw new Error("the owner is not shown that the idea is ready");
    await notYet(owner, idea.id);
    if ((await getIdea(idea.id)).ripe) throw new Error("an idea is still shown as ready after not yet");
    if (!(await call(s, "changes")).for_you.some((i: any) => i.type === "idea.not_yet" && i.id === idea.id)) throw new Error("the agent was not told the owner said not yet");
    const pressed = await call(s, "idea_ripe", { idea: idea.id, step: "Build it anyway" });
    if (!pressed.ERROR || !/not yet/.test(pressed.ERROR)) throw new Error("an agent asked again straight after not yet: " + JSON.stringify(pressed));
    await q("UPDATE ideas SET not_yet_at = now() - interval '15 days' WHERE id = $1", [idea.id]);
    await call(s, "idea_ripe", { idea: idea.id, step: "Build one at half the size " + tag });
    const made = await makeTask(owner, idea.id);
    const task = await getTodo(made.todo.id);
    if (task.title !== "Build one at half the size " + tag || !task.notes.includes("/ideas?idea=" + idea.id) || !task.notes.includes("What if it were half the size?")) throw new Error("the task made of an idea does not carry its step and what was kept: " + JSON.stringify(task).slice(0, 400));
    if ((await makeTask(owner, idea.id)).todo.id !== task.id) throw new Error("a second tap made a second task");
    const done = await getIdea(idea.id);
    if (done.task?.id !== task.id || done.ripe) throw new Error("the idea does not show its task: " + JSON.stringify({ task: done.task, ripe: done.ripe }));
    if (!(await call(s, "changes")).for_you.some((i: any) => i.type === "idea.task" && i.id === idea.id)) throw new Error("the agent was not told its step became a task");
    const twice = await call(s, "idea_ripe", { idea: idea.id, step: "And another" });
    if (!twice.ERROR || !/already made a task/.test(twice.ERROR)) throw new Error("an idea with a task was called ready again: " + JSON.stringify(twice));
    await deleteTodo(owner, task.id);
    await deleteTodo(owner, task.id, true);
    await deleteIdea(owner, other.id);
    await deleteIdea(owner, idea.id);
    if ((await call(s, "search", { query: "smoke test idea " + tag, types: ["idea"] })).results.some((x: any) => x.id === idea.id || x.id === other.id)) throw new Error("a removed idea is still found by search");
    if ((await call(s, "idea_list")).ideas.some((x: any) => x.id === idea.id)) throw new Error("a removed idea is still listed");
  }

  {
    // Reading well: a list that is not the whole says so, the week's feed comes in one call, gather() brings what bears on a piece of work, and a note whose body moved is asked about its summary.
    const week = await call(s, "explore", { path: "/feed/week" });
    if (!week.items?.length || week.count !== week.items.length || !week.items[0].day || !week.items[0].line) throw new Error("explore(/feed/week) is not the week, a line a post: " + JSON.stringify(week).slice(0, 300));
    const firstPage = await call(s, "explore", { path: "/log" });
    if (firstPage.next_cursor && !/^\d+ of \d+/.test(firstPage.showing ?? "")) throw new Error("a first page does not say how much of the whole it is: " + JSON.stringify({ showing: firstPage.showing, count: firstPage.count }));
    const place = await call(claude, "context_write", { parent: "home", title: "Cornwall " + tag, summary: "Holiday idea.", body: "Summer holiday by the sea." });
    const grown = await call(claude, "context_write", { id: place.id, body: "Summer holiday by the sea.\n\n" + "- A cottage near St Ives, a week in August, walking the coast path each morning. ".repeat(6) });
    if (!/summary did not/.test(grown.check_summary ?? "")) throw new Error("a note whose body grew a great deal was not asked about its summary: " + JSON.stringify(grown));
    await call(claude, "context_write", { id: place.id, body: "Summer holiday by the sea.", summary: "Holiday idea." });
    const forTask = await call(s, "gather", { about: t.id });
    if (forTask.about?.task !== t.id || !forTask.next) throw new Error("gather(task id) did not take the task as its subject: " + JSON.stringify(forTask).slice(0, 300));
    const forWork = await call(s, "gather", { about: "the summer holiday in Cornwall" });
    if (!forWork.context?.some((x: any) => x.id === place.id) || !forWork.current?.length) throw new Error("gather(sentence) did not bring the note that bears on it, or what is current: " + JSON.stringify(forWork).slice(0, 500));
    const reading = await call(s, "usage", { days: 7 });
    if (!reading.context_to_tidy) throw new Error("usage() does not list notes to tidy");
    if (reading.search_by_meaning?.on !== meaningOn() || typeof reading.search_by_meaning.waiting !== "number") throw new Error("usage() does not say where search by meaning stands: " + JSON.stringify(reading.search_by_meaning));
    // By meaning, when that is on (in this check a stand-in embedder is used, which knows that a vacation is a holiday).
    const asked = await call(s, "search", { query: "vacation", types: ["context"] });
    if (meaningOn()) {
      if ((await embedPending(40, 60)) < 1) throw new Error("nothing was given an embedding");
      const meant = await call(s, "search", { query: "vacation", types: ["context"] });
      const hit = meant.results.find((x: any) => x.id === place.id);
      if (meant.mode !== "words and meaning" || hit?.match !== "meaning") throw new Error("search by meaning did not find the holiday note for \"vacation\": " + JSON.stringify(meant).slice(0, 500));
      const worded = (await call(s, "search", { query: "Cornwall " + tag })).results.find((x: any) => x.id === place.id);
      if (!worded || worded.match) throw new Error("a match by its words was marked as a match by meaning: " + JSON.stringify(worded));
      if (!(await call(s, "gather", { about: "booking a vacation" })).context?.some((x: any) => x.id === place.id)) throw new Error("gather did not use meaning");
    } else if (asked.mode !== "words only" || asked.results.some((x: any) => x.id === place.id)) throw new Error("with meaning off, search should be by words only: " + JSON.stringify(asked).slice(0, 300));
    await call(claude, "context_archive", { id: place.id });
  }

  {
    // Current: a note under /context/current says what is true for now and until when. It is in every briefing while it holds; past its day it drops out and its writer is told once.
    await ensureCurrent();
    const noDay = await call(s, "context_write", { parent: "/context/current", title: "Smoke focus " + tag, summary: "Testing the current tier." });
    if (!noDay.ERROR || !/until/.test(noDay.ERROR)) throw new Error("a current note was accepted without an end day: " + JSON.stringify(noDay));
    const soon = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    const focus = await call(s, "context_write", { parent: "/context/current", title: "Smoke focus " + tag, summary: "Testing the current tier.", body: "- From the smoke test.", until: soon });
    if (focus.until !== soon) throw new Error("context_write did not keep the end day: " + JSON.stringify(focus));
    const told = (await call(claude, "briefing")).current?.find((x: any) => x.path === focus.path);
    if (told?.until !== soon || told.set_by !== "@" + s.handle) throw new Error("the briefing does not list what is current: " + JSON.stringify(told));
    if ((await call(claude, "read", { ids: [focus.id] }))[0]?.until !== soon) throw new Error("read() does not give a note's end day");
    await call(s, "changes");
    await q("UPDATE context_nodes SET until = current_date - 2 WHERE id = $1", [focus.id]);
    if ((await tellLapsed()) < 1 || (await tellLapsed()) !== 0) throw new Error("a note past its day should be told of once");
    if (!(await call(s, "changes")).for_you.some((i: any) => i.type === "context.lapsed" && i.id === focus.id)) throw new Error("the writer was not told its note passed its day");
    const after = await call(s, "briefing");
    if (after.current?.some((x: any) => x.path === focus.path) || !after.lapsed_notes_of_yours?.some((x: any) => x.path === focus.path)) throw new Error("a lapsed note should leave current and be named to its writer: " + JSON.stringify(after).slice(0, 300));
    // renewed, it is current again
    await call(s, "context_write", { id: focus.id, until: soon });
    if (!(await call(claude, "briefing")).current?.some((x: any) => x.path === focus.path)) throw new Error("a renewed note did not come back into current");
    await call(s, "context_archive", { id: focus.id });
  }

  {
    // House rules: an agent cannot change a note under /context/system by itself. Its change waits for the owner, who answers from the rail, and an approved change is applied exactly as it was written.
    const sys = await ensureSystem();
    const rule = await createNode(owner, { parent: sys.id, title: "Smoke rule " + tag, summary: "A rule for the smoke test.", body: "- First line." });
    const noWhy = await call(s, "context_write", { id: rule.id, body_append: "- Second line." });
    if (!noWhy.ERROR || !/why/.test(noWhy.ERROR)) throw new Error("a house rule could be changed without saying why: " + JSON.stringify(noWhy));
    const change = { id: rule.id, body_append: "- Second line.", why: "The smoke test needs a second line." };
    const asked = await call(s, "context_write", change);
    if (!asked.proposed || !asked.id) throw new Error("a change to a house rule was not held as a proposal: " + JSON.stringify(asked));
    if ((await getNode(rule.id)).body.includes("Second line")) throw new Error("a house rule changed before the owner approved it");
    if ((await call(s, "context_write", change)).id !== asked.id) throw new Error("the same proposal was made twice");
    const inside = await call(s, "context_write", { parent: "/context/system", title: "Smoke rule two " + tag, body: "- Another." });
    if (!inside.ERROR || !/why/.test(inside.ERROR)) throw new Error("an agent could add a house rule without approval: " + JSON.stringify(inside));
    const waitingRule = (await pendingProposals()).find((x) => x.id === asked.id);
    if (!waitingRule || waitingRule.excerpt !== "Adds: Second line." || waitingRule.by !== s.handle) throw new Error("the proposal is not waiting as it was made: " + JSON.stringify(waitingRule));
    // every agent is given the house rules without asking
    const again: any = await handleMcp(s, { jsonrpc: "2.0", id: ++n, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    if (!again.json.result.instructions.includes("HOUSE RULES") || !again.json.result.instructions.includes("Smoke rule " + tag)) throw new Error("the connection instructions do not carry the house rules");
    if (!(await call(s, "briefing")).house_rules?.includes("First line")) throw new Error("the briefing does not carry the house rules");
    await call(s, "changes");
    if (waitingRule.module_id) {
      // the owner taps Approve on the module: the server applies it, and the agent hears
      const yes = await moduleActed(owner, waitingRule.module_id, "Approve");
      if (!yes.cleared || yes.sent?.label !== "Approve") throw new Error("approving from the rail: " + JSON.stringify(yes));
      if (!(await call(s, "changes")).for_you.some((i: any) => i.type === "rail.cleared" && i.sent === "approve")) throw new Error("the agent did not hear that its proposal was approved");
    } else await decide(owner, asked.id, true);
    const applied = await getNode(rule.id);
    if (!applied.body.endsWith("- Second line.") || applied.updated_by !== s.id) throw new Error("an approved proposal was not applied as written: " + JSON.stringify({ body: applied.body, by: applied.updated_by }));
    // declined: nothing changes, and it stops waiting
    const removal = await call(s, "context_archive", { id: rule.id, why: "The smoke test is over." });
    if (!removal.proposed) throw new Error("removing a house rule was not held as a proposal: " + JSON.stringify(removal));
    await decide(owner, removal.id, false);
    await getNode(rule.id);
    if ((await pendingProposals()).some((x) => x.id === removal.id)) throw new Error("a declined proposal is still waiting");
    await archiveNode(owner, rule.id);
  }

  {
    // Routines: given to an agent, a routine comes due at once, reaches the agent as a job with its brief, and is finished with routine_done.
    if ((await tick()).due.length) throw new Error("a routine came due with nobody assigned to it");
    await call(s, "changes");
    await assignRoutine(owner, "news-gaps", s.id);
    const first = await tick();
    if (first.due.join() !== "news-gaps") throw new Error("the assigned routine did not come due: " + JSON.stringify(first));
    if ((await tick()).due.length) throw new Error("a routine was handed over twice");
    const told = await call(s, "changes");
    const duty = told.open_jobs?.find((j: any) => j.kind === "routine" && j.routine === "news-gaps");
    if (!duty?.brief || !told.for_you.some((i: any) => i.type === "job.created")) throw new Error("the agent was not handed the routine: " + JSON.stringify(told).slice(0, 400));
    const waitingJobs = await call(s, "jobs");
    if (!waitingJobs.routines || !waitingJobs.jobs.some((j: any) => j.job_id === duty.job_id)) throw new Error("jobs() does not list the routine");
    if (!(await call(claude, "routine_done", { job_id: duty.job_id, note: "Not mine." })).ERROR) throw new Error("another agent could finish a routine that is not its own");
    const finished = await call(s, "routine_done", { job_id: duty.job_id, note: "No gaps this week." });
    if (!finished.ok || !finished.next_due) throw new Error("routine_done: " + JSON.stringify(finished));
    const kept = (await listRoutines()).find((r) => r.key === "news-gaps")!;
    if (kept.last_note !== "No gaps this week." || !kept.last_done_at || new Date(kept.next_at!).getTime() - Date.now() < 6 * 86400_000) throw new Error("the routine did not keep its last round or its next day: " + JSON.stringify(kept));
    const seenAs = await call(claude, "explore", { path: "/routines" });
    if (!seenAs.children.some((x: any) => x.path === "/routines/news-gaps" && x.about.includes("@" + s.handle))) throw new Error("explore(/routines) does not say who does the routine");
    if (!(await call(s, "briefing")).your_routines?.length) throw new Error("the briefing does not name the agent's routines");
    await assignRoutine(owner, "news-gaps", null);
    // Idea growth may be shared: a second agent joins the first instead of taking it, each is handed its own job, and taking it from one leaves the other.
    await assignRoutine(owner, "idea-growth", s.id, true);
    await assignRoutine(owner, "idea-growth", claude.id, true);
    const shared = (await listRoutines()).find((r) => r.key === "idea-growth")!;
    if (shared.agent_id !== s.id || shared.also.join() !== claude.id || !shared.shared) throw new Error("a second agent did not join a shared routine: " + JSON.stringify(shared));
    await tick();
    for (const who of [s, claude]) {
      const mine = (await call(who, "jobs")).jobs.filter((j: any) => j.routine === "idea-growth");
      if (mine.length !== 1) throw new Error(`${who.handle} has ${mine.length} idea-growth jobs, not one`);
      await call(who, "routine_done", { job_id: mine[0].job_id, note: "Nothing to grow in a test." });
    }
    await assignRoutine(owner, "news-gaps", claude.id, true);
    await assignRoutine(owner, "news-gaps", s.id, true);
    if ((await listRoutines()).find((r) => r.key === "news-gaps")!.also.length) throw new Error("a routine that is one agent's was shared");
    await assignRoutine(owner, "idea-growth", s.id, false);
    const leftWith = (await listRoutines()).find((r) => r.key === "idea-growth")!;
    if (leftWith.agent_id !== claude.id || leftWith.also.length) throw new Error("taking a shared routine from one agent did not leave it with the other: " + JSON.stringify(leftWith));
    await assignRoutine(owner, "idea-growth", null);
    await assignRoutine(owner, "news-gaps", null);
    await q("UPDATE jobs SET status = 'cancelled', done_at = now() WHERE kind = 'routine' AND status = 'open'");
    // the review's numbers
    const week = await call(s, "usage", { days: 7 });
    if (!week.agents?.some((x: any) => x.agent === "@" + s.handle && x.calls > 10) || !week.tools?.length || !week.rail?.length || week.tasks?.added_by_agents === undefined) throw new Error("usage() is missing its numbers: " + JSON.stringify(week).slice(0, 400));
  }

  // Forgiving where a small slip would otherwise mean sending the whole thing again.
  {
    for (const view of ["next week", "this-week", "Next_Week"]) if ((await call(s, "todo_list", { view })).ERROR) throw new Error(`todo_list refused the view "${view}"`);
    if ((await call(s, "reply", { post_id: p.id, body: "y".repeat(2050) })).ERROR) throw new Error("a reply a few words over the limit was refused");
    const wayOver = await call(s, "reply", { post_id: p.id, body: "y".repeat(2200) });
    if (!/Cut 200 /.test(wayOver.ERROR ?? "")) throw new Error("a reply far over the limit did not say how much to cut: " + JSON.stringify(wayOver));
    const fence = "```";
    const slips = `Intro.\n\n${fence}callout\n{"tone":"warning","title":"Only a title"}\n${fence}\n\n${fence}facts\n{"items":[{"label":"Kept","value":"1"},{"label":"No value"}]}\n${fence}\n\nOutro.`;
    const mended = await call(s, "page_write", { parent: "/context/agents", title: "Mended page " + tag, summary: "A page with small slips in its blocks.", body: slips });
    if (mended.ERROR) throw new Error("a page with small slips in its blocks was refused: " + mended.ERROR);
    const kept = (await getNode(mended.id)).body;
    if (!kept.includes('"tone":"warn"') || !kept.includes('"text":"Only a title"') || kept.includes("No value") || !kept.includes("Outro.")) throw new Error("a page's slips were not put right: " + kept);
    await archiveNode(owner, mended.id);
    const broken = await call(s, "page_write", { parent: "/context/agents", title: "Broken page " + tag, summary: "A page with a block that cannot be put right.", body: `${fence}callout\n{"tone":"info"}\n${fence}` });
    if (!broken.ERROR) throw new Error("a callout with no words at all was accepted");
  }

  // Chat: what the owner writes from any screen says what they were looking at, and goes to whoever it names, else the default agent.
  {
    const first = await sendChat(owner, "What changed here " + tag, { screen: "todos", type: "todo", id: followUp.id, title: "Decide on the smoke test", extra: "dropped" });
    const usual = await defaultAgent();
    if (!usual || first.to !== usual.id) throw new Error("a chat message naming nobody did not go to the default agent: " + first.to);
    if (first.message.about?.id !== followUp.id || first.message.about?.screen !== "todos" || "extra" in (first.message.about ?? {})) throw new Error("a chat message did not keep what was on screen: " + JSON.stringify(first.message.about));
    const named = await sendChat(owner, `@${s.handle} and what do you make of it ${tag}?`, { screen: "nowhere" });
    if (named.to !== s.id || named.message.about) throw new Error("a chat message naming an agent did not go to it, or kept a screen that does not exist: " + JSON.stringify(named));
    const heard = await call(s, "changes", { peek: true, limit: 100 });
    if (!heard.for_you?.some((e: { id: string }) => e.id === named.message.id)) throw new Error("the agent named in a chat message was not told of it");
    const seen = await call(usual.id === claude.id ? claude : s, "read", { ids: [first.message.id] });
    if (!JSON.stringify(seen).includes(`"id":"${followUp.id}"`)) throw new Error("the agent reading a chat message is not shown what it was about: " + JSON.stringify(seen).slice(0, 300));
    const chat = await listChat();
    if (chat.default_agent !== usual.id || ![first, named].every((x) => chat.messages.some((m) => m.id === x.message.id))) throw new Error("chat does not list every conversation together");
    if (!(await sendChat(s as never, "from an agent", null).then(() => false, () => true))) throw new Error("an agent was allowed to use the owner's chat");
  }

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

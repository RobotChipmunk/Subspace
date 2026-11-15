// Drives the web app in real Mobile Safari (an iPad simulator, through safaridriver) and types a
// long note into a task, the way a person does: an @mention, then several minutes of sentences,
// while the things that happen in the background after a mention happen (the agent checks in, the
// agent writes into the notes). After every sentence it checks that what was typed is in the note.
//   node scripts/safari-probe.cjs <outDir>
// Needs: safaridriver listening on :4444, the app on :3000 (freshly seeded), DATABASE_URL.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const OUT = process.argv[2] || "safari-out";
fs.mkdirSync(OUT, { recursive: true });
const DRIVER = process.env.DRIVER_URL || "http://localhost:4444";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const sql = (s) => execSync(`psql "${process.env.DATABASE_URL}" -At -c "${s}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

let session = "";
async function wd(method, url, body) {
  const res = await fetch(`${DRIVER}${session ? `/session/${session}` : ""}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(json.value ?? json).slice(0, 400)}`);
  return json.value;
}
const js = (script, ...args) => wd("POST", "/execute/sync", { script, args });
const find = async (css) => (await wd("POST", "/element", { using: "css selector", value: css }))[ELEMENT];
async function waitFor(css, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await find(css);
    } catch (e) {
      if (Date.now() > end) throw new Error(`no ${css} after ${ms}ms`);
      await sleep(300);
    }
  }
}
const click = (el) => wd("POST", `/element/${el}/click`, {});
/** Keys pressed one at a time, as on a keyboard, with a human gap between them. */
let keyMode = "actions";
async function type(text, gap = 55) {
  if (keyMode === "actions") {
    const actions = [];
    for (const ch of text) actions.push({ type: "keyDown", value: ch }, { type: "keyUp", value: ch }, { type: "pause", duration: gap });
    await wd("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions }] });
    await wd("DELETE", "/actions").catch(() => {});
  } else {
    // a word at a time into the field being typed in
    for (const piece of text.match(/\S*\s*|[\s\S]/g).filter(Boolean)) {
      await wd("POST", `/element/${target}/value`, { text: piece });
      await sleep(gap * 2);
    }
  }
}
let target = "";
const ENTER = "";
let shots = 0;
async function shot(name) {
  try {
    fs.writeFileSync(path.join(OUT, `${String(++shots).padStart(2, "0")}-${name}.png`), Buffer.from(await wd("GET", "/screenshot"), "base64"));
  } catch (e) {
    console.log("  (no screenshot:", e.message.slice(0, 80) + ")");
  }
}

/** What the page and the editor think is going on. */
const STATE = `
  const dom = document.querySelector(".ProseMirror");
  const ed = dom && dom.editor;
  const a = document.activeElement;
  const sel = getSelection();
  const d = window.__probe || {};
  const out = {
    editors: document.querySelectorAll(".ProseMirror").length,
    active: a ? (a.tagName + "." + String(a.className).slice(0, 40)) : null,
    domText: dom ? dom.innerText.length : -1,
    said: dom ? (dom.innerText.match(/SENTENCE/g) || []).length : -1,
    selIn: !!(dom && sel.anchorNode && dom.contains(sel.anchorNode)),
    floating: document.querySelectorAll("[data-floating]").length,
    errors: (d.errors || []).splice(0),
    events: Object.assign({}, d.events), log: (d.log || []).splice(0),
  };
  if (ed) Object.assign(out, {
    pmText: ed.state.doc.textContent.length, pmSaid: (ed.state.doc.textContent.match(/SENTENCE/g) || []).length,
    focused: ed.isFocused, hasFocus: ed.view.hasFocus(), editable: ed.isEditable, destroyed: ed.isDestroyed, composing: ed.view.composing,
    ce: dom.getAttribute("contenteditable"), capturing: ed.isCapturingTransaction,
  });
  return out;
`;
const PROBE = `
  const p = (window.__probe = { errors: [], events: {}, log: [] });
  window.addEventListener("error", (e) => p.errors.push("error: " + e.message + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno));
  window.addEventListener("unhandledrejection", (e) => p.errors.push("rejection: " + (e.reason && e.reason.message || e.reason)));
  const ce = console.error; console.error = function () { p.errors.push("console: " + Array.from(arguments).map(String).join(" ").slice(0, 300)); return ce.apply(console, arguments); };
  const count = (k) => (p.events[k] = (p.events[k] || 0) + 1);
  for (const t of ["keydown", "keypress", "input", "compositionstart", "compositionend", "focusin", "focusout", "blur", "focus"])
    document.addEventListener(t, (e) => { count(t); if (/focus|blur|composition/.test(t)) p.log.push(t + ":" + (e.target.tagName || "doc") + "@" + Math.round(performance.now())); }, true);
  document.addEventListener("beforeinput", (e) => count("beforeinput:" + e.inputType + (e.defaultPrevented ? "(prevented)" : "")), true);
  return true;
`;

const SENTENCE = "help me research this and capture it here. I think we found the heater already, so write the details down. ";
const problems = [];

async function openTask(title) {
  await wd("POST", "/url", { url: `${BASE}/todos` });
  await waitFor("nav[aria-label=Lists]");
  let ok = false;
  for (const end = Date.now() + 45000; !ok && Date.now() < end; ok || (await sleep(500)))
    ok = await js(`const t = arguments[0]; const el = Array.from(document.querySelectorAll(".todo-row *")).find((n) => n.childElementCount === 0 && n.textContent.trim() === t); if (!el) return false; el.scrollIntoView({ block: "center" }); el.setAttribute("data-probe-row", ""); return true;`, title);
  if (!ok) throw new Error(`task "${title}" is not on the list, which shows: ${await js(`return Array.from(document.querySelectorAll(".todo-row")).map((r) => r.innerText.trim().slice(0, 40)).join(" | ") + " // " + document.body.innerText.slice(0, 300).replace(/\\n/g, " / ")`)}`);
  await click(await find("[data-probe-row]"));
  const ed = await waitFor(".ProseMirror");
  await sleep(1200);
  await js(PROBE);
  target = ed;
  await click(ed);
  await sleep(600);
  return ed;
}

/** One run: open a task, write a note, and check after every sentence that the typing landed. */
async function run(name, title, { mention, background }) {
  console.log(`\n== ${name}: ${title}`);
  const id = sql(`SELECT id FROM todos WHERE title = '${title.replace(/'/g, "''")}' LIMIT 1`);
  await openTask(title);
  await type("Deadline: before Thanksgiving." + ENTER);
  if (mention === "pick") {
    await type("@cl", 120);
    await sleep(700);
    await type(ENTER);
  } else if (mention === "type") await type("@claude ", 120);
  await sleep(500);
  let first = await js(STATE.replace(/SENTENCE/g, "help me research"));
  console.log("  start", JSON.stringify(first));
  await shot(`${name}-start`);
  let bad = 0;
  for (let round = 1; round <= 12; round++) {
    await background(round, id);
    await type(SENTENCE);
    await sleep(round % 3 === 0 ? 2500 : 900);
    const s = await js(STATE.replace(/SENTENCE/g, "help me research"));
    const okay = s.said === round && s.pmSaid === round && s.editors === 1;
    console.log(`  ${okay ? "ok " : "BAD"} round ${round}: note has ${s.said} (editor state ${s.pmSaid}) of ${round}`, JSON.stringify({ ...s, events: undefined }), JSON.stringify(s.events));
    if (!okay) {
      if (!bad++) await shot(`${name}-stuck-round-${round}`);
      problems.push(`${name}: after sentence ${round} the note held ${s.said}`);
      // Does a tap bring it back, as it should?
      await click(await find(".ProseMirror")).catch((e) => console.log("  tap failed:", e.message.slice(0, 120)));
      await sleep(500);
      await type("tapped ");
      const after = await js(STATE.replace(/SENTENCE/g, "tapped"));
      console.log("  after a tap and typing 'tapped':", JSON.stringify({ ...after, events: undefined }));
      if (bad >= 2) break;
    }
  }
  await sleep(1500);
  await shot(`${name}-end`);
  const saved = sql(`SELECT notes FROM todos WHERE id = '${id}'`);
  console.log(`  saved: ${saved.length} characters, ${(saved.match(/help me research/g) || []).length} sentences, agent text kept: ${saved.includes("<ins")}`);
  return saved;
}

(async () => {
  const caps = { browserName: "safari", platformName: "iOS", "safari:useSimulator": true, "safari:deviceType": "iPad" };
  if (process.env.SIM) caps["safari:deviceUDID"] = process.env.SIM;
  let s;
  for (let attempt = 1; !s; attempt++) {
    try {
      s = await wd("POST", "/session", { capabilities: { alwaysMatch: caps } });
    } catch (e) {
      console.log(`no session (attempt ${attempt}): ${e.message.slice(0, 300)}`);
      if (attempt === 4) throw e;
      await sleep(15000);
    }
  }
  session = s.sessionId;
  console.log("session", JSON.stringify(s.capabilities));
  try {
    await wd("POST", "/url", { url: `${BASE}/login` });
    const pw = await waitFor("input[type=password]", 60000);
    // Which way of pressing keys reaches the page in this Safari?
    target = pw;
    await click(pw);
    await sleep(1000);
    const held = () => js("return document.querySelector('input[type=password]').value + ' (focused: ' + (document.activeElement && document.activeElement.tagName) + ')'");
    await type("abc");
    console.log("keys by actions after a tap:", await held());
    keyMode = "sendKeys";
    await type("def");
    console.log("keys sent to the element:", await held());
    keyMode = "actions";
    await type("ghi");
    const got = await held();
    console.log("keys by actions once the element has been typed in:", got);
    if (!/ghi/.test(got)) keyMode = "sendKeys";
    if (!/def|ghi/.test(got)) throw new Error("no way of typing reaches the page");
    console.log("typing with", keyMode);
    // The production build marks its session cookie Secure, which Safari will not keep for
    // http://localhost, so sign in from here and hand the page the session.
    const login = await (await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.SUBSPACE_PASSWORD || "subspace" }) })).json();
    await wd("POST", "/cookie", { cookie: { name: "ss_session", value: login.token, path: "/" } });
    await wd("POST", "/url", { url: `${BASE}/todos` });
    await waitFor("nav[aria-label=Apps]", 60000);
    console.log("signed in;", await js("return navigator.userAgent + ' | ' + innerWidth + 'x' + innerHeight"));

    const titles = sql("SELECT title FROM todos WHERE deleted_at IS NULL AND NOT done AND scope = 'day' AND date = (SELECT max(date) FROM todos WHERE scope = 'day' AND date <= CURRENT_DATE + 1 AND NOT done AND deleted_at IS NULL) ORDER BY position LIMIT 3").split("\n");
    console.log("tasks:", titles.join(" | "));
    const scenario = process.env.SCENARIO || "all";

    // 1. The report: tag an agent, keep typing, and the agent checks in while you do.
    if (scenario === "all" || scenario === "mention")
      await run("mention", titles[0], {
        mention: "type",
        background: async (round) => {
          if (round >= 3) sql("UPDATE agents SET last_seen_at = now(), cursor_seq = cursor_seq + 1 WHERE handle = 'claude'");
        },
      });
    // 2. The same, picking the agent from the menu, and the agent writes into the note half way.
    if (scenario === "all" || scenario === "agent")
      await run("agent-writes", titles[1], {
        mention: "pick",
        background: async (round, id) => {
          if (round === 5) sql(`UPDATE todos SET notes = notes || E'\\n\\n<ins data-agent=\\"claude\\" data-ts=\\"2026-11-15T10:00:00Z\\">The heater is a Stelpro.</ins>', ai_unseen = true, updated_at = now() WHERE id = '${id}'`);
          if (round === 5) await sleep(9000); // long enough for the page to fetch it
        },
      });
    // 3. No mention at all, for comparison.
    if (scenario === "all" || scenario === "plain") await run("plain", titles[2], { mention: null, background: async () => {} });
  } catch (e) {
    problems.push("probe failed: " + e.message);
    console.log("FAILED", e.stack);
    await shot("failure");
  } finally {
    await wd("DELETE", "").catch(() => {});
  }
  console.log(problems.length ? `\n${problems.length} problem(s):\n- ${problems.join("\n- ")}` : "\nTyping held up in every run.");
  process.exit(problems.length ? 1 : 0);
})();

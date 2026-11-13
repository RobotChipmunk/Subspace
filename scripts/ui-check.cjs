/**
 * Drives every screen and interaction in a real browser at desktop, tablet and phone sizes, in
 * light and dark, and fails on the kinds of defect that are easy to miss by eye:
 *   - a popup or control that is clipped, covered or off screen
 *   - sideways scrolling
 *   - browser errors
 * Run against a freshly seeded local database:  node scripts/ui-check.cjs [outDir]
 */
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.argv[2] || path.join(__dirname, "..", ".ui-check");
const PROFILES = [
  { name: "desktop-light", viewport: { width: 1280, height: 860 }, colorScheme: "light", touch: false },
  { name: "tablet-dark", viewport: { width: 1180, height: 820 }, colorScheme: "dark", touch: true },
  { name: "tablet-portrait", viewport: { width: 820, height: 1180 }, colorScheme: "light", touch: true },
  { name: "phone-dark", viewport: { width: 390, height: 844 }, colorScheme: "dark", touch: true },
];

const failures = [];

async function run(profile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: profile.viewport, colorScheme: profile.colorScheme, hasTouch: profile.touch, isMobile: profile.viewport.width < 500, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const fail = (msg) => failures.push(`[${profile.name}] ${msg}`);
  page.on("pageerror", (e) => fail(`page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && fail(`console error: ${m.text().slice(0, 4000)}`));

  const press = (loc) => (profile.touch ? loc.tap() : loc.click());
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${profile.name}-${name}.png`) });
  const settle = (ms = 700) => page.waitForTimeout(ms);

  /** The element is on screen, inside the viewport, and nothing is drawn over it. */
  async function reachable(loc, what) {
    const count = await loc.count();
    if (!count) return fail(`${what}: not found`);
    // Bring it to the middle of the screen first, clear of the navigation bar, unless it floats.
    await loc.first().evaluate((el) => !el.closest("[data-floating], nav") && el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    const problem = await loc.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return "has no size";
      const vw = innerWidth, vh = innerHeight;
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) return `extends outside the screen (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} in ${vw}x${vh})`;
      for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.2], [0.9, 0.8]]) {
        const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        if (top && !el.contains(top) && !top.contains(el)) return `is covered or clipped (by <${top.tagName.toLowerCase()} class="${String(top.className).slice(0, 50)}">)`;
      }
      return null;
    });
    if (problem) fail(`${what}: ${problem}`);
  }

  async function noSidewaysScroll(where) {
    const wide = await page.evaluate(() => {
      const out = [];
      const vw = innerWidth;
      if (document.documentElement.scrollWidth > vw + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide`);
      const main = document.querySelector("main");
      if (main && main.scrollWidth > main.clientWidth + 1) out.push(`content is ${main.scrollWidth}px wide in ${main.clientWidth}px`);
      for (const el of document.querySelectorAll("main *")) {
        const r = el.getBoundingClientRect();
        // Decorative layers inside a clipped art panel are meant to bleed past it.
        if (r.width > 0 && r.right > vw + 2 && !el.closest("[data-scroll-x], nav, .art")) {
          out.push(`<${el.tagName.toLowerCase()}> "${(el.textContent || "").trim().slice(0, 30)}" ends at ${Math.round(r.right)}px`);
          break;
        }
      }
      return out;
    });
    for (const w of wide) fail(`${where}: sideways overflow, ${w}`);
  }

  async function step(name, fn) {
    try {
      await fn();
    } catch (e) {
      fail(`${name}: ${String(e.message).split("\n")[0].slice(0, 220)}`);
      await shot(`FAILED-${name.replace(/\W+/g, "-")}`).catch(() => {});
    }
  }

  const menu = page.locator("[data-floating]");
  const typeIn = async (loc, text) => {
    await press(loc);
    await page.keyboard.type(text, { delay: 15 });
  };

  // ---------- Sign in ----------
  await page.goto(`${BASE}/login`);
  await settle(1000); // let the page finish loading before typing, as a person would
  await shot("login");
  await page.fill("input[type=password]", "wrong-password");
  await page.keyboard.press("Enter");
  await page.getByText("That password is not right.").waitFor({ timeout: 5000 }).catch(() => fail("login: no error shown for a wrong password"));
  await page.fill("input[type=password]", process.env.SUBSPACE_PASSWORD || "subspace");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/feed");
  await settle(1500);

  // Navigation is reachable everywhere.
  for (const label of ["Feed", "Todos", "Context", "Following", "Agents"]) await reachable(page.getByRole("link", { name: label, exact: true }), `nav ${label}`);

  // ---------- Feed ----------
  await step("feed layout", async () => {
    await noSidewaysScroll("feed");
    await shot("feed");
  });
  await step("feed composer mention", async () => {
    const box = page.getByPlaceholder("Tell your agents something");
    await typeIn(box, "Checking in @");
    await settle(400);
    await reachable(menu, "feed composer @ menu");
    await reachable(menu.getByText("Claude", { exact: true }), "feed composer @ menu item");
    await shot("feed-mention");
    await press(menu.getByText("Scout", { exact: true }));
    await settle(200);
    const v = await box.inputValue();
    if (!v.includes("@scout ")) fail(`feed composer: picking from the @ menu produced "${v}"`);
    await page.keyboard.type("hello from the UI check");
    await reachable(page.getByRole("button", { name: "Send" }), "feed send button");
    await page.keyboard.press("Enter");
    await page.getByText("hello from the UI check").first().waitFor({ timeout: 5000 });
  });
  await step("feed thread", async () => {
    const card = page.locator("article", { hasText: "Figure raised" }).first();
    await card.scrollIntoViewIfNeeded();
    await press(card.getByRole("button", { name: /conversation/ }));
    await settle(1200);
    await page.getByText("It strengthens it.").waitFor({ timeout: 5000 });
    const reply = page.getByPlaceholder("Reply. @ to bring in an agent.");
    // opening a conversation is for reading: the keyboard must only appear when the reply box is tapped
    const focused = await page.evaluate(() => ["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName ?? ""));
    if (focused) fail("feed thread: opening the conversation put the cursor in a text field, which raises the keyboard on a phone or tablet");
    await reply.scrollIntoViewIfNeeded();
    await settle(300);
    await reachable(reply, "thread reply box");
    await typeIn(reply, "Thanks @a");
    await settle(400);
    await reachable(menu, "thread @ menu");
    await reachable(menu.getByText("Atlas", { exact: true }), "thread @ menu item");
    await shot("feed-thread-mention");
    await page.keyboard.press("Enter");
    await page.keyboard.type("noted");
    await page.keyboard.press("Enter");
    await page.getByText("Thanks @atlas noted").first().waitFor({ timeout: 5000 });
    await noSidewaysScroll("feed thread");
    await shot("feed-thread");
    await page.keyboard.press("Escape");
    await settle(1500);
    if (await reply.count()) fail("feed thread: Escape did not close the thread");
    // the post itself is a link to its source, shown under the picture; the chat button is the only way into the thread
    const source = card.getByRole("link", { name: "The Information", exact: true });
    await reachable(source, "post source link");
    await reachable(card.getByRole("button", { name: /conversation/ }), "post chat button");
    const hrefs = await card.locator("a[target=_blank]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    if (hrefs.length < 3 || !hrefs.every((h) => h === "https://example.com/figure-series-c")) fail(`feed post: text, picture and source name should all link to the source (found ${JSON.stringify(hrefs)})`);
    await press(card.locator("p").first()).catch(() => {});
    await settle(700);
    if (await reply.count()) fail("feed post: tapping the text opened the conversation instead of the source");
  });
  await step("feed channel switch", async () => {
    await page.locator("main").evaluate((m) => m.scrollTo(0, 0));
    const tab = page.getByRole("button", { name: "Between agents" });
    await reachable(tab, "feed channel switch");
    await press(tab);
    await page.getByText("flag me so I can shift the school run").waitFor({ timeout: 5000 });
    await shot("feed-agents");
    await press(page.getByRole("button", { name: "For you" }));
    await settle();
  });

  // ---------- Todos ----------
  await step("todos folders", async () => {
    await press(page.getByRole("link", { name: "Todos", exact: true }));
    await page.waitForURL("**/todos");
    await settle(1200);
    await noSidewaysScroll("todos");
    await shot("todos");
    const folders = page.getByRole("navigation", { name: "Lists" }).getByRole("button");
    const n = await folders.count();
    if (n < 4) fail(`todos: only ${n} folders shown`);
    for (let i = 0; i < n; i++) {
      const f = folders.nth(i);
      await f.scrollIntoViewIfNeeded();
      const label = (await f.innerText()).split("\n")[0].trim();
      await press(f);
      // the list cross-fades to the new folder; wait for the heading to change rather than a fixed time
      await page.locator("h1", { hasText: label }).first().waitFor({ timeout: 4000 }).catch(() => {});
      const h = (await page.locator("h1").first().innerText()).trim();
      if (h !== label) fail(`todos: tapping "${label}" showed "${h}"`);
    }
    await shot("todos-backlog");
  });
  await step("todos add, tick, open", async () => {
    await press(page.getByRole("navigation", { name: "Lists" }).getByRole("button", { name: /^Today/ }));
    await settle(500);
    const add = page.getByRole("button", { name: "Add task" });
    await add.scrollIntoViewIfNeeded();
    await reachable(add, "todos add button");
    await press(add);
    await page.keyboard.type("UI check task");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.getByText("UI check task").waitFor({ timeout: 5000 });
    const row = page.locator("li", { hasText: "UI check task" });
    const box = row.getByRole("checkbox");
    await settle(900);
    await reachable(box, "todo checkbox");
    await press(box);
    await settle(500);
    if ((await box.getAttribute("aria-checked")) !== "true") fail("todos: ticking a task did not mark it done");
    await press(box);
    await settle(400);
    await press(row.getByText("UI check task"));
    await page.getByLabel("Task name").waitFor({ timeout: 5000 });
    await settle(900);
    await reachable(page.getByLabel("Move to"), "todo move menu");
    await reachable(page.getByLabel("Delete task"), "todo delete button");
  });
  await step("todo notes editor", async () => {
    const ed = page.locator(".ProseMirror");
    await press(ed);
    await page.keyboard.type("# Plan", { delay: 15 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("- first", { delay: 15 });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("[ ] check", { delay: 15 });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("ask @cl", { delay: 25 });
    await settle(400);
    await reachable(menu, "todo notes @ menu");
    await reachable(menu.getByText("Claude", { exact: true }), "todo notes @ menu item");
    await shot("todo-notes-mention");
    await page.keyboard.press("Enter");
    await settle(300);
    if (!(await ed.locator("h1", { hasText: "Plan" }).count())) fail("editor: '# ' did not become a heading");
    if (!(await ed.locator("ul:not([data-type]) li", { hasText: "first" }).count())) fail("editor: '- ' did not become a bullet");
    if (!(await ed.locator('ul[data-type="taskList"] li', { hasText: "check" }).count())) fail("editor: '[ ] ' did not become a checklist item");
    if (!(await ed.locator(".mention", { hasText: "@claude" }).count())) fail("editor: picked mention is not highlighted");
    await settle(1100);
    await noSidewaysScroll("todo detail");
    await shot("todo-detail");
    await press(page.getByRole("button", { name: /^Today$/ }).last());
    await settle(700);
    await press(page.locator("li", { hasText: "UI check task" }).getByText("UI check task"));
    await settle(1200);
    const saved = await page.locator(".ProseMirror").innerText();
    if (!saved.includes("Plan") || !saved.includes("@claude")) fail(`editor: notes were not saved (got "${saved.slice(0, 60)}")`);
    await press(page.getByLabel("Delete task"));
    await settle(1800);
    if (await page.getByText("UI check task").count()) fail("todos: deleted task is still listed");
  });
  await step("todo agent edits", async () => {
    await press(page.locator("li", { hasText: "Review robotics allocation" }).getByText("Review robotics allocation"));
    const banner = page.getByRole("button", { name: "Mark reviewed" });
    await banner.waitFor({ timeout: 5000 });
    await reachable(banner, "mark reviewed button");
    if (!(await page.locator(".ProseMirror ins").count())) fail("editor: agent edits are not highlighted");
    await shot("todo-agent-edits");
    await press(page.getByRole("button", { name: /^Today$/ }).last());
    await settle(600);
  });

  // ---------- Context ----------
  await step("context browse and edit", async () => {
    await press(page.getByRole("link", { name: "Context", exact: true }));
    await page.waitForURL("**/context");
    await settle(1200);
    await noSidewaysScroll("context");
    await shot("context");
    await press(page.locator("main button", { hasText: "Projects, goals and commitments" }).first());
    await settle(900);
    await press(page.getByRole("button", { name: /Robotics thesis/ }).first());
    await page.getByLabel("Title").waitFor({ timeout: 5000 });
    await settle(900);
    await reachable(page.getByLabel("Remove"), "context remove button");
    const ed = page.locator(".ProseMirror");
    await press(ed.locator("li").last());
    await settle(300); // a person cannot press a key within a few milliseconds of clicking
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("ask @sc", { delay: 25 });
    await settle(400);
    await reachable(menu, "context @ menu");
    await reachable(menu.getByText("Scout", { exact: true }), "context @ menu item");
    await shot("context-mention");
    await page.keyboard.press("Enter");
    await settle(400);
    await shot("context-note");
    const lastItem = (await ed.locator("li").last().innerText()).trim();
    if (!lastItem.includes("@scout")) fail(`context editor: text typed after clicking the last line landed elsewhere (last line is "${lastItem.slice(0, 40)}")`);
    for (let i = 0; i < 12; i++) await page.keyboard.press("Backspace");
    await settle(1100);
    await noSidewaysScroll("context note");
  });
  await step("context search", async () => {
    const search = page.getByLabel("Search context");
    await reachable(search, "context search field");
    await typeIn(search, "compost");
    await page.getByRole("button", { name: /Weekly rhythm/ }).waitFor({ timeout: 5000 });
    await reachable(page.getByRole("button", { name: /Weekly rhythm/ }), "context search result");
    await shot("context-search");
    await press(page.getByLabel("Clear"));
    await settle(500);
  });

  // ---------- Pages ----------
  await step("pages in context", async () => {
    await page.goto(`${BASE}/context`);
    await settle(1500);
    const recent = page.locator("section", { hasText: "Recent pages" }).getByRole("button", { name: /Portland dinner options/ });
    await reachable(recent, "recent pages card");
    await shot("context-recent-pages");
    await press(recent);
    await page.locator(".page-block").first().waitFor({ timeout: 8000 });
    await settle(2500);
    for (const kind of ["callout", "cards", "map", "table", "columns", "sources"]) await reachable(page.locator(`.page-block[data-kind="${kind}"] > section, .page-block[data-kind="${kind}"] > div`).last(), `${kind} block`);
    const carousel = page.locator('.page-block[data-kind="cards"] .carousel');
    const c = await carousel.evaluate((el) => ({ cards: el.children.length, scrolls: el.scrollWidth > el.clientWidth }));
    if (c.cards !== 4) fail(`page: carousel shows ${c.cards} cards, expected 4`);
    if (!c.scrolls && profile.viewport.width < 1100) fail("page: carousel does not scroll sideways on a narrow screen");
    const pins = await page.locator(".map-frame .map-pin").count();
    if (pins !== 5) fail(`page: map shows ${pins} pins, expected 5`);
    const rating = page.locator('.page-block[data-kind="cards"]').getByText("4.6").first();
    await reachable(rating, "card rating");
    await noSidewaysScroll("page");
    await shot("page-shortlist");
    // a block is one unit: its data can be edited or it can be removed
    const callout = page.locator('.page-block[data-kind="callout"]');
    await callout.scrollIntoViewIfNeeded();
    await callout.hover();
    await press(callout.getByRole("button", { name: "Edit" }));
    await reachable(callout.getByLabel("callout data"), "block data editor");
    await press(callout.getByRole("button", { name: "Cancel" }));
    await settle(300);
    if (!(await callout.getByText("Book Nostrana for Saturday").count())) fail("page: cancelling a block edit lost the block");
  });
  await step("research page", async () => {
    await page.goto(`${BASE}/context`);
    await settle(1200);
    await press(page.locator("section", { hasText: "Recent pages" }).getByRole("button", { name: /Humanoid robotics/ }));
    await page.locator('.page-block[data-kind="chart"]').first().waitFor({ timeout: 8000 });
    await settle(1500);
    for (const kind of ["stats", "chart", "timeline", "callout", "sources"]) await reachable(page.locator(`.page-block[data-kind="${kind}"] > section, .page-block[data-kind="${kind}"] > div`).first(), `${kind} block`);
    const chart = await page.locator('.page-block[data-kind="chart"] svg').first().evaluate((el) => ({ drawn: el.getBoundingClientRect().width, natural: el.viewBox.baseVal.width, marks: el.querySelectorAll("path, polyline").length }));
    if (Math.abs(chart.drawn - chart.natural) > 2) fail(`page: chart is scaled (${Math.round(chart.drawn)}px drawn for a ${chart.natural}px drawing), so its text is the wrong size`);
    if (!chart.marks) fail("page: chart has no bars or lines");
    if (!(await page.getByText("$2B").count())) fail("page: chart axis does not format units ($2B)");
    const title = await page.getByLabel("Title").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    if (!title) fail("page: the title is cut off");
    await noSidewaysScroll("research page");
    await shot("page-research");
  });
  await step("page link from the feed", async () => {
    await page.goto(`${BASE}/feed`);
    await settle(1500);
    const card = page.locator("article", { hasText: "Italian place for Saturday" }).first();
    await card.scrollIntoViewIfNeeded();
    await press(card.getByRole("button", { name: /conversation/ }));
    await settle(1300);
    const link = card.getByRole("link", { name: /Portland dinner options/ });
    await reachable(link, "page card in a reply");
    await shot("feed-page-card");
    await press(link);
    await page.waitForURL("**/context?node=*", { timeout: 8000 });
    await page.locator(".page-block").first().waitFor({ timeout: 8000 });
  });
  await step("blocks in a todo", async () => {
    await page.goto(`${BASE}/todos`);
    await settle(1200);
    await press(page.locator("li", { hasText: "Find a restaurant in Portland" }).getByText("Find a restaurant in Portland"));
    await page.locator('.page-block[data-kind="cards"]').waitFor({ timeout: 8000 });
    await settle(800);
    await reachable(page.locator('.page-block[data-kind="cards"]').getByText("Nostrana").first(), "cards in todo notes");
    await reachable(page.getByLabel("Add an image").locator(".."), "add image button");
    await noSidewaysScroll("todo with blocks");
    await shot("todo-blocks");
  });

  // ---------- Following ----------
  await step("following expand and assign", async () => {
    await press(page.getByRole("link", { name: "Following", exact: true }));
    await page.waitForURL("**/following");
    await settle(1200);
    await noSidewaysScroll("following");
    await shot("following");
    await press(page.getByRole("button", { name: /West Seattle news/ }));
    await settle(1100);
    const plus = page.getByRole("button", { name: "Agent", exact: true });
    await reachable(plus, "add agent button");
    await press(plus);
    await settle(400);
    await reachable(menu, "agent picker");
    await reachable(menu.getByRole("menuitem", { name: /Atlas/ }), "agent picker item");
    await reachable(menu.getByRole("menuitem").last(), "agent picker last item");
    await shot("following-picker");
    await press(menu.getByRole("menuitem", { name: /Atlas/ }));
    await page.getByRole("button", { name: "Remove Atlas" }).waitFor({ timeout: 5000 });
    await press(plus);
    await settle(300);
    await press(page.getByLabel("What to track"));
    await settle(900);
    if (await menu.count()) fail("agent picker: tapping elsewhere did not close it");
    await press(page.getByRole("button", { name: "Remove Atlas" }));
    await settle(600);
    await reachable(page.getByLabel("Feed label"), "tracker label field");
    await reachable(page.getByLabel("Stop following"), "stop following button");
    await noSidewaysScroll("following expanded");
    await shot("following-open");
  });
  await step("following add and remove", async () => {
    const add = page.getByRole("button", { name: "Follow something" });
    await add.scrollIntoViewIfNeeded();
    await press(add);
    await page.getByLabel("Title").fill("UI check topic");
    await page.getByLabel("Description").fill("Only here for the UI check.");
    await press(page.getByRole("button", { name: "Follow", exact: true }));
    await page.getByRole("button", { name: /UI check topic/ }).waitFor({ timeout: 5000 });
    await settle(1200);
    await shot("following-new");
    const stop = page.getByLabel("Stop following");
    await stop.last().scrollIntoViewIfNeeded();
    await press(stop.last());
    await settle(2000);
    if (await page.getByText("UI check topic").count()) fail("following: removed topic is still listed");
  });

  // ---------- Agents ----------
  await step("agents connect", async () => {
    await press(page.getByRole("link", { name: "Agents", exact: true }));
    await page.waitForURL("**/agents");
    await settle(1200);
    await noSidewaysScroll("agents");
    await shot("agents");
    await press(page.getByRole("button", { name: "Add an agent" }));
    await page.getByLabel("Agent name").fill(`Probe ${Date.now().toString(36).slice(-5)}`);
    await press(page.getByRole("button", { name: "Add", exact: true }));
    await page.getByText("Connector address").waitFor({ timeout: 5000 });
    await settle(700);
    await reachable(page.locator("code").first(), "connector address");
    await page.getByRole("button", { name: "Done" }).scrollIntoViewIfNeeded();
    await settle(300);
    await reachable(page.getByRole("button", { name: "Done" }), "connect panel Done");
    await noSidewaysScroll("agents connect panel");
    await shot("agents-connect");
    await press(page.getByRole("button", { name: "Remove agent" }));
    await settle(800);
  });
  await step("agents realtime", async () => {
    await page.locator("main").evaluate((m) => m.scrollTo(0, 0));
    await press(page.getByLabel("Realtime settings").first());
    await page.getByLabel("Anthropic API key").waitFor({ timeout: 5000 });
    await settle(700);
    for (const group of ["Model", "Effort", "Context window"]) {
      const radios = page.getByRole("radiogroup", { name: group }).getByRole("radio");
      const n = await radios.count();
      if (!n) fail(`realtime: ${group} has no choices`);
      for (let i = 0; i < n; i++) {
        await radios.nth(i).scrollIntoViewIfNeeded();
        await reachable(radios.nth(i), `realtime ${group} choice ${i + 1}`);
        const cut = await radios.nth(i).locator("span").last().evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        if (cut) fail(`realtime: ${group} choice "${await radios.nth(i).innerText()}" is cut off`);
      }
    }
    await page.getByLabel("Anthropic API key").fill("not-a-key");
    await press(page.getByRole("button", { name: "Save" }));
    await page.getByText("does not look like an Anthropic API key").waitFor({ timeout: 5000 });
    await noSidewaysScroll("agents realtime panel");
    await shot("agents-realtime");
  });

  await browser.close();
}

(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  // PROFILE=phone-dark runs one screen size on its own
  for (const p of PROFILES.filter((x) => !process.env.PROFILE || x.name === process.env.PROFILE)) {
    const before = failures.length;
    await run(p).catch((e) => failures.push(`[${p.name}] run aborted: ${String(e.message).split("\n")[0]}`));
    console.log(`${p.name}: ${failures.length - before} problem(s)`);
  }
  console.log(failures.length ? `\n${failures.length} problem(s):\n` + failures.map((f) => " - " + f).join("\n") : "\nNo problems found.");
  process.exit(failures.length ? 1 : 0);
})();

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
      // the outer points stay inside a fully round control: (0.9, 0.8) lies exactly on a circle's edge
      for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.25], [0.85, 0.75]]) {
        const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        // the dev server's own badge floats over the corner of the page; it is not part of the app
        if (top && !el.contains(top) && !top.contains(el) && top.tagName !== "NEXTJS-PORTAL") return `is covered or clipped (by <${top.tagName.toLowerCase()} class="${String(top.className).slice(0, 50)}">)`;
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
  // the mark is drawn, not blank: particles in a latent space, turning slowly
  const inked = await page
    .locator("canvas[data-mark]")
    .evaluate((c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
      return n / (c.width * c.height);
    })
    .catch(() => 0);
  if (inked < 0.02 || inked > 0.6) fail(`login: the mark is ${inked ? "not drawn as particles" : "missing"} (${(inked * 100).toFixed(1)}% of it is inked)`);
  await shot("login");
  await page.fill("input[type=password]", "wrong-password");
  await page.keyboard.press("Enter");
  await page.getByText("That password is not right.").waitFor({ timeout: 5000 }).catch(() => fail("login: no error shown for a wrong password"));
  await page.fill("input[type=password]", process.env.SUBSPACE_PASSWORD || "subspace");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/feed");
  await settle(1500);
  if (process.env.DATABASE_URL) {
    // an earlier screen size cleared rail modules; bring them back so every size sees the same thing
    const { Client } = require("pg");
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query("UPDATE rail_modules SET dismissed_at = NULL, cleared_by = NULL, sent = NULL");
    await db.end();
    await page.reload();
    await settle(1500);
  }

  // Navigation is reachable everywhere.
  for (const label of ["Feed", "Todos", "Journal", "Ideas", "Context", "Following", "Agents"]) await reachable(page.getByRole("link", { name: label, exact: true }), `nav ${label}`);

  // ---------- The rail ----------
  const wide = profile.viewport.width >= 1100;
  await step("rail", async () => {
    const toggle = page.getByRole("button", { name: /^Now/ });
    const hotel = page.locator('[data-rail-module="portland-hotel"]');
    if (wide) {
      await hotel.waitFor({ timeout: 6000 });
      // with something in it the rail is simply there: no button to show or hide it
      if (await toggle.count()) fail("rail: a wide screen still shows a rail toggle");
      // docked: the content must make room for it rather than sit underneath
      const overlap = await page.evaluate(() => {
        const rail = document.querySelector('aside[aria-label="Now"]').getBoundingClientRect();
        return [...document.querySelectorAll("main article, main form, main h1")].some((el) => el.getBoundingClientRect().right > rail.left + 1);
      });
      if (overlap) fail("rail: page content runs underneath the docked rail");
      // it grows with the screen: 28% of the width, never under 300px nor over 360px
      const railWidth = await page.evaluate(() => document.querySelector('aside[aria-label="Now"]').getBoundingClientRect().width);
      const wanted = Math.min(360, Math.max(300, profile.viewport.width * 0.28));
      if (Math.abs(railWidth - wanted) > 1.5) fail(`rail: docked ${Math.round(railWidth)}px wide on a ${profile.viewport.width}px screen, expected ${Math.round(wanted)}px`);
    } else {
      if (await hotel.count()) fail("rail: modules are showing before the rail is opened on a narrow screen");
      await reachable(toggle, "rail button");
      await press(toggle);
      await hotel.waitFor({ timeout: 6000 });
      await settle(700);
    }
    await reachable(hotel.getByText("Residence Inn, Pearl District"), "rail module title");
    // a glance by default: details stay hidden until the module is opened
    if (await hotel.getByText("84127763").count()) fail("rail: module details are showing before it is expanded");
    // but what to do about it never hides: one button on every module, and only one until it is opened
    await reachable(hotel.getByRole("link", { name: /Get directions/ }), "rail module: its one thing to do, closed");
    if (await hotel.getByRole("link", { name: /Call|Open page/ }).count()) fail("rail: a closed module shows more than its first button");
    const offered = await page.locator("[data-rail-module]").evaluateAll((mods) => mods.map((m) => `${m.dataset.railModule}: ${m.querySelector("[data-rail-actions]")?.children.length ?? 0}`));
    if (offered.some((o) => !o.endsWith(": 1"))) fail(`rail: every closed module should offer exactly one thing to do (${offered.join(", ")})`);
    // each says what kind of thing it is by the picture at its front
    const tones = await page.locator("[data-rail-module]").evaluateAll((mods) => Object.fromEntries(mods.map((m) => [m.dataset.railModule, m.dataset.tone])));
    if (tones["calendar-auth"] !== "error" || tones["agility-topup"] !== "act" || tones["portland-hotel"] !== "know") fail(`rail: modules are not told apart at a glance (${JSON.stringify(tones)})`);
    if (await page.locator("[data-rail-module] .rail-tile svg").count() !== 5) fail("rail: a module is missing its icon");
    await shot("rail-closed");
    await press(hotel.getByRole("button", { expanded: false }));
    await settle(700);
    await reachable(hotel.getByText("84127763"), "rail module detail");
    await reachable(hotel.getByRole("link", { name: /Get directions/ }), "rail module action");
    await reachable(hotel.getByRole("link", { name: "Call" }), "rail module second action");
    await reachable(hotel.getByRole("link", { name: "Open page" }), "rail module page link");
    await reachable(hotel.getByRole("button", { name: "Later" }), "rail module: Later");
    const count = await page.locator("[data-rail-module]").count();
    if (count !== 5) fail(`rail: ${count} modules shown, expected 5`);
    // an error from an agent is listed first and marked
    const firstMod = page.locator("[data-rail-module]").first();
    if ((await firstMod.getAttribute("data-level")) !== "error") fail("rail: the error module is not shown first");
    await reachable(firstMod.getByText("Calendar connection expired"), "rail error title");
    await noSidewaysScroll("rail");
    await shot("rail");
    // one open at a time
    const roof = page.locator('[data-rail-module="roof-inspection"]');
    await press(roof.getByRole("button", { expanded: false }));
    await hotel
      .getByText("84127763")
      .waitFor({ state: "detached", timeout: 4000 })
      .catch(() => fail("rail: opening one module left the other expanded"));
    // Nothing to do about the roofer but know it, so its button says so, and saying so clears it.
    // Closing a module without acting does the same; a wide screen checks the one, a narrow screen the other.
    await reachable(roof.getByRole("button", { name: "Got it" }), "rail: Got it on a module with nothing to do");
    await press(wide ? roof.getByRole("button", { name: "Got it" }) : page.getByRole("button", { name: "Dismiss Roofer comes to inspect" }));
    await settle(900);
    if ((await page.locator("[data-rail-module]").count()) !== 4) fail(`rail: ${wide ? "Got it" : "dismissing a module"} did not remove it`);

    // "Later": not now, but not lost. The module becomes a task on the day chosen and leaves the rail.
    const get = (url) => page.evaluate((u) => fetch(u).then((r) => r.json()), url);
    const del = (url) => page.evaluate((u) => fetch(u, { method: "DELETE" }).then((r) => r.status), url);
    // A button can send an action to the agent that raised the module. The owner is told at once that
    // it was sent, whether or not the agent is running; then the module leaves like any other.
    const suggest = page.locator('[data-rail-module="follow-shaders"]');
    await reachable(suggest.getByRole("button", { name: "Follow it" }), "rail: a button that sends an action to its agent");
    if (await suggest.getByRole("button", { name: "Not this" }).count()) fail("rail: a closed module shows its second answer");
    await press(suggest.getByRole("button", { name: "Follow it" }));
    await suggest
      .locator('[data-rail-sent="done"]', { hasText: "Sent to Scout" })
      .waitFor({ timeout: 6000 })
      .catch(() => fail('rail: tapping a button that sends did not say "Sent to Scout"'));
    await shot("rail-sent");
    await suggest.waitFor({ state: "detached", timeout: 6000 }).catch(() => fail("rail: a module whose action was sent is still in the rail"));
    await settle(500);
    if ((await get("/api/v1/rail")).modules.some((m) => m.key === "follow-shaders")) fail("rail: sending an action did not clear the module");
    const auth = page.locator('[data-rail-module="calendar-auth"]');
    await press(auth.getByRole("button", { expanded: false }));
    await settle(700);
    await reachable(auth.getByText("I could not read your calendar this morning"), "rail error: what happened, once opened");
    await press(auth.getByRole("button", { name: "Later" }));
    await settle(500);
    const days = auth.locator("[data-rail-later] button", { hasText: /^(Today|Tomorrow|This week)$/ });
    if ((await days.count()) !== 3) fail("rail: Later does not offer Today, Tomorrow and This week");
    const tops = await days.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    if (new Set(tops).size !== 1) fail("rail: the days Later offers do not fit on one line");
    for (const d of await days.all()) await reachable(d, "rail: a day to keep a module for");
    await noSidewaysScroll("rail later");
    await shot("rail-later");
    await press(auth.getByRole("button", { name: "Tomorrow" }));
    await auth.waitFor({ state: "detached", timeout: 6000 }).catch(() => fail("rail: a module kept for later is still in the rail"));
    await settle(600);
    if ((await get("/api/v1/rail")).modules.some((m) => m.key === "calendar-auth")) fail("rail: Later did not clear the module");
    const kept = (await get("/api/v1/todos?view=tomorrow")).todos.find((t) => t.title === "Calendar connection expired");
    if (!kept) fail("rail: Later did not leave a task for tomorrow");
    else {
      // the follow-up remains: the task carries what the module said, and its button
      const task = await get(`/api/v1/todos/${kept.id}`);
      if (!task.rail || !task.rail.kept || task.rail.key !== "calendar-auth") fail("rail: the kept task is not tied to the module it came from");
      if (!/could not read your calendar/.test(task.notes)) fail("rail: the kept task lost what the module said");
      if (!wide) (await press(page.locator('aside[aria-label="Now"]').getByRole("button", { name: "Close" })), await settle(900));
      await page.goto(`${BASE}/todos?open=${kept.id}`);
      await page.getByLabel("Task name").waitFor({ timeout: 8000 });
      await settle(900);
      const from = page.locator("[data-from-rail]");
      await reachable(from.getByText("From Atlas, kept for later"), "kept task: whose module it was");
      await reachable(from.getByRole("link", { name: /Reconnect/ }), "kept task: the module's button");
      await noSidewaysScroll("kept task");
      await shot("rail-kept-task");
      // taken out again, so the lists the later steps count are as they were seeded
      await del(`/api/v1/todos/${kept.id}`);
      await del(`/api/v1/todos/${kept.id}?forever=1`);
      await page.goto(`${BASE}/feed`);
      await settle(1500);
    }
    if (!wide && (await page.locator('aside[aria-label="Now"]').count())) {
      await press(page.locator('aside[aria-label="Now"]').getByRole("button", { name: "Close" }));
      await settle(900);
      if (await hotel.count()) fail("rail: closing the sheet left its modules on screen");
    }
  });

  // ---------- Feed ----------
  await step("feed layout", async () => {
    await noSidewaysScroll("feed");
    await shot("feed");
  });
  await step("feed columns", async () => {
    // As many columns as fit at least a phone's width each (340px) with 16px between, inside the
    // page's margins; one where not even two fit. Posts never overlap, the newest leads, the page
    // keeps its margins, and a post does not carry the topic it belongs to.
    const columns = async (where) => {
      await settle(1200);
      const room = await page.locator("[data-feed]").evaluate((el) => el.clientWidth);
      const cards = await page.locator("main article[data-post]").evaluateAll((els) =>
        els.map((e) => ((r) => ({ left: Math.round(r.left), top: r.top, bottom: r.bottom, right: r.right, width: r.width }))(e.getBoundingClientRect())),
      );
      if (cards.length < 4) return fail(`feed columns${where}: only ${cards.length} posts showing`);
      const lanes = [...new Set(cards.map((c) => c.left))].length;
      const want = Math.max(1, Math.floor((room + 16) / 356));
      if (lanes !== want) fail(`feed columns${where}: ${lanes} columns in ${room}px of room, expected ${want}`);
      if (cards.some((c) => c.width < 330)) fail(`feed columns${where}: a post is ${Math.round(Math.min(...cards.map((c) => c.width)))}px wide, narrower than on a phone`);
      for (let i = 0; i < cards.length; i++)
        for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i], b = cards[j];
          if (a.left === b.left && a.top < b.bottom - 1 && b.top < a.bottom - 1) fail(`feed columns${where}: posts ${i + 1} and ${j + 1} overlap`);
        }
      if (cards.some((c) => c.top < cards[0].top - 1)) fail(`feed columns${where}: the newest post is not at the top`);
      // the outer columns keep the page's margin from the navigation and from the edge (or the rail)
      const edges = await page.locator("[data-feed]").evaluate((el) => ((r) => [r.left, r.right])(el.getBoundingClientRect()));
      if (cards.some((c) => c.left < edges[0] - 1 || c.right > edges[1] + 1)) fail(`feed columns${where}: a post runs outside the feed's room`);
      return lanes;
    };
    await columns("");
    if (await page.locator("main article .chip").count()) fail("feed: a post still shows the topic it belongs to");
    // the picture leads the post, then the words, then who posted it
    const order = await page.locator("main article", { hasText: "Figure raised" }).first().evaluate((a) => {
      const y = (sel) => a.querySelector(sel)?.getBoundingClientRect().top ?? -1;
      return [y(".art"), y("p"), y("[data-byline]")];
    });
    if (!(order[0] >= 0 && order[0] < order[1] && order[1] < order[2])) fail(`feed: a post is not picture, words, then byline (${order.map(Math.round)})`);
    await noSidewaysScroll("feed columns");
    await shot("feed-columns");
    // a large screen fills with more columns, as many as fit
    if (profile.name.startsWith("desktop")) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      const lanes = await columns(" at 1920px");
      if (lanes < 3) fail(`feed columns: a 1920px screen shows only ${lanes} columns`);
      await noSidewaysScroll("feed wide");
      await shot("feed-wide");
      await page.setViewportSize(profile.viewport);
      await settle(1200);
    }
  });
  await step("feed is read-only", async () => {
    if (await page.getByPlaceholder("Tell your agents something").count()) fail("feed: the owner's composer is still there");
    if (await page.getByRole("button", { name: "Between agents" }).count()) fail("feed: the channel switch is still there");
  });
  await step("feed thread", async () => {
    const card = page.locator("article", { hasText: "Figure raised" }).first();
    await card.scrollIntoViewIfNeeded();
    await press(card.getByRole("button", { name: /^Comments/ }));
    await settle(1200);
    const panel = page.locator('aside[aria-label="Comments"]');
    await panel.getByText("It strengthens it.").waitFor({ timeout: 5000 });
    const reply = page.getByPlaceholder("Reply. @ to bring in an agent.");
    await reachable(panel.getByRole("button", { name: "Close comments" }), "comments close button");
    if (profile.viewport.width >= 768) {
      // beside the feed: the feed makes room, the docked rail steps aside, and the navigation stays clear
      const clash = await page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const side = box(document.querySelector('aside[aria-label="Comments"]'));
        const nav = box(document.querySelector("nav"));
        const cards = [...document.querySelectorAll("main article, main form, main h1")].map(box);
        if (cards.some((r) => r.right > side.left - 8)) return "the feed runs underneath the comments";
        if (cards.some((r) => r.left < nav.right + 8)) return "the feed runs underneath the navigation";
        if (document.querySelector('aside[aria-label="Now"]')) return "the rail is still showing beside the comments";
        return null;
      });
      if (clash) fail(`feed comments: ${clash}`);
      await noSidewaysScroll("feed comments");
    }
    // opening comments is for reading: the keyboard must only appear when the reply box is tapped
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
    // a recognised @name takes the accent colour while it is still being typed, drawn exactly over the field's own text
    await page.keyboard.type("and @nobody ");
    const tag = page.locator("[data-mention]");
    if ((await tag.allInnerTexts()).join() !== "@atlas") fail(`mention highlight: expected only @atlas to be marked, found "${(await tag.allInnerTexts()).join()}"`);
    const look = await reply.evaluate((ta) => {
      const mirror = ta.parentElement.querySelector("[data-mention-mirror]");
      const a = getComputedStyle(ta), b = getComputedStyle(mirror), m = getComputedStyle(mirror.querySelector("[data-mention]"));
      const probe = document.createElement("span");
      probe.className = "mention";
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return { same: ["fontSize", "fontFamily", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingLeft"].filter((k) => a[k] !== b[k]), size: Math.abs(ta.offsetHeight - mirror.offsetHeight), weight: m.fontWeight === b.fontWeight, colour: m.color === accent, hidden: a.color };
    });
    if (look.same.length || look.size > 1 || !look.weight) fail(`mention highlight: the coloured text does not sit exactly on the typed text (${JSON.stringify(look)})`);
    if (!look.colour) fail("mention highlight: the @name is not in the colour a sent mention has");
    await shot("feed-thread-mention-typed");
    for (let i = 0; i < "and @nobody ".length; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type("noted");
    await page.keyboard.press("Enter");
    await page.getByText("Thanks @atlas noted").first().waitFor({ timeout: 5000 });
    await noSidewaysScroll("feed thread");
    await shot("feed-thread");
    if (profile.viewport.width >= 768) {
      // comments stay open while the feed scrolls, and follow the post being read down its column
      // (here to the top of the feed, where the post at the head of that column is read)
      await page.locator("main").evaluate((m) => m.scrollTo({ top: 0 }));
      await settle(900);
      if (!(await reply.count())) fail("feed comments: scrolling the feed closed the comments");
      const followed = await page.evaluate(() => {
        const cards = [...document.querySelectorAll("main article[data-post]")].map((a) => ({ a, r: a.getBoundingClientRect() }));
        const on = cards.filter((c) => c.a.querySelector('button[aria-label="Close comments"]'));
        if (on.length !== 1) return `${on.length} posts show their comments as open`;
        const r = on[0].r;
        if (cards.some((c) => c.r.top < r.top - 1 && c.r.left < r.right && c.r.right > r.left)) return "the post whose comments show is not the one at the head of its column";
        return null;
      });
      if (followed) fail(`feed comments: scrolling to the top did not move the comments to the post there (${followed})`);
      if (await panel.getByText("It strengthens it.").count()) fail("feed comments: the panel still shows the previous post's comments");
      await shot("feed-comments-follow");
      // pressing comments on another post moves them there (unless scrolling to it already did); pressing again closes
      await card.scrollIntoViewIfNeeded();
      await settle(900);
      if (!(await card.getByRole("button", { name: "Close comments" }).count())) await press(card.getByRole("button", { name: /^Comments/ }));
      await settle(1400);
      await panel.getByText("It strengthens it.").waitFor({ timeout: 4000 }).catch(() => fail("feed comments: choosing another post did not show its comments"));
      await press(card.getByRole("button", { name: "Close comments" }));
      await settle(1500);
      if (await reply.count()) fail("feed comments: pressing the comments button again did not close them");
      if (wide && !(await page.locator('aside[aria-label="Now"]').count())) fail("feed comments: the rail did not come back after comments closed");
      await press(card.getByRole("button", { name: /^Comments/ }));
      await settle(1200);
    }
    await page.keyboard.press("Escape");
    await settle(1500);
    if (await reply.count()) fail("feed thread: Escape did not close the thread");
    // the post itself is a link to its source, shown under the picture; the chat button is the only way into the thread
    const source = card.getByRole("link", { name: "The Information", exact: true });
    await reachable(source, "post source link");
    await reachable(card.getByRole("button", { name: /^Comments/ }), "post chat button");
    const hrefs = await card.locator("a[target=_blank]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    if (hrefs.length < 3 || !hrefs.every((h) => h === "https://example.com/figure-series-c")) fail(`feed post: text, picture and source name should all link to the source (found ${JSON.stringify(hrefs)})`);
    await press(card.locator("p").first()).catch(() => {});
    await settle(700);
    if (await reply.count()) fail("feed post: tapping the text opened the conversation instead of the source");
  });
  await step("feed pictures", async () => {
    const card = page.locator("article", { hasText: "Three-Live" }).first();
    const pics = card.locator("[data-pictures]");
    await reachable(pics, "post pictures");
    const on = () => pics.locator("[data-dots] span").evaluateAll((d) => d.map((x) => x.dataset.on).join());
    if ((await on()) !== "true,false,false") fail(`feed pictures: expected three dots with the first lit (found ${await on()})`);
    await reachable(pics.locator("[data-dots]"), "picture dots");
    // swiping to the next picture moves the dot, and the card does not grow sideways
    await pics.locator(".slides").evaluate((el) => el.scrollTo({ left: el.clientWidth }));
    await settle(500);
    if ((await on()) !== "false,true,false") fail(`feed pictures: showing the second picture did not move the dot (found ${await on()})`);
    if (!profile.touch) {
      await pics.hover();
      await reachable(pics.getByRole("button", { name: "Next picture" }), "next picture button");
      await press(pics.getByRole("button", { name: "Next picture" }));
      await settle(900);
      if ((await on()) !== "false,false,true") fail("feed pictures: the next button did not show the third picture");
      if (await pics.getByRole("button", { name: "Next picture" }).count()) fail("feed pictures: a next button is offered on the last picture");
    }
    const shown = await pics.locator("img").evaluateAll((imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length);
    if (shown < 2) fail("feed pictures: the pictures did not load");
    await noSidewaysScroll("feed pictures");
    await shot("feed-pictures");
  });
  await step("feed video", async () => {
    const card = page.locator("article", { hasText: "Digit unloads" }).first();
    const clip = card.locator("[data-clip]");
    const state = () => clip.locator("video").evaluate((v) => ({ paused: v.paused, muted: v.muted, time: v.currentTime, ready: v.readyState }));
    // Just out of view: 200px below the screen, or above it where the post is on the first screen
    // (as it is in two columns), since the page cannot scroll up past its top.
    const outOfView = () =>
      card.evaluate((el) => {
        const main = el.closest("main");
        main.scrollTo({ top: 0 });
        const r = el.getBoundingClientRect();
        main.scrollBy({ top: r.top - innerHeight - 200 >= 0 ? r.top - innerHeight - 200 : r.bottom + 200 });
      });
    // out of view it waits; scrolled into view it plays by itself, without sound
    await outOfView();
    await settle(600);
    if (!(await state()).paused) fail("feed video: the video is playing while it is off screen");
    await card.scrollIntoViewIfNeeded();
    await clip.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settle(1200);
    let s = await state();
    if (s.paused || !s.muted || s.time <= 0) fail(`feed video: scrolled into view, the video did not start playing silently (${JSON.stringify(s)})`);
    await reachable(clip, "feed video");
    // a tap turns the sound on; it does not open the source
    const sound = clip.getByRole("button", { name: "Turn sound on" });
    await reachable(sound, "video sound button");
    await press(sound);
    await settle(400);
    s = await state();
    if (s.muted || s.paused) fail(`feed video: the sound button did not turn the sound on (${JSON.stringify(s)})`);
    await press(clip.getByRole("button", { name: "Turn sound off" }));
    await noSidewaysScroll("feed video");
    await shot("feed-video");
    // scrolled away again, it stops
    await outOfView();
    await settle(700);
    if (!(await state()).paused) fail("feed video: the video kept playing after it was scrolled out of view");
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
  await step("todos reorder", async () => {
    // Dragging a task must be able to carry it past several rows, by finger (after a short hold) and by mouse.
    await press(page.getByRole("navigation", { name: "Lists" }).getByRole("button", { name: /^Today/ }));
    await settle(900);
    const rows = page.locator("main ul li");
    const titles = () => rows.evaluateAll((els) => els.map((e) => e.innerText.trim().split("\n")[0]));
    // wait until the list has stopped changing (it may still be loading or refreshing after the view switch)
    let before = await titles();
    for (let i = 0; i < 10; i++) {
      await settle(500);
      const again = await titles();
      if (again.join("|") === before.join("|")) break;
      before = again;
    }
    if (before.length < 4) return fail(`todos reorder: only ${before.length} tasks to test with`);
    const at = await rows.evaluateAll((els) => els.map((e) => ((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }))(e.getBoundingClientRect())));
    const end = at[3].y + at[3].h * 0.4;
    if (profile.touch) {
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
      // a quick swipe is a scroll, never a drag
      await touch("touchStart", at[1].x, at[1].y);
      for (let i = 1; i <= 8; i++) (await touch("touchMove", at[1].x, at[1].y - i * 12), await page.waitForTimeout(12));
      await touch("touchEnd", 0, 0);
      await settle(600);
      if ((await titles()).join("|") !== before.join("|")) fail("todos reorder: a quick swipe over a task moved it");
      await page.locator("main").evaluate((el) => el.scrollTo(0, 0));
      await settle(300);
      // hold, then carry the first task past three others
      await touch("touchStart", at[0].x, at[0].y);
      await page.waitForTimeout(450);
      for (let i = 1; i <= 24; i++) (await touch("touchMove", at[0].x, at[0].y + ((end - at[0].y) * i) / 24), await page.waitForTimeout(25));
      await page.waitForTimeout(200);
      await touch("touchEnd", 0, 0);
      await cdp.detach();
    } else {
      await page.mouse.move(at[0].x, at[0].y);
      await page.mouse.down();
      for (let i = 1; i <= 24; i++) (await page.mouse.move(at[0].x, at[0].y + ((end - at[0].y) * i) / 24), await page.waitForTimeout(20));
      await page.mouse.up();
    }
    await settle(900);
    const after = await titles();
    if (after.indexOf(before[0]) !== 3) fail(`todos reorder: dragging the first task past three rows left it at position ${after.indexOf(before[0]) + 1}, expected 4`);
    if (await page.getByLabel("Task name").count()) fail("todos reorder: letting go of a dragged task opened it");
    await shot("todos-reordered");
    // A row that wanders sideways stops trading places; brought back, it must carry on. (It used
    // to stay stuck where it left the list, for that drag and every one after.)
    const now = await rows.evaluateAll((els) => els.map((e) => ((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }))(e.getBoundingClientRect())));
    const from = now[3];
    const top = now[0].y - now[0].h * 0.4;
    // out to the side, up past a row while out there (the order it asks for is turned down), back
    // in line, then on to the top
    const path = [];
    for (let i = 1; i <= 4; i++) path.push([from.x - (90 * i) / 4, from.y - i]);
    for (let i = 1; i <= 8; i++) path.push([from.x - 90, from.y - 4 - (from.h * 1.5 * i) / 8]);
    for (let i = 1; i <= 6; i++) path.push([from.x - 90 + (90 * i) / 6, from.y - 4 - from.h * 1.5 - i]);
    const back = from.y - 10 - from.h * 1.5;
    for (let i = 1; i <= 16; i++) path.push([from.x, back + ((top - back) * i) / 16]);
    if (profile.touch) {
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
      await touch("touchStart", from.x, from.y);
      await page.waitForTimeout(450);
      for (const [x, y] of path) (await touch("touchMove", x, y), await page.waitForTimeout(25));
      await page.waitForTimeout(200);
      await touch("touchEnd", 0, 0);
      await cdp.detach();
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (const [x, y] of path) (await page.mouse.move(x, y), await page.waitForTimeout(20));
      await page.mouse.up();
    }
    await settle(900);
    const returned = (await titles()).indexOf(before[0]);
    if (returned !== 0) fail(`todos reorder: a task carried sideways and back, then to the top, was left at position ${returned + 1}, expected 1`);
  });
  await step("todos carry to another day", async () => {
    // A task dragged onto a list in the folders moves there. On touch the folders are beside the
    // list from tablet width, where pulling a row sideways lifts it at once; above it on a phone.
    const nav = page.getByRole("navigation", { name: "Lists" });
    const rows = page.locator("main ul li");
    const titles = () => rows.evaluateAll((els) => els.map((e) => e.innerText.trim().split("\n")[0]));
    const mid = (loc) => loc.evaluate((e) => ((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left }))(e.getBoundingClientRect()));
    async function carry(title, toName, shotName) {
      const from = await mid(page.locator("main ul li", { hasText: title }));
      from.x = from.left + 110;
      const target = nav.getByRole("button", { name: toName });
      await target.scrollIntoViewIfNeeded();
      const to = await mid(target);
      const at = (i) => [from.x + ((to.x - from.x) * i) / 24, from.y + ((to.y - from.y) * i) / 24];
      let cdp;
      const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
      if (profile.touch) {
        cdp = await page.context().newCDPSession(page);
        await touch("touchStart", from.x, from.y);
        // straight up is a scroll until the row has been held; sideways needs no hold
        if (Math.abs(to.x - from.x) < Math.abs(to.y - from.y) * 2) await page.waitForTimeout(450);
        for (let i = 1; i <= 24; i++) (await touch("touchMove", ...at(i)), await page.waitForTimeout(25));
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let i = 1; i <= 24; i++) (await page.mouse.move(...at(i)), await page.waitForTimeout(20));
      }
      await page.waitForTimeout(400);
      if ((await target.getAttribute("data-over")) !== "true") fail(`todos carry: holding a task over "${toName}" did not light it`);
      if (shotName) (await noSidewaysScroll("todos carry"), await shot(shotName));
      if (profile.touch) (await touch("touchEnd", 0, 0), await cdp.detach());
      else await page.mouse.up();
      await settle(1200);
    }
    await press(nav.getByRole("button", { name: /^Today/ }));
    await settle(900);
    const before = await titles();
    if (!before.length) return fail("todos carry: no tasks to test with");
    const title = before[0];
    await carry(title, /^Next week/, "todos-carry");
    if ((await titles()).includes(title)) fail("todos carry: a task dropped on Next week stayed in Today");
    if (await page.getByLabel("Task name").count()) fail("todos carry: letting go of a carried task opened it");
    await press(nav.getByRole("button", { name: /^Next week/ }));
    await page.locator("main ul li", { hasText: title }).waitFor({ timeout: 5000 }).catch(() => fail("todos carry: the task did not arrive in Next week"));
    await settle(600);
    // and back, so every screen size starts from the same lists
    await carry(title, /^Today/);
    await press(nav.getByRole("button", { name: /^Today/ }));
    await page.locator("main ul li", { hasText: title }).waitFor({ timeout: 5000 }).catch(() => fail("todos carry: the task did not come back to Today"));
  });
  await step("todos carry between sections", async () => {
    // In a list with sections (the days of a week) a task carried onto another section moves to that day.
    const nav = page.getByRole("navigation", { name: "Lists" });
    const get = (url) => page.evaluate((u) => fetch(u).then((r) => r.json()), url);
    const today = (await get("/api/v1/todos/folders")).today;
    const title = "Draft Q1 goals";
    await press(nav.getByRole("button", { name: /^This week/ }));
    await settle(1200);
    const row = page.locator("main ul li", { hasText: title });
    const inGroup = (key) => page.locator(`[data-group="${key}"] li`, { hasText: title });
    if (!(await inGroup("any").count())) return fail("todos sections: the seeded week task is not under Any day");
    const mid = (loc) => loc.evaluate((e) => ((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left }))(e.getBoundingClientRect()));
    async function carry(key, shotName) {
      const from = await mid(row);
      from.x = from.left + 110;
      const group = page.locator(`[data-group="${key}"]`);
      const to = await mid(group.locator("h2"));
      const at = (i) => [from.x, from.y + ((to.y - from.y) * i) / 24];
      let cdp;
      const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
      if (profile.touch) {
        cdp = await page.context().newCDPSession(page);
        await touch("touchStart", from.x, from.y);
        await page.waitForTimeout(450); // up or down is a scroll until the row has been held
        for (let i = 1; i <= 24; i++) (await touch("touchMove", ...at(i)), await page.waitForTimeout(25));
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let i = 1; i <= 24; i++) (await page.mouse.move(...at(i)), await page.waitForTimeout(20));
      }
      await page.waitForTimeout(400);
      if ((await group.getAttribute("data-over")) !== "true") fail(`todos sections: holding a task over the "${key}" section did not light it`);
      if (shotName) (await noSidewaysScroll("todos sections"), await shot(shotName));
      if (profile.touch) (await touch("touchEnd", 0, 0), await cdp.detach());
      else await page.mouse.up();
      await settle(1500);
    }
    await carry(today, "todos-carry-section");
    if (!(await inGroup(today).count())) fail("todos sections: a task dropped on Today's section is not under it");
    if (await page.getByLabel("Task name").count()) fail("todos sections: letting go of a carried task opened it");
    const moved = (await get("/api/v1/todos?view=today")).todos.some((t) => t.title === title);
    if (!moved) fail("todos sections: a task dropped on Today's section was not saved on today");
    // and back, so every screen size starts from the same lists
    await carry("any");
    if (!(await inGroup("any").count())) fail("todos sections: a task dropped on Any day is not under it");
    const back = (await get("/api/v1/todos?view=week")).todos.find((t) => t.title === title);
    if (!back || back.scope !== "week") fail("todos sections: a task dropped on Any day was not saved for the week");
  });
  await step("todos add to a section", async () => {
    // In a list with sections every section that can take a task has its own plus, and adds to that day.
    const nav = page.getByRole("navigation", { name: "Lists" });
    const get = (url) => page.evaluate((u) => fetch(u).then((r) => r.json()), url);
    const today = (await get("/api/v1/todos/folders")).today;
    await press(nav.getByRole("button", { name: /^This week/ }));
    await settle(1200);
    const keys = await page.locator("[data-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-group")));
    for (const key of keys) {
      const has = await page.locator(`[data-group="${key}"] [data-add="${key}"]`).count();
      if (has !== 1) fail(`todos sections: the "${key}" section has ${has} add buttons, not one`);
    }
    if (await page.getByRole("button", { name: "Add task", exact: true }).count()) fail("todos sections: a list with sections still has one add button for the whole list");
    const add = page.getByRole("button", { name: "Add task to Today" });
    await add.scrollIntoViewIfNeeded();
    await reachable(add, "todos section add button");
    await press(add);
    const title = `Section task ${profile.name}`;
    await page.keyboard.type(title);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.locator(`[data-group="${today}"] li`, { hasText: title }).waitFor({ timeout: 5000 }).catch(() => fail("todos sections: a task added under Today is not in Today's section"));
    await settle(800);
    await shot("todos-section-add");
    const saved = (await get("/api/v1/todos?view=today")).todos.find((t) => t.title === title);
    if (!saved) return fail("todos sections: a task added under Today was not saved on today");
    // take it away again, so every screen size starts from the same lists
    // (for good, past the bin, which a later step expects to empty)
    await page.evaluate(async (id) => (await fetch(`/api/v1/todos/${id}`, { method: "DELETE" }), await fetch(`/api/v1/todos/${id}?forever=1`, { method: "DELETE" })), saved.id);
    await settle(400);
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
    // deleting asks first, in place: one tap arms it, nothing is removed yet
    const bin = page.locator(".confirm-delete");
    await press(page.getByLabel("Delete task"));
    await settle(600);
    if ((await bin.getAttribute("data-armed")) !== "true") fail("todos: the delete control did not ask for confirmation");
    await reachable(bin.getByText("Delete", { exact: true }), "delete confirmation");
    await noSidewaysScroll("delete confirmation");
    await shot("todo-delete-confirm");
    if (!(await page.getByLabel("Task name").count())) fail("todos: the task was deleted on the first tap");
    // a tap elsewhere stands it down
    await press(page.getByLabel("Task name"));
    await settle(500);
    if ((await bin.getAttribute("data-armed")) === "true") fail("todos: tapping elsewhere did not cancel the delete");
    await page.keyboard.press("Escape");
    // arm again and confirm
    await press(page.getByLabel("Delete task"));
    await settle(500);
    await press(bin);
    await settle(1800);
    if (await page.getByText("UI check task").count()) fail("todos: deleted task is still listed");
    // it is not gone: it waits in Recently deleted, and can be put back
    const binTab = page.getByRole("navigation", { name: "Lists" }).getByRole("button", { name: /^Recently deleted/ });
    await binTab.scrollIntoViewIfNeeded();
    await reachable(binTab, "recently deleted entry");
    await press(binTab);
    const binned = page.locator("[data-binned]", { hasText: "UI check task" });
    await binned.waitFor({ timeout: 5000 });
    await settle(700);
    await reachable(binned.getByText(/15 days left/), "days left in the bin");
    await reachable(binned.getByRole("button", { name: /^Restore/ }), "restore button");
    await reachable(binned.locator(".confirm-delete"), "delete for good button");
    await noSidewaysScroll("recently deleted");
    await shot("todos-bin");
    await press(binned.getByRole("button", { name: /^Restore/ }));
    await settle(1500);
    await press(page.getByRole("navigation", { name: "Lists" }).getByRole("button", { name: /^Today/ }));
    await page.locator("li", { hasText: "UI check task" }).waitFor({ timeout: 5000 }).catch(() => fail("todos: a restored task did not come back to its list"));
    await settle(600);
    // delete it again, then for good from the bin; the bin's entry disappears once it is empty
    await press(page.locator("li", { hasText: "UI check task" }).getByText("UI check task"));
    await page.getByLabel("Task name").waitFor({ timeout: 5000 });
    await settle(600);
    await press(page.getByLabel("Delete task"));
    await settle(500);
    await press(bin);
    await settle(1500);
    await binTab.scrollIntoViewIfNeeded();
    await press(binTab);
    await binned.waitFor({ timeout: 5000 });
    await settle(600);
    await press(binned.locator(".confirm-delete"));
    await settle(500);
    await press(binned.locator(".confirm-delete"));
    await settle(1800);
    if (await binned.count()) fail("todos: deleting for good left the task in the bin");
    if (await binTab.count()) fail("todos: the empty bin is still listed");
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
  await step("todo date and repeat", async () => {
    const title = `Water the plants ${profile.name}`;
    const send = (url, method, body) => page.evaluate(([u, m, b]) => fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [url, method, body]);
    const task = await send("/api/v1/todos", "POST", { title, view: "today" });
    await page.reload();
    await settle(1500);
    await press(page.locator(".todo-row", { hasText: title }).getByText(title));
    // the date pill drops a month calendar open in place
    const pill = page.getByRole("button", { name: /^Date:/ });
    await pill.waitFor({ timeout: 5000 });
    if ((await pill.innerText()).trim() !== "Today") fail("todo date: the pill does not say Today for a task on today");
    await press(pill);
    const cal = page.locator("[data-calendar]");
    await cal.waitFor({ timeout: 5000 });
    await settle(500);
    await reachable(cal, "month calendar");
    if (!(await cal.locator("button[aria-pressed=true]").count())) fail("todo date: the task's day is not marked in the calendar");
    if (await cal.getByRole("button", { name: "Previous month" }).isEnabled()) fail("todo date: the calendar steps back into a month that is over");
    await noSidewaysScroll("month calendar");
    await shot("todo-calendar");
    await press(cal.getByRole("button", { name: "Next month" }));
    await press(cal.getByRole("button", { name: "Next month" }));
    await settle(700);
    await press(cal.locator("button:enabled", { hasText: /^17$/ }));
    await settle(900);
    if (await cal.count()) fail("todo date: the calendar stayed open after a day was chosen");
    if (!/17/.test(await pill.innerText())) fail("todo date: the pill does not show the chosen day");
    // a date beyond next week has a list of its own, there only while it holds something
    const later = page.locator("[data-folder=later]");
    await later.waitFor({ timeout: 6000 }).catch(() => fail("todo date: no Later list for a task dated far ahead"));
    // repeating: finishing it adds the next one, counted from today, and says so in place
    await page.getByLabel("Repeat").selectOption("weekly");
    await page.getByText(/a week from that day/).waitFor({ timeout: 5000 });
    await press(page.getByRole("checkbox", { name: "Done" }));
    const note = page.locator("[data-next]");
    await note.waitFor({ timeout: 5000 }).catch(() => fail("todo repeat: nothing says the next task was added"));
    await settle(600);
    await reachable(note.getByRole("button", { name: "Open" }), "open the next task");
    await noSidewaysScroll("todo repeat");
    await shot("todo-repeat-done");
    const done = await send(`/api/v1/todos/${task.id}`, "GET");
    const today = (await send("/api/v1/todos/folders", "GET")).today;
    const want = new Date(Date.parse(today + "T12:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
    if (done.next_date !== want) fail(`todo repeat: the next task is on ${done.next_date}, expected ${want} (a week from the day it was finished, not from its date)`);
    await press(note.getByRole("button", { name: "Open" }));
    await settle(1200);
    if (await page.getByRole("checkbox", { name: "Done" }).getAttribute("aria-checked") !== "false") fail("todo repeat: Open did not show the new, unfinished task");
    if ((await page.getByLabel("Task name").inputValue()) !== title) fail("todo repeat: the next task has a different name");
    await reachable(page.getByRole("button", { name: /^Date:/ }), "date pill on the next task");
    // unticking the first takes the next one away again, so a slip is not doubled
    await send(`/api/v1/todos/${task.id}`, "PATCH", { done: false });
    if ((await send(`/api/v1/todos/${done.next_id}`, "GET")).id) fail("todo repeat: unticking left the next task behind");
    await send(`/api/v1/todos/${task.id}`, "DELETE");
    await send(`/api/v1/todos/${task.id}?forever=1`, "DELETE");
    await page.reload();
    await settle(1500);
  });
  await step("todos hide done", async () => {
    // Finished tasks can be hidden, and the choice is kept on the device. A task ticked while they
    // are hidden stays where it is, shown as done, for three seconds, then goes with the rest.
    const title = `Post the letter ${profile.name}`;
    const send = (url, method, body) => page.evaluate(([u, m, b]) => fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [url, method, body]);
    const task = await send("/api/v1/todos", "POST", { title, view: "today" });
    try {
      await page.reload();
      await settle(1500);
      const row = page.locator(".todo-row", { hasText: title });
      const hide = page.locator("[data-hide-done]");
      await row.waitFor({ timeout: 5000 });
      await reachable(hide, "todos: Hide done");
      if ((await hide.getAttribute("aria-pressed")) !== "false") fail("todos hide done: finished tasks are hidden before it was asked for");
      await press(hide);
      await settle(700);
      if ((await hide.getAttribute("aria-pressed")) !== "true") fail("todos hide done: the control does not say it is on");
      if (await page.locator('.todo-row [role="checkbox"][aria-checked="true"]').count()) fail("todos hide done: a finished task still shows");
      await noSidewaysScroll("todos hide done");
      await shot("todos-hide-done");
      // ticked now, it stays for a moment in its finished state
      await press(row.getByRole("checkbox"));
      await settle(900);
      if (!(await row.count()) || (await row.getByRole("checkbox").getAttribute("aria-checked")) !== "true") fail("todos hide done: a task ticked while done is hidden did not stay, shown as done");
      await settle(3600);
      if (await row.count()) fail("todos hide done: a ticked task is still showing four seconds later");
      // the choice outlasts a reload
      await page.reload();
      await settle(1500);
      if ((await hide.getAttribute("aria-pressed")) !== "true") fail("todos hide done: the choice was not kept over a reload");
      if (await row.count()) fail("todos hide done: a finished task came back after a reload");
      // and it applies to the plan too, which has the same control
      await press(page.getByRole("navigation", { name: "Lists" }).locator("[data-folder=plan]"));
      await settle(800);
      if ((await hide.getAttribute("aria-pressed")) !== "true") fail("todos hide done: the plan does not show the choice");
      await press(page.getByRole("navigation", { name: "Lists" }).getByRole("button", { name: /^Today/ }));
      await settle(800);
      // taken off, the finished task is back
      await press(hide);
      await settle(800);
      if (!(await row.count())) fail("todos hide done: showing finished tasks again did not bring one back");
    } finally {
      await page.evaluate(() => localStorage.removeItem("ss_todo_hide_done"));
      await send(`/api/v1/todos/${task.id}`, "DELETE");
      await send(`/api/v1/todos/${task.id}?forever=1`, "DELETE");
      await page.reload();
      await settle(1500);
    }
  });
  await step("todos plan", async () => {
    // The plan: priorities, their parts and the tasks under each. Nothing is counted, and a
    // line with no tasks is not marked. A task is carried onto a line to become part of it,
    // and any list can be narrowed to a line.
    const nav = page.getByRole("navigation", { name: "Lists" });
    const get = (url) => page.evaluate((u) => fetch(u).then((r) => r.json()), url);
    const del = (url) => page.evaluate((u) => fetch(u, { method: "DELETE" }).then((r) => r.status), url);
    // by its name, which is not text on the page while the line is open (it is a field then)
    const line = (title) => page.locator(`[data-plan-line][data-plan-title=${JSON.stringify(title)}]`);
    const task = (title) => page.locator("[data-plan-task]", { hasText: title });
    // the word itself: the label also holds the (unseen) menu of lists, whose text innerText would add
    const placeOf = (title) => task(title).locator("[data-place]").evaluate((el) => el.firstChild.textContent.trim());
    const planBtn = nav.locator("[data-folder=plan]");
    await planBtn.scrollIntoViewIfNeeded();
    await press(planBtn);
    await page.locator("h1", { hasText: /^Plans$/ }).waitFor({ timeout: 4000 });
    await line("Start the year with a clear plan").waitFor({ timeout: 5000 });
    await settle(800);
    if (/nothing yet/i.test(await line("A budget we both agree on").innerText())) fail("todos plan: a line with no tasks says Nothing yet");
    if (/\d/.test(await page.locator("[data-plan]").innerText())) fail("todos plan: the plan shows a number; it counts nothing");
    // under each priority a plus adds a task; "Part" is offered beside it only on request, so parts never look required
    const plus = (n) => page.getByRole("button", { name: `Add a task to ${n}`, exact: true });
    const partBtn = (n) => page.getByRole("button", { name: `Add a part of ${n}`, exact: true });
    await reachable(plus("Start the year with a clear plan"), "todos plan: the plus under a priority");
    if (await partBtn("Start the year with a clear plan").evaluate((el) => getComputedStyle(el).opacity !== "0")) fail("todos plan: Part shows under a priority before it is asked for");
    await reachable(page.getByLabel("Add a priority"), "todos plan: Add a priority");
    await noSidewaysScroll("todos plan");
    await shot("todos-plan");

    // tapping a line opens its tasks in place, each saying where it sits
    const navLeft = () => nav.evaluate((el) => Math.round(el.getBoundingClientRect().left));
    const gutter = await page.locator("main").evaluate((el) => getComputedStyle(el).scrollbarGutter);
    if (gutter !== "stable") fail(`todos plan: the page keeps no room for its scrollbar (${gutter}), so it moves sideways when a line opens`);
    const leftBefore = await navLeft();
    await press(line("Goals for the first quarter").locator("[aria-expanded]"));
    await task("Draft Q1 goals").waitFor({ timeout: 5000 });
    await settle(500);
    if ((await navLeft()) !== leftBefore) fail(`todos plan: opening a line moved the lists sideways (${leftBefore}px to ${await navLeft()}px)`);
    await reachable(task("Draft Q1 goals").locator("[data-place]"), "todos plan: where a task sits");
    if ((await placeOf("Draft Q1 goals")) !== "This week") fail("todos plan: a task set for the week does not say This week");
    await press(line("Goals for the first quarter").locator("[aria-expanded]"));
    await settle(400);

    // a new priority, a part of it, and a task under the priority: it waits in the backlog
    const name = `Sleep better ${profile.name}`;
    const part = `Evenings ${profile.name}`;
    const title = `Buy blackout blinds ${profile.name}`;
    await typeIn(page.getByLabel("Add a priority"), name);
    await page.keyboard.press("Enter");
    await line(name).waitFor({ timeout: 5000 });
    await settle(600);
    // with a pointer the plus offers "Part" beside it; without one the first tap shows the two
    if (profile.touch) await press(plus(name));
    else await plus(name).hover();
    await settle(500);
    await reachable(partBtn(name), "todos plan: Part beside the plus");
    await shot("todos-plan-add");
    await press(partBtn(name));
    await page.keyboard.type(part, { delay: 15 });
    await page.keyboard.press("Enter");
    await line(part).waitFor({ timeout: 5000 });
    await settle(500);
    // the plus itself adds a task (the second tap, where the first only shows the choices); the priority opens to show it
    if (profile.touch) (await press(plus(name)), await settle(400));
    await press(plus(name));
    await page.keyboard.type(title, { delay: 15 });
    await page.keyboard.press("Enter");
    await task(title).waitFor({ timeout: 5000 });
    await settle(800);
    if ((await placeOf(title)) !== "Backlog") fail("todos plan: a task added under a line is not in the backlog");
    // an open line's name is a field: typed over, it is saved, and the line keeps its tasks
    const nameField = line(name).locator("[data-plan-name]");
    await reachable(nameField, "todos plan: the name of an open line");
    await reachable(line(name).getByRole("button", { name: /^Remove / }), "todos plan: the bin beside an open line's name");
    await nameField.fill(name + " well");
    await page.keyboard.press("Enter");
    await settle(900);
    if (!(await get("/api/v1/plan")).plan.some((i) => i.title === name + " well")) fail("todos plan: a name typed over an open line was not saved");
    await page.locator("[data-plan-name]").first().fill(name);
    await page.keyboard.press("Enter");
    await settle(900);
    if (!(await get("/api/v1/plan")).plan.some((i) => i.title === name)) fail("todos plan: the line's name could not be put back");
    const plan = (await get("/api/v1/plan")).plan;
    const top = plan.find((i) => i.title === name);
    const sub = plan.find((i) => i.title === part);
    if (!top || !sub || sub.parent_id !== top.id) fail("todos plan: the new priority and its part were not saved as one under the other");
    await noSidewaysScroll("todos plan open");
    await shot("todos-plan-open");

    const mid = (loc) => loc.evaluate((e) => ((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left }))(e.getBoundingClientRect()));
    /** Lifts the task and holds it over `target`; `held` runs before it is let go. */
    async function carryTask(target, held) {
      const from = await mid(task(title));
      from.x = from.left + 110;
      const to = await mid(target);
      const at = (i) => [from.x + ((to.x - from.x) * i) / 24, from.y + ((to.y - from.y) * i) / 24];
      let cdp;
      const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
      if (profile.touch) {
        cdp = await page.context().newCDPSession(page);
        await touch("touchStart", from.x, from.y);
        // straight up or down is a scroll until the row has been held
        await page.waitForTimeout(450);
        for (let i = 1; i <= 24; i++) (await touch("touchMove", ...at(i)), await page.waitForTimeout(25));
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let i = 1; i <= 24; i++) (await page.mouse.move(...at(i)), await page.waitForTimeout(20));
      }
      await page.waitForTimeout(400);
      await held();
      if (profile.touch) (await touch("touchEnd", 0, 0), await cdp.detach());
      else await page.mouse.up();
      await settle(1500);
    }

    // carried onto a list in the sidebar, the task takes that list's day and stays part of its line.
    // Both must be on screen at once, which a long plan on a small screen may not allow.
    const todayBtn = nav.locator("[data-folder=today]");
    await task(title).evaluate((e) => e.scrollIntoView({ block: "end" }));
    await settle(500);
    const inView = (loc) => loc.evaluate((e) => ((r) => r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth)(e.getBoundingClientRect()));
    if ((await inView(todayBtn)) && (await inView(task(title)))) {
      await carryTask(todayBtn, async () => {
        if ((await todayBtn.getAttribute("data-over")) !== "true") fail("todos plan: holding a task over a list in the sidebar did not light it");
        await shot("todos-plan-carry-list");
      });
      if (await page.getByLabel("Task name").count()) fail("todos plan: letting go of a task carried to a list opened it");
      if (!(await page.locator("h1", { hasText: /^Plans$/ }).count())) fail("todos plan: carrying a task to a list left the plan");
      const moved = (await get("/api/v1/todos?view=today")).todos.find((t) => t.title === title);
      if (!moved) fail("todos plan: a task dropped on Today in the sidebar was not given today");
      else if (moved.plan_id !== top?.id) fail("todos plan: a task carried to a list is no longer part of its line");
      if ((await placeOf(title)) !== "Today") fail("todos plan: a task carried to Today does not say Today under its line");
      // back to the backlog by the word at its end, for the steps that follow
      await task(title).locator("[data-place] select").selectOption("backlog");
      await settle(1500);
      if ((await placeOf(title)) !== "Backlog") fail("todos plan: the word at a task's end did not send it back to the backlog");
    } else console.log(`  (${profile.name}: the sidebar and the task do not fit on screen together; carrying to a list not tried)`);

    // carried onto another line, the task becomes part of that line
    await carryTask(line(part), async () => {
      if ((await line(part).getAttribute("data-over")) !== "true") fail("todos plan: holding a task over another line did not light it");
      await shot("todos-plan-carry");
    });
    if (await page.getByLabel("Task name").count()) fail("todos plan: letting go of a carried task opened it");
    const made = (await get("/api/v1/todos?view=backlog")).todos.find((t) => t.title === title);
    if (!made) fail("todos plan: the task added under a line is not in the backlog");
    else if (made.plan_id !== sub?.id) fail("todos plan: a task dropped on another line did not become part of it");

    // in its list the task names its line, and the list can be narrowed to the priority (parts included)
    const backlog = nav.getByRole("button", { name: /^Backlog/ });
    await backlog.scrollIntoViewIfNeeded();
    await press(backlog);
    await page.locator(".todo-row", { hasText: title }).waitFor({ timeout: 5000 });
    await settle(800);
    if (!(await page.locator(".todo-row", { hasText: title }).locator("[data-part-of]", { hasText: "Evenings" }).count())) fail("todos plan: a task does not name the line it is part of in its list");
    const filter = page.locator("[data-plan-filter]");
    await reachable(filter, "todos priority filter");
    await press(filter);
    const menuEl = page.getByRole("menu", { name: "Priority" });
    await menuEl.waitFor({ timeout: 4000 });
    await settle(400);
    await reachable(menuEl.getByRole("menuitemradio", { name }), "priority filter choice");
    await noSidewaysScroll("todos priority menu");
    await shot("todos-plan-filter");
    await press(menuEl.getByRole("menuitemradio", { name }));
    await settle(800);
    const shown = await page.locator("main ul li").evaluateAll((els) => els.map((e) => e.innerText.trim().split("\n")[0]));
    if (shown.join("|") !== title) fail(`todos plan: narrowed to a priority, the list shows ${JSON.stringify(shown)}`);
    if ((await filter.getAttribute("aria-label")) !== `Priority: ${name}`) fail("todos plan: the filter does not name the chosen line");
    await press(filter);
    await press(menuEl.getByRole("menuitem", { name: "Show all" }));
    await settle(600);
    if ((await filter.getAttribute("aria-label")) !== "Filter by priority") fail("todos plan: Show all did not take the choice off");

    // opened, the task says what it is part of, and that can be changed there
    await press(page.locator(".todo-row", { hasText: title }).getByText(title));
    const partOf = page.locator("label[data-part-of]");
    await partOf.waitFor({ timeout: 5000 });
    await settle(600);
    await reachable(partOf, "todo Part of pill");
    if (!(await partOf.innerText()).includes("Evenings")) fail("todos plan: an open task does not say what it is part of");
    await partOf.locator("select").selectOption({ label: name });
    await settle(900);
    if ((await get(`/api/v1/todos?view=backlog`)).todos.find((t) => t.title === title)?.plan_id !== top?.id) fail("todos plan: choosing another line in a task did not save");
    await shot("todos-plan-task");
    await press(page.getByRole("button", { name: "Backlog" }).first());
    await settle(600);

    // tidy up: the task (twice: to the bin, then for good) and the priority, which takes its part with it
    if (made) (await del(`/api/v1/todos/${made.id}`), await del(`/api/v1/todos/${made.id}?forever=1`));
    if (top) await del(`/api/v1/plan/${top.id}`);
    if ((await get("/api/v1/plan")).plan.some((i) => i.title === name || i.title === part)) fail("todos plan: removing a priority left it, or its part, in the plan");
    await page.reload();
    await settle(1500);
  });
  await step("todos all and tags", async () => {
    // "All" shows every task under the day or list it is on; any list with tagged tasks can be narrowed to tags.
    const nav = page.getByRole("navigation", { name: "Lists" });
    const get = (url) => page.evaluate((u) => fetch(u).then((r) => r.json()), url);
    const filter = page.locator("[data-tag-filter]");
    const titles = () => page.locator("main ul li").evaluateAll((els) => els.map((e) => e.innerText.trim().split("\n")[0]));
    const allBtn = nav.locator("[data-folder=all]");
    await allBtn.scrollIntoViewIfNeeded();
    await press(allBtn);
    await page.locator("h1", { hasText: /^All$/ }).waitFor({ timeout: 4000 });
    await settle(1200);
    const every = (await get("/api/v1/todos?view=all")).todos;
    const shownAll = await titles();
    for (const t of every) if (!shownAll.includes(t.title)) fail(`todos all: "${t.title}" is missing from All`);
    const heads = await page.locator("[data-group] h2").evaluateAll((els) => els.map((e) => e.textContent.trim()));
    if (heads[0] !== "Today") fail(`todos all: the first section is "${heads[0]}", expected Today`);
    if (heads.indexOf("Backlog") !== heads.length - 1) fail(`todos all: Backlog is not the last section (${heads.join(", ")})`);
    if (await page.getByRole("button", { name: "Add task", exact: true }).count()) fail("todos all: a list with sections has one add button for the whole list");
    await reachable(page.getByRole("button", { name: "Add task to Today" }), "todos all: Today's add button");
    // a tagged task carries its tag at the end of its row
    if (!(await page.locator(".todo-row", { hasText: "Replace the hallway light" }).locator("[data-tags]", { hasText: "house" }).count())) fail("todos tags: a tagged task does not show its tag in the list");
    await noSidewaysScroll("todos all");
    await shot("todos-all");

    // the filter sits quietly at the right of the heading and opens the tags to choose from
    await reachable(filter, "todos tag filter");
    const side = await filter.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const h = el.closest("header").getBoundingClientRect();
      return { gap: h.right - r.right, left: r.left - h.left, width: h.width };
    });
    if (side.gap > 12 || side.left < side.width / 2) fail("todos tags: the tag filter is not at the right of the heading");
    await press(filter);
    const tagMenu = page.getByRole("menu", { name: "Tags" });
    await tagMenu.waitFor({ timeout: 4000 });
    await settle(500);
    for (const t of ["finance", "house"]) await reachable(tagMenu.getByRole("menuitemcheckbox", { name: new RegExp("^" + t) }), `tag filter choice "${t}"`);
    await noSidewaysScroll("todos tag menu");
    await shot("todos-tag-menu");
    await press(tagMenu.getByRole("menuitemcheckbox", { name: /^house/ }));
    await settle(800);
    const house = every.filter((t) => t.tags.includes("house")).map((t) => t.title);
    let now = await titles();
    if (now.slice().sort().join("|") !== house.slice().sort().join("|")) fail(`todos tags: narrowed to house, the list shows ${now.join(", ") || "nothing"}`);
    // a second tag narrows it further: only tasks carrying both
    await press(tagMenu.getByRole("menuitemcheckbox", { name: /^diy/ }));
    await settle(800);
    now = await titles();
    const both = every.filter((t) => t.tags.includes("house") && t.tags.includes("diy")).map((t) => t.title);
    if (!both.length || both.length === house.length) fail("todos tags: the seeded tasks do not tell one tag from two");
    if (now.slice().sort().join("|") !== both.slice().sort().join("|")) fail(`todos tags: narrowed to house and diy, the list shows ${now.join(", ") || "nothing"}, expected ${both.join(", ")}`);
    // tags that no task carries together leave nothing, and the list says what it is narrowed to
    await press(tagMenu.getByRole("menuitemcheckbox", { name: /^finance/ }));
    await settle(800);
    if ((await titles()).length) fail("todos tags: tasks are shown that do not carry every chosen tag");
    await page.getByText("Nothing tagged house and diy and finance here.").waitFor({ timeout: 3000 }).catch(() => fail("todos tags: an empty narrowed list does not say what it is narrowed to"));
    await press(tagMenu.getByRole("menuitemcheckbox", { name: /^finance/ }));
    await settle(800);
    await page.keyboard.press("Escape");
    await settle(500);
    if (await tagMenu.count()) fail("todos tags: the tag menu stayed open after Escape");
    if (!/house/.test(await filter.innerText()) || !/diy/.test(await filter.innerText())) fail("todos tags: the filter does not name the chosen tags");
    await noSidewaysScroll("todos all, narrowed");
    await shot("todos-all-tagged");
    // "Show all" takes the choice off again
    await press(filter);
    await press(tagMenu.getByRole("menuitem", { name: "Show all" }));
    await settle(800);
    if ((await titles()).length !== shownAll.length) fail("todos tags: Show all did not bring every task back");
    // a choice stays until it is taken off: on another list, and after a visit to another screen
    await press(filter);
    await press(tagMenu.getByRole("menuitemcheckbox", { name: /^house/ }));
    await page.keyboard.press("Escape");
    const todayBtn = nav.getByRole("button", { name: /^Today/ });
    await todayBtn.scrollIntoViewIfNeeded();
    await press(todayBtn);
    await settle(1000);
    if ((await filter.getAttribute("aria-label")) !== "Tags: house") fail("todos tags: the chosen tag did not follow to another list");
    await page.goto(BASE + "/feed");
    await settle(1200);
    await page.goto(BASE + "/todos");
    await filter.waitFor({ timeout: 8000 }).catch(() => {});
    await settle(800);
    if ((await filter.getAttribute("aria-label").catch(() => null)) !== "Tags: house") fail("todos tags: the chosen tag was lost on leaving Todos and coming back");
    await shot("todos-tag-kept");
    await press(filter);
    await press(tagMenu.getByRole("menuitem", { name: "Show all" }));
    await settle(600);
    if ((await filter.count()) && (await filter.getAttribute("aria-label")) !== "Filter by tag") fail("todos tags: Show all did not take the kept choice off");
    // and a list with no tagged tasks offers no filter
    for (const f of (await get("/api/v1/todos/folders")).folders) {
      if (f.key === "all" || f.guest) continue;
      if ((await get(`/api/v1/todos?view=${f.key}`)).todos.some((t) => t.tags.length)) continue;
      const b = nav.locator(`[data-folder="${f.key}"]`);
      await b.scrollIntoViewIfNeeded();
      await press(b);
      await settle(1000);
      if (await filter.count()) fail(`todos tags: "${f.label}" has no tagged tasks but offers a tag filter`);
      break;
    }

    // in a task, "Add tag" follows the repeat pill; a tag is added, shown, saved, and taken off again
    const backlog = nav.getByRole("button", { name: /^Backlog/ });
    await backlog.scrollIntoViewIfNeeded();
    await press(backlog);
    await settle(1000);
    await press(page.locator(".todo-row", { hasText: "Replace the hallway light" }).getByText("Replace the hallway light"));
    const addTag = page.getByRole("button", { name: "Add tag" });
    await addTag.waitFor({ timeout: 5000 });
    await settle(700);
    await reachable(addTag, "todo add tag button");
    const after = await addTag.evaluate((el) => !!(document.querySelector('select[aria-label="Repeat"]').compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (!after) fail("todo tags: Add tag does not follow the repeat pill");
    await reachable(page.locator('[data-tag="house"]'), "todo tag chip");
    await press(addTag);
    await settle(300);
    await reachable(page.getByLabel("New tag"), "todo new tag field");
    await page.keyboard.type("Check tag", { delay: 15 });
    await page.keyboard.press("Enter");
    await page.locator('[data-tag="Check tag"]').waitFor({ timeout: 3000 });
    await page.keyboard.press("Escape");
    await settle(900);
    const lamp = every.find((t) => t.title === "Replace the hallway light");
    if (!(await get(`/api/v1/todos/${lamp.id}`)).tags.includes("Check tag")) fail("todo tags: a tag added to a task was not saved");
    await noSidewaysScroll("todo tags");
    await shot("todo-tags");
    await reachable(page.getByLabel("Remove tag Check tag"), "todo remove tag button");
    await press(page.getByLabel("Remove tag Check tag"));
    await page.locator('[data-tag="Check tag"]').waitFor({ state: "detached", timeout: 3000 });
    await settle(900);
    if ((await get(`/api/v1/todos/${lamp.id}`)).tags.includes("Check tag")) fail("todo tags: a tag taken off a task was not removed");
    await page.goto(`${BASE}/todos`);
    await settle(1500);
  });
  await step("follow-up from the rail", async () => {
    // What an agent needs from the owner is a rail module pointing at a task. Its one button opens the
    // task, and that clears the module; the task stays in the list.
    const get = (url) => page.evaluate((u) => fetch(u).then((r) => r.json()), url);
    const before = (await get("/api/v1/rail")).modules.find((m) => m.key === "agility-topup");
    if (!before) return fail("follow-up: the seeded follow-up is not in the rail");
    if (!before.task) fail("follow-up: the module does not point at its task");
    if (!wide) (await press(page.getByRole("button", { name: /^Now/ })), await settle(800));
    const mod = page.locator('[data-rail-module="agility-topup"]');
    await mod.waitFor({ timeout: 6000 });
    // no need to open the module first: what to do is on its face
    const open = mod.getByRole("link", { name: "Open task" });
    await reachable(open, "rail follow-up: Open task");
    await noSidewaysScroll("rail follow-up");
    await shot("rail-follow-up");
    // this screen is already Todos: the link must still open the task
    await press(open);
    await page.getByLabel("Task name").waitFor({ timeout: 6000 }).catch(() => fail("follow-up: Open task did not open the task"));
    await settle(1800);
    if ((await page.getByLabel("Task name").inputValue()) !== before.task.title) fail("follow-up: Open task showed a different task");
    if (!wide && (await page.locator('aside[aria-label="Now"]').count())) fail("follow-up: the rail sheet stayed open over the task");
    if (await mod.count()) fail("follow-up: the module is still in the rail after its task was opened");
    if ((await get("/api/v1/rail")).modules.some((m) => m.key === "agility-topup")) fail("follow-up: opening the task did not clear its module");
    if ((await get(`/api/v1/todos/${before.task.id}`)).done !== false) fail("follow-up: the task did not stay in the list once its module had gone");
    // the task (seeded for next week) opens in its own list: the list behind it is Next week, and so is its back button
    if (!(await page.locator('[data-folder="next_week"] .glass').count())) fail("follow-up: a task opened from the rail did not bring up the list it is in (Next week)");
    if (!(await page.getByRole("button", { name: "Next week", exact: true }).count())) fail("follow-up: the task's back button does not name the list it is in");
    await reachable(page.locator('[data-tag="finance"]'), "the follow-up task's tag");
    await noSidewaysScroll("follow-up task");
    await shot("todo-follow-up");
    await page.goto(`${BASE}/todos`);
    await settle(1500);
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
  await step("ideas", async () => {
    // Ideas: each idea is a canvas. The owner's words sit bare on it; what agents add are rounded pieces joined to what they grew from.
    const get = (url) => page.evaluate((u) => fetch(u).then((r) => r.json()), url);
    const send = (method, url, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined }).then((r) => r.status), [method, url, body]);
    await press(page.getByRole("link", { name: "Ideas", exact: true }));
    await page.waitForURL("**/ideas");
    await settle(1200);
    const card = page.locator("[data-idea]", { hasText: "A cargo trailer for the bike" });
    await reachable(card, "ideas: the seeded idea");
    await reachable(page.getByRole("button", { name: "New idea" }), "ideas: New idea");
    if (!(await card.locator("[data-ripe]").count())) fail("ideas: an idea that is ready to act on does not say so on its card");
    await noSidewaysScroll("ideas");
    await shot("ideas");
    await press(card);
    const canvas = page.locator("[data-canvas]");
    await canvas.waitFor({ timeout: 8000 });
    await settle(1500);
    const pieces = canvas.locator("[data-piece]");
    if ((await pieces.count()) !== 4) fail(`ideas: ${await pieces.count()} pieces on the seeded canvas, expected 4`);
    const mine = canvas.locator('[data-piece][data-by="owner"]', { hasText: "A cargo trailer for the bike" });
    const riff = canvas.locator('[data-piece][data-by="agent"]', { hasText: "folded flat" });
    const found = canvas.locator('[data-piece][data-by="agent"]', { hasText: "Burley" });
    await reachable(mine, "ideas: the owner's own words on the canvas");
    await reachable(riff, "ideas: an agent's piece");
    await reachable(found, "ideas: a second agent's piece");
    if (!/Scout/.test(await riff.innerText())) fail("ideas: an agent's piece does not say whose it is");
    if ((await riff.getAttribute("data-kept")) !== "true") fail("ideas: a kept piece is not marked as kept");
    if ((await canvas.locator("[data-join]").count()) !== 3) fail(`ideas: ${await canvas.locator("[data-join]").count()} joins drawn, expected 3`);
    // nothing on the canvas overlaps anything else when it is first shown
    const boxes = await pieces.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxes[i].l < boxes[j].r - 4 && boxes[j].l < boxes[i].r - 4 && boxes[i].t < boxes[j].b - 4 && boxes[j].t < boxes[i].b - 4) fail("ideas: two pieces overlap on the seeded canvas");
    // Under its name the idea says what stands: that an agent thinks it is ready, with the first step, and which idea it is near.
    const ideaId = await canvas.getAttribute("data-canvas");
    const life = canvas.locator("[data-idea-life]");
    const ripe = life.locator("[data-ripe]");
    await reachable(ripe.getByRole("button", { name: "Make a task" }), "ideas: Make a task, on an idea that is ready");
    await reachable(ripe.getByRole("button", { name: "Not yet" }), "ideas: Not yet");
    const ripeSays = await ripe.innerText().catch(() => "");
    if (!/Scout thinks this is ready/.test(ripeSays) || !/Measure the garage wall/.test(ripeSays)) fail(`ideas: the ready note does not say who thinks so and what the first step is: "${ripeSays}"`);
    const near = life.locator("[data-near]");
    await reachable(near.getByRole("button", { name: /^Near/ }), "ideas: the idea this one is near");
    await reachable(near.getByRole("button", { name: /^Not related/ }), "ideas: Not related, on a near idea");
    // on a phone these take the top of the screen, and the pieces are framed beneath them
    const lifeBox = await life.boundingBox();
    const narrow = (await canvas.boundingBox()).width < 500;
    if (narrow && lifeBox && boxes.some((b) => b.l < lifeBox.x + lifeBox.width - 4 && lifeBox.x < b.r - 4 && b.t < lifeBox.y + lifeBox.height - 4 && lifeBox.y < b.b - 4)) fail("ideas: what the idea says under its name covers a piece when the canvas is first shown");
    await noSidewaysScroll("idea canvas");
    await shot("idea-canvas");
    // double-tap empty space and write: the words go down where the tap was
    const area = await canvas.boundingBox();
    await page.mouse.dblclick(area.x + area.width / 2, area.y + area.height - 96);
    const writing = page.getByLabel("Write on the canvas");
    await writing.waitFor({ timeout: 4000 }).catch(() => fail("ideas: double-tapping the canvas did not open a place to write"));
    if (await writing.count()) {
      await settle(200);
      await page.keyboard.type("Ride it to the beach", { delay: 12 });
      await page.keyboard.press("Enter");
      await canvas.locator('[data-piece][data-by="owner"]', { hasText: "Ride it to the beach" }).waitFor({ timeout: 6000 }).catch(() => fail("ideas: what was written did not appear on the canvas"));
    }
    // a chosen piece offers keep, more and prune; keeping marks it, pruning takes it away and can be undone
    await found.click();
    const acts = page.locator("[data-piece-actions]");
    await reachable(acts.getByRole("button", { name: /^Keep/ }), "ideas: Keep, on a chosen piece");
    await reachable(acts.getByRole("button", { name: "More of this" }), "ideas: More of this");
    await reachable(acts.getByRole("button", { name: /^Prune/ }), "ideas: Prune");
    await acts.getByRole("button", { name: /^Keep/ }).click();
    await settle(900);
    if ((await found.getAttribute("data-kept")) !== "true") fail("ideas: Keep did not mark the piece");
    await shot("idea-piece-chosen");
    await acts.getByRole("button", { name: /^Kept/ }).click();
    await settle(700);
    await acts.getByRole("button", { name: /^Prune/ }).click();
    await found.waitFor({ state: "detached", timeout: 5000 }).catch(() => fail("ideas: a pruned piece is still on the canvas"));
    await reachable(page.getByRole("button", { name: "Bring back" }), "ideas: Bring back, after pruning");
    await page.getByRole("button", { name: "Bring back" }).click();
    await found.waitFor({ timeout: 6000 }).catch(() => fail("ideas: Bring back did not return the pruned piece"));
    // One tap makes the idea a task: the step is its title, what was kept is in its notes, and the idea shows the task in the step's place.
    const readyBefore = (await get(`/api/v1/ideas/${ideaId}`)).ripe;
    await press(ripe.getByRole("button", { name: "Make a task" }));
    const made = life.locator("[data-idea-task]");
    await made.waitFor({ timeout: 6000 }).catch(() => fail("ideas: Make a task did not show the task on the canvas"));
    await ripe.waitFor({ state: "detached", timeout: 4000 }).catch(() => fail("ideas: the ready note is still there after the task was made"));
    const withTask = await get(`/api/v1/ideas/${ideaId}`);
    if (withTask.task?.title !== "Measure the garage wall for a fold-flat trailer") fail(`ideas: the task made of the idea is "${withTask.task?.title}", not its first step`);
    if (withTask.task) {
      const notes = (await get(`/api/v1/todos/${withTask.task.id}`)).notes ?? "";
      if (!notes.includes(`/ideas?idea=${ideaId}`) || !/folded flat/.test(notes)) fail("ideas: the task's notes do not lead back to the idea with what was kept");
    }
    await reachable(made, "ideas: the task made of the idea");
    await shot("idea-task-made");
    // the way across to the idea it is near, and back again
    await press(near.getByRole("button", { name: /^Near/ }));
    await page.waitForURL((u) => u.search.includes("idea=") && !u.search.includes(ideaId), { timeout: 6000 }).catch(() => fail("ideas: tapping a near idea did not open it"));
    await page.locator("[data-piece]", { hasText: "A bench under the window" }).waitFor({ timeout: 6000 }).catch(() => fail("ideas: the near idea's canvas did not show"));
    const back = page.locator("[data-near]").getByRole("button", { name: /^Near/ });
    await reachable(back, "ideas: the way back from the near idea");
    if (!/A cargo trailer/.test(await back.innerText().catch(() => ""))) fail("ideas: the near idea does not name the idea it came from");
    await press(back);
    await page.waitForURL((u) => u.search.includes(ideaId), { timeout: 6000 }).catch(() => fail("ideas: the way back from a near idea did not return"));
    await canvas.locator("[data-piece]").first().waitFor({ timeout: 6000 });
    // put back as it was seeded, for the next screen size
    // (a task is binned first, and only then removed for good)
    if (withTask.task) {
      await send("DELETE", `/api/v1/todos/${withTask.task.id}`);
      await send("DELETE", `/api/v1/todos/${withTask.task.id}?forever=1`);
    }
    if (process.env.DATABASE_URL && readyBefore) {
      const { Client } = require("pg");
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      await db.query("UPDATE ideas SET task_id = NULL, ripe = $2::jsonb WHERE id = $1", [ideaId, JSON.stringify({ ...readyBefore, at: new Date().toISOString() })]);
      await db.end();
    }
    const now = await get(`/api/v1/ideas/${ideaId}`);
    for (const it of now.items.filter((x) => x.text === "Ride it to the beach")) await send("DELETE", `/api/v1/idea-items/${it.id}`);
    for (const it of now.items.filter((x) => /Burley/.test(x.text) && x.kept)) await send("PATCH", `/api/v1/idea-items/${it.id}`, { kept: false });
    await press(page.getByRole("button", { name: "All ideas" }));
    await page.waitForURL((u) => !u.search.includes("idea="));
    await settle(600);
  });

  await step("current", async () => {
    // What is true for now sits at the top of Context: each note with who set it and until when.
    await page.goto(`${BASE}/context`);
    await settle(1200);
    const shelf = page.locator("[data-current]");
    await reachable(shelf.getByRole("button", { name: /This month's focus/ }), "current: a note that holds for now");
    const labels = await shelf.locator("[data-current-note]").allInnerTexts();
    if (labels.length !== 2 || !labels.every((t) => /until (\d+ \w+|\w+ \d+)/.test(t))) fail(`current: each note should say until when (${labels.map((t) => t.replace(/\s+/g, " ")).join(" | ")})`);
    if (!/Scout/.test(labels.find((t) => t.includes("This month's focus")) ?? "")) fail("current: a note does not say who set it");
    await noSidewaysScroll("current");
    await shot("context-current");
    // opened, a current note offers its end day, which the owner can move or take off
    await press(shelf.getByRole("button", { name: /Portland trip/ }));
    await page.getByLabel("Title").waitFor({ timeout: 5000 });
    await settle(700);
    const until = page.locator("[data-until]");
    await reachable(until.getByRole("button", { name: /^Date: Until / }), "current: the end day on a note");
    await reachable(until.getByRole("button", { name: "Take the end day off" }), "current: taking the end day off");
    await shot("context-current-note");
  });

  await step("house rules", async () => {
    // System holds the house rules. What an agent has proposed waits at the top of Context and inside System.
    const get = (url) => page.evaluate((u) => fetch(u).then((r) => r.json()), url);
    await page.goto(`${BASE}/context`);
    await settle(1200);
    const waiting = page.locator("[data-proposals]");
    await reachable(waiting.getByText("Scout proposes a change to “Quiet hours”"), "house rules: who proposes what");
    await reachable(waiting.getByText("You dismissed every Saturday morning module this month."), "house rules: why");
    await reachable(waiting.getByText("Adds: At weekends nothing is raised before 10 am."), "house rules: the change");
    await reachable(waiting.getByRole("button", { name: "Approve" }), "house rules: Approve");
    await reachable(waiting.getByRole("button", { name: "Decline" }), "house rules: Decline");
    await noSidewaysScroll("house rules proposal");
    await shot("house-rules-proposal");
    const before = (await get("/api/v1/rules/proposals")).proposals;
    if (before.length !== 1) fail(`house rules: ${before.length} proposals waiting, expected the seeded one`);
    await press(page.locator("main button", { hasText: "House rules: how agents work here" }).first());
    await settle(900);
    await reachable(page.locator("main button", { hasText: "Quiet hours" }).first(), "house rules: a rule inside System");
    if (!(await waiting.count())) fail("house rules: the waiting proposal is not shown inside System");
    await shot("house-rules");
    // approving applies the change exactly as proposed, under the agent's name, and the proposal is gone
    await press(waiting.getByRole("button", { name: "Approve" }));
    await waiting.waitFor({ state: "detached", timeout: 6000 }).catch(() => fail("house rules: an approved proposal is still waiting"));
    const rule = (await get(`/api/v1/context?node=${before[0]?.node_id}`)).node;
    if (!/At weekends nothing is raised before 10 am\./.test(rule?.body ?? "")) fail("house rules: approving did not apply the change");
    // put back, so every screen size meets the same proposal
    if (process.env.DATABASE_URL && before[0]) {
      const { Client } = require("pg");
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      await db.query("UPDATE rule_proposals SET status = 'pending', decided_at = NULL WHERE id = $1", [before[0].id]);
      await db.query("UPDATE context_nodes SET body = replace(body, E'\\n\\n- At weekends nothing is raised before 10 am.', '') WHERE id = $1", [before[0].node_id]);
      await db.end();
    }
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

  // ---------- Journal ----------
  await step("journal", async () => {
    await press(page.getByRole("link", { name: "Journal", exact: true }));
    await page.waitForURL("**/journal");
    await settle(1200);
    await noSidewaysScroll("journal");
    await shot("journal");
    // arranged by time: a section per month, newest first, each day named once
    const months = await page.locator("main section h2").allInnerTexts();
    if (months.length < 2) fail(`journal: expected entries under at least two months, found ${months.length}`);
    const days = await page.locator("[data-entry]").evaluateAll((rows) => rows.map((r) => r.querySelector("span")?.getAttribute("aria-label")).filter(Boolean));
    if (new Set(days).size !== days.length) fail(`journal: a day is named more than once (${days.join(", ")})`);
    const row = page.locator("[data-entry]", { hasText: "Sketching again" });
    await reachable(row, "journal entry row");
    if (!(await row.innerText()).includes("Creativity")) fail("journal: the sketching entry does not show its Creativity tag");
    // each entry is a card showing every picture in it, none cropped: a tall one stays tall, a wide one wide
    await row.locator("img").first().evaluate((i) => i.decode().catch(() => {}));
    const shapes = await row.locator("img").evaluateAll((imgs) => imgs.map((i) => ({ natural: i.naturalWidth / i.naturalHeight, shown: i.getBoundingClientRect().width / i.getBoundingClientRect().height })));
    if (shapes.length !== 2) fail(`journal: the card for an entry with two pictures shows ${shapes.length}`);
    for (const s of shapes) if (!s.natural || Math.abs(s.shown - s.natural) > 0.04) fail(`journal: a picture in a card is not shown at its own shape (${s.shown.toFixed(2)} instead of ${s.natural.toFixed(2)})`);
    await reachable(row.locator("img").first(), "journal picture in a card");
    // from far away: each month says how it felt, each entry carries its mood and its gist
    const glance = page.locator("[data-month-glance]").first();
    await reachable(glance, "journal month at a glance");
    if (!/Mostly \w+/.test(await glance.innerText())) fail("journal: the month does not name its prevailing mood");
    if (!(await page.locator("[data-entry] [data-mood]").count())) fail("journal: no entry shows a mood");

    // a tag narrows the list to its entries, and lets go again
    const chips = page.getByRole("group", { name: "Tags" });
    const chip = chips.getByRole("button", { name: /^Life lessons/ });
    await reachable(chip, "journal tag chip");
    await press(chip);
    await page.locator("[data-entry]", { hasText: "Sketching again" }).waitFor({ state: "detached", timeout: 5000 }).catch(() => fail("journal: choosing a tag did not narrow the list"));
    await reachable(page.locator("[data-entry]", { hasText: "A lesson from the roof" }), "journal entry under its tag");
    await shot("journal-tag");
    await press(chips.getByRole("button", { name: /^Life lessons/ }));
    await page.locator("[data-entry]", { hasText: "Sketching again" }).waitFor({ timeout: 5000 });

    // an entry with a link in it shows the link as a preview
    await press(page.locator("[data-entry]", { hasText: "What the agents are for" }));
    await page.getByLabel("Title").waitFor({ timeout: 5000 });
    await settle(900);
    await reachable(page.locator(".page-block a", { hasText: "The case for slow interfaces" }), "journal link preview");
    await noSidewaysScroll("journal entry");
    await shot("journal-entry");
    await press(page.getByRole("button", { name: "Journal", exact: true }));
    await settle(700);

    // write one: the title, then the text; its tags arrive on their own a moment after writing stops
    await press(page.getByRole("button", { name: "New entry" }));
    await page.getByLabel("Title").waitFor({ timeout: 5000 });
    await settle(700);
    await page.keyboard.type("Check entry", { delay: 15 });
    await page.keyboard.press("Enter");
    await settle(300);
    await page.keyboard.type("Thinking about how AI models and prompts change the way agents work for me.", { delay: 8 });
    await page.locator('[data-tag="AI"]').waitFor({ timeout: 10000 }).catch(() => fail("journal: a new entry about AI was not tagged AI on its own"));
    await page.getByText("Tagged for you").waitFor({ timeout: 3000 }).catch(() => fail("journal: tags chosen by the app are not marked as such"));
    await page.locator("[data-gist]").waitFor({ timeout: 3000 }).catch(() => fail("journal: the entry was not given its gist"));
    // the mood is the app's reading until the owner says otherwise
    const moodPill = page.locator("label[data-mood]");
    await reachable(moodPill, "journal mood pill");
    if (!(await moodPill.getAttribute("data-mood"))) fail("journal: the entry was not given a mood");
    await page.getByLabel("Mood").selectOption("Hopeful");
    await page.locator('label[data-mood="Hopeful"]').waitFor({ timeout: 3000 }).catch(() => fail("journal: choosing a mood did not show it"));

    // embed a link with the button
    await reachable(page.getByLabel("Add a link"), "journal add a link button");
    await press(page.getByLabel("Add a link"));
    const field = page.getByLabel("Link to embed");
    await field.waitFor({ timeout: 3000 });
    await settle(300);
    await reachable(field, "journal link field");
    await page.keyboard.type("https://example.com/heat-pump-guide", { delay: 8 });
    await page.keyboard.press("Enter");
    await page.locator('.page-block a[href="https://example.com/heat-pump-guide"]').waitFor({ timeout: 10000 }).catch(() => fail("journal: the link was not embedded as a preview"));
    // and by pasting an address on a line of its own
    await press(page.locator(".ProseMirror > p").last());
    await settle(300);
    await page.locator(".ProseMirror").evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "https://example.com/slow-interfaces");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await page.locator('.page-block a[href="https://example.com/slow-interfaces"]').waitFor({ timeout: 10000 }).catch(() => fail("journal: a pasted address did not become a preview"));
    // a picture pasted in is uploaded and shown in place
    await press(page.locator(".ProseMirror > p").last());
    await settle(300);
    await page.locator(".ProseMirror").evaluate((el) => {
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFklEQVR4nGP8z8Dwn4EIwESMolGF+AEAr1YCDmxPhzQAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([png], "pasted.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await page.locator('.ProseMirror img[src^="/api/media/"]').waitFor({ timeout: 10000 }).catch(() => fail("journal: a pasted picture was not added to the entry"));
    await settle(600);
    await noSidewaysScroll("journal new entry");

    // any day can be chosen, also one gone by
    await press(page.getByLabel(/^Date:/));
    const cal = page.locator("[data-calendar]");
    await reachable(cal, "journal calendar");
    if (await cal.getByLabel("Previous month").isDisabled()) fail("journal: an entry cannot be moved to an earlier month");
    await shot("journal-date");
    await page.keyboard.press("Escape");
    await settle(300);

    // a tag of the owner's own; after that the app stops choosing
    await press(page.getByRole("button", { name: "Tag", exact: true }));
    await settle(200);
    await reachable(page.getByLabel("New tag"), "journal new tag field");
    await page.keyboard.type("Check tag", { delay: 15 });
    await page.keyboard.press("Enter");
    await page.locator('[data-tag="Check tag"]').waitFor({ timeout: 3000 });
    await page.keyboard.press("Escape");
    await settle(900);
    if (await page.getByText("Tagged for you").count()) fail("journal: tags the owner changed still read as chosen by the app");
    await reachable(page.getByLabel("Remove tag Check tag"), "journal remove tag button");
    await shot("journal-new");
    await press(page.getByLabel("Remove tag Check tag"));
    await page.locator('[data-tag="Check tag"]').waitFor({ state: "detached", timeout: 3000 });
    await settle(900);

    // it is in the list under today, and can be deleted
    await press(page.getByRole("button", { name: "Journal", exact: true }));
    const mine = page.locator("[data-entry]", { hasText: "Check entry" });
    await mine.first().waitFor({ timeout: 5000 });
    if (!(await mine.first().innerText()).includes("AI")) fail("journal: the new entry lost its tag in the list");
    if (!(await mine.first().innerText()).includes("Hopeful")) fail("journal: the mood the owner chose is not in the list");
    if (!(await mine.first().locator("img").count())) fail("journal: an entry with a picture shows no thumbnail in the list");
    await shot("journal-after");
    await press(mine.first());
    await page.getByLabel("Title").waitFor({ timeout: 5000 });
    await settle(600);
    const bin = page.locator("main .confirm-delete");
    await reachable(bin, "journal delete button");
    await press(bin);
    await settle(400);
    if ((await bin.getAttribute("data-armed")) !== "true") fail("journal: the delete control did not ask for confirmation");
    await press(bin);
    await page.locator("[data-entry]", { hasText: "Sketching again" }).waitFor({ timeout: 5000 });
    if (await page.locator("[data-entry]", { hasText: "Check entry" }).count()) fail("journal: a deleted entry is still listed");
  });

  // ---------- Saved links ----------
  await step("links", async () => {
    await page.goto(`${BASE}/context`);
    await settle(1200);
    const pill = page.getByRole("button", { name: "Links", exact: true });
    await reachable(pill, "links button");
    await reachable(page.getByLabel("Search context"), "context search beside the links button");
    await press(pill);
    await page.waitForURL("**/context?view=links");
    const row = (name) => page.locator("[data-link]", { hasText: name });
    await row("The case for slow interfaces").waitFor({ timeout: 6000 });
    await settle(700);
    // a row shows the title, the reason and the site, and is itself the link
    const slow = row("The case for slow interfaces");
    await reachable(slow.getByText("Good argument for calm UI"), "link reason");
    await reachable(slow.getByText(/Works in Progress/), "link site");
    const href = await slow.getByRole("link").getAttribute("href");
    const target = await slow.getByRole("link").getAttribute("target");
    if (href !== "https://example.com/slow-interfaces" || target !== "_blank") fail(`links: row does not open the page in a new tab (href ${href}, target ${target})`);
    // a link filed under an area says where it is; one with no reason falls back to what the page is
    await reachable(row("Heat pump sizing guide").getByText(/Energy Trust · Home/), "link area");
    await reachable(row("Heat pump sizing guide").getByText("How to size a heat pump"), "link description");
    await reachable(row("Unlined linen jacket").getByRole("button", { name: /Notes on/ }), "link notes button");
    await noSidewaysScroll("links");
    await shot("links");

    // add one: the reason field appears once an address is typed
    const before = await page.locator("[data-link]").count();
    const address = page.getByLabel("Link address");
    await reachable(address, "link address field");
    if (await page.getByLabel("Why you’re keeping it").count()) fail("links: the reason field shows before an address is typed");
    const slug = `night-trains-${profile.name}`;
    await typeIn(address, `example.org/journal/${slug}?utm_source=newsletter`);
    const why = page.getByLabel("Why you’re keeping it");
    await why.waitFor({ timeout: 3000 });
    await settle(500);
    await reachable(why, "link reason field");
    await reachable(page.getByRole("button", { name: "Save", exact: true }), "link save button");
    await typeIn(why, "For the summer trip");
    await shot("links-adding");
    await page.keyboard.press("Enter");
    const added = row(`Night trains ${profile.name.replace(/-/g, " ")}`);
    await added.waitFor({ timeout: 12000 }).catch(() => fail("links: a saved link did not appear in the list"));
    await reachable(added.getByText("For the summer trip"), "new link reason");
    if ((await page.locator("[data-link]").count()) !== before + 1) fail("links: saving one link did not add exactly one row");
    if ((await address.inputValue()) !== "") fail("links: the address field was not cleared after saving");
    const stored = await added.getByRole("link").getAttribute("href");
    if (/utm_/.test(stored || "")) fail(`links: tracking parameters were kept in the saved address (${stored})`);
    // the same page again, written differently, must not make a second entry
    await typeIn(address, `https://www.example.org/journal/${slug}/`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('[aria-label="Link address"]').value === "", null, { timeout: 12000 });
    await settle(600);
    if ((await page.locator("[data-link]").count()) !== before + 1) fail("links: saving the same page twice made a second entry");
    // something that is not an address is refused with a reason
    await typeIn(address, "not a link.at all");
    await settle(200);
    if (await page.getByRole("button", { name: "Save", exact: true }).count()) fail("links: text with spaces was accepted as an address");
    await address.fill("");

    // details: the reason and notes can be edited, and the address is shown
    await press(row("Unlined linen jacket").getByRole("button", { name: /Notes on/ }));
    await page.getByLabel("Title").waitFor({ timeout: 5000 });
    await settle(900);
    await reachable(page.getByRole("link", { name: /example\.com\/shop\/linen-jacket/ }), "link address on its page");
    await reachable(page.getByText("The navy one, size M"), "link notes");
    if ((await page.getByLabel("Summary").inputValue()) !== "Saw it in the shop on 23rd") fail("links: the reason is not editable on the link's page");
    await noSidewaysScroll("link page");
    await shot("link-page");

    // inside an area, its links are listed and one can be added there
    await page.goto(`${BASE}/context`);
    await settle(1000);
    await press(page.locator("main button", { hasText: "The house, routines" }).first());
    await row("Heat pump sizing guide").waitFor({ timeout: 6000 });
    await settle(600);
    await reachable(row("Heat pump sizing guide").getByRole("link"), "link inside its area");
    await press(page.getByRole("button", { name: "Add a link" }));
    await reachable(page.getByLabel("Link address"), "add a link inside an area");
    await noSidewaysScroll("area with links");
    await shot("links-in-area");
  });
  await step("bookmark a post in the feed", async () => {
    await page.goto(`${BASE}/feed`);
    const post = () => page.locator("article", { hasText: "Figure raised" });
    const mark = (name) => post().getByRole("button", { name, exact: true });
    await post().first().waitFor({ timeout: 8000 });
    await settle(800);
    const filter = page.getByRole("button", { name: "Bookmarked", exact: true });
    await reachable(filter, "feed bookmarked toggle");
    if ((await filter.getAttribute("aria-pressed")) !== "false") fail("feed: the bookmarked toggle is on before it was pressed");
    await reachable(mark("Bookmark"), "feed bookmark button");
    await press(mark("Bookmark"));
    await mark("Remove bookmark").waitFor({ timeout: 4000 }).catch(() => fail("feed: bookmarking a post did not confirm"));
    await settle(1500);
    await shot("feed-saved");
    // the bookmark is stored, not just shown: it is still there after loading the feed again
    await page.reload();
    await mark("Remove bookmark").waitFor({ timeout: 8000 }).catch(() => fail("feed: the bookmark was gone after reloading"));
    // bookmarked only: just that post
    await press(filter);
    await page.waitForURL("**/feed?view=bookmarked");
    await page.locator("article", { hasText: "Three-Live" }).waitFor({ state: "detached", timeout: 6000 }).catch(() => fail("feed: the bookmarked view still shows a post that is not bookmarked"));
    await post().first().waitFor({ timeout: 6000 }).catch(() => {});
    if ((await post().count()) !== 1) fail("feed: the bookmarked view does not show the bookmarked post");
    if ((await filter.getAttribute("aria-pressed")) !== "true") fail("feed: the bookmarked toggle does not show as on");
    await noSidewaysScroll("feed bookmarked");
    await settle(600);
    await shot("feed-bookmarked");
    // its source is kept in the links, once
    await page.goto(`${BASE}/context?view=links`);
    await page.locator('[data-link] a[href="https://example.com/figure-series-c"]').waitFor({ timeout: 12000 }).catch(() => fail("feed: the bookmarked post's source is not in the links list"));
    if ((await page.locator('[data-link] a[href="https://example.com/figure-series-c"]').count()) !== 1) fail("feed: bookmarking the same source again made a second entry");
    // taking the bookmark off in the bookmarked view removes the post from it, and the feed is whole again with the toggle off
    await page.goto(`${BASE}/feed?view=bookmarked`);
    await mark("Remove bookmark").waitFor({ timeout: 8000 });
    await settle(600);
    await press(mark("Remove bookmark"));
    await page.getByText("Nothing bookmarked yet.").waitFor({ timeout: 6000 }).catch(() => fail("feed: a post stayed in the bookmarked view after its bookmark was removed"));
    await settle(900);
    await shot("feed-bookmarked-empty");
    await press(page.getByRole("button", { name: "Bookmarked", exact: true }));
    await mark("Bookmark").waitFor({ timeout: 8000 }).catch(() => fail("feed: turning the bookmarked toggle off did not bring the whole feed back"));
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
    await press(card.getByRole("button", { name: /^Comments/ }));
    await settle(1300);
    const link = page.locator('aside[aria-label="Comments"]').getByRole("link", { name: /Portland dinner options/ });
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
    // each topic says where it stands: what is new since it was last opened is counted on its row, in accent
    const topics = async () => (await page.evaluate(() => fetch("/api/v1/trackers").then((r) => r.json()))).trackers;
    const was = (await topics()).find((t) => t.title === "West Seattle news");
    const row = page.locator("[data-standing]", { hasText: "West Seattle news" });
    if (!(await row.count())) fail("following: a topic does not say where it stands");
    if (was?.new_count > 0 && !(await row.locator("[data-new]").innerText().catch(() => "")).includes(`${was.new_count} new`)) fail(`following: a topic with ${was.new_count} new updates does not say so on its row`);
    await press(page.getByRole("button", { name: /West Seattle news/ }));
    await settle(2600);
    // opening it reads it
    const now = (await topics()).find((t) => t.title === "West Seattle news");
    if (!now?.seen_at || now.new_count !== 0) fail(`following: opening a topic did not count as reading it (${JSON.stringify({ seen_at: now?.seen_at, new_count: now?.new_count })})`);
    if (await row.locator("[data-new]").count()) fail("following: a topic still says it has something new while it is open");
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
    await settle(500);
    if (!(await page.getByText("UI check topic").count())) fail("following: a topic was removed without asking");
    await press(page.locator('.confirm-delete[data-armed="true"]'));
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
    await page.getByRole("button", { name: "Done", exact: true }).scrollIntoViewIfNeeded();
    await settle(300);
    await reachable(page.getByRole("button", { name: "Done", exact: true }), "connect panel Done");
    if (!(await page.locator("code").first().innerText()).match(/\/api\/mcp\/probe[a-z0-9]+$/)) fail("agents: the connector address should be the agent's own address, with no secret in it");
    await press(page.getByText("For scripts: a token sent as a header"));
    await reachable(page.getByRole("button", { name: "Make a token" }), "make a token");
    await noSidewaysScroll("agents connect panel");
    await shot("agents-connect");
    // access: what this agent may see and do is set here and saved as it is changed
    const get = (url) => page.evaluate((u) => fetch(u).then((r) => r.json()), url);
    const access = page.locator("[data-access]");
    await access.scrollIntoViewIfNeeded();
    const probeId = async () => (await get("/api/v1/me")).agents.find((x) => /^probe/.test(x.handle));
    if ((await probeId()).access) fail("agents access: a new agent should start with no limits");
    await reachable(access.getByRole("switch", { name: "Read only" }), "the Read only switch");
    await press(access.getByRole("switch", { name: "Read only" }));
    await settle(900);
    if ((await probeId()).access?.read_only !== true) fail("agents access: Read only was not saved");
    if (!(await page.locator("[data-access-badge]", { hasText: "Read only" }).count())) fail("agents access: a read-only agent does not say so beside its name");
    for (const name of ["Feed", "Todos", "Journal", "Following", "Pages", "Links", "Now", "Ideas"]) await reachable(access.getByRole("checkbox", { name, exact: true }), `access choice "${name}"`);
    await press(access.getByRole("checkbox", { name: "Journal", exact: true }));
    await settle(900);
    const limited = (await probeId()).access;
    if (!limited || limited.sections?.includes("journal") || !limited.sections?.includes("todos")) fail(`agents access: turning Journal off saved ${JSON.stringify(limited)}`);
    // the top levels of context are offered by name, and one can be turned off
    const work = access.getByRole("checkbox", { name: "Work", exact: true });
    await reachable(work, 'access choice "Work" (context)');
    await press(work);
    await settle(900);
    const narrowed = (await probeId()).access;
    if (!narrowed?.context || narrowed.context.includes("work") || !narrowed.context.includes("me")) fail(`agents access: turning Work off saved ${JSON.stringify(narrowed)}`);
    await noSidewaysScroll("agents access");
    await shot("agents-access");
    // everything back on and able to write is no limit at all
    await press(work);
    await settle(700);
    await press(access.getByRole("checkbox", { name: "Journal", exact: true }));
    await settle(700);
    await press(access.getByRole("switch", { name: "Read only" }));
    await settle(900);
    if ((await probeId()).access) fail("agents access: with everything on again the agent should have no limits");
    // an answer sent to an agent from the rail (the rail step sent "Follow it" to Scout) shows beside
    // that agent as waiting, and in its panel as a record
    const scout = page.locator("main .glass", { hasText: "@scout" }).first();
    if (!/1 waiting/.test((await scout.locator("[data-waiting]").innerText().catch(() => "")) || "")) fail("agents: an answer sent to Scout from the rail is not shown as waiting");
    else {
      await press(scout.getByRole("button", { name: "Connect", exact: true }));
      await settle(700);
      await reachable(page.locator("[data-sent]").getByText("“Follow it”"), "agents: the answer sent, in the agent's panel");
      if (!/waiting for Scout/.test(await page.locator("[data-sent]").innerText())) fail("agents: an answer the agent has not read does not say it is waiting");
      await shot("agents-sent");
      await press(scout.getByRole("button", { name: "Done", exact: true }));
      await settle(500);
      // back to the new agent's panel, where the rest of this step works
      await press(page.locator("main .glass", { hasText: /@probe/ }).first().getByRole("button", { name: "Connect", exact: true }));
      await settle(700);
    }
    // routines: a duty that comes round is given to an agent with a switch, and says when it is next due
    const routines = page.locator("[data-routines]");
    await routines.scrollIntoViewIfNeeded();
    const gaps = routines.locator('[data-routine="news-gaps"]');
    await reachable(gaps.getByText("News-gap check"), "routines: the news-gap check");
    if (!(await gaps.getByText("Nobody does this yet.").count())) fail("routines: an unassigned routine does not say nobody does it");
    await press(gaps.getByRole("switch"));
    await settle(1200);
    const given = (await get("/api/v1/routines")).routines.find((r) => r.key === "news-gaps");
    if (given?.agent_id !== (await probeId()).id) fail(`routines: turning the switch on did not give the routine to the agent (${JSON.stringify(given)})`);
    if (await gaps.getByText("Nobody does this yet.").count()) fail("routines: an assigned routine still says nobody does it");
    await noSidewaysScroll("agents routines");
    await shot("agents-routines");
    await press(gaps.getByRole("switch"));
    await settle(900);
    if ((await get("/api/v1/routines")).routines.find((r) => r.key === "news-gaps")?.agent_id) fail("routines: turning the switch off did not take the routine back");
    // removing asks once more
    await press(page.getByRole("button", { name: "Remove agent", exact: true }));
    await settle(500);
    await press(page.locator('.confirm-delete[data-armed="true"]'));
    await settle(800);
  });
  await step("people", async () => {
    const name = `Guest ${Date.now().toString(36).slice(-5)}`;
    await page.getByRole("button", { name: "Add a person" }).scrollIntoViewIfNeeded();
    await press(page.getByRole("button", { name: "Add a person" }));
    await page.getByLabel("Their name").fill(name);
    await press(page.getByRole("button", { name: "Add", exact: true }));
    await page.getByText(`${name}'s connector address`).waitFor({ timeout: 5000 });
    await settle(700);
    await press(page.getByRole("button", { name: "Make a passcode" }));
    await page.getByText("Passcode (shown once)").waitFor({ timeout: 5000 });
    await settle(500);
    const codes = page.locator("code");
    const shown = await codes.allInnerTexts();
    if (!shown.some((t) => /\/api\/mcp\/guest\/guest[a-z0-9]+$/.test(t))) fail("people: the guest's connector address is missing");
    if (!shown.some((t) => /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/.test(t))) fail("people: the passcode is missing");
    await reachable(page.getByText("Passcode (shown once)"), "passcode");
    await noSidewaysScroll("people connect panel");
    await shot("people-connect");
    // the person has a list of their own in Todos
    await press(page.getByRole("link", { name: "Todos", exact: true }));
    await page.waitForURL("**/todos");
    // in the list of folders: a waiting task of theirs is also a button, in the rail
    const fromList = page.getByRole("navigation", { name: "Lists" }).getByRole("button", { name: `From ${name}` });
    await fromList.waitFor({ timeout: 5000 });
    await fromList.scrollIntoViewIfNeeded();
    await reachable(fromList, "From list in todos");
    // the list is a category: a task in it waits in the rail, then keeps its place here once it has a day
    const fromKey = await fromList.getAttribute("data-folder");
    const long = `Book the plumber for the upstairs bathroom before the tiles arrive ${name}`;
    const send = (url, method, body) => page.evaluate(([u, m, b]) => fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [url, method, body]);
    const task = await send("/api/v1/todos", "POST", { title: long, view: fromKey });
    await page.reload();
    await settle(1500);
    if (wide) {
      // a long title in the rail runs to a second line and no further
      const waitingMod = page.locator(`[data-rail-module$="${task.id}"]`);
      const railTitle = waitingMod.locator("[data-rail-title]");
      await railTitle.waitFor({ timeout: 6000 });
      // what to do with a task waiting for a day is to give it one; it cannot be dismissed instead
      await reachable(waitingMod.getByRole("button", { name: "Today" }), "waiting task in the rail: Today");
      await reachable(waitingMod.getByRole("button", { name: "Tomorrow" }), "waiting task in the rail: Tomorrow");
      if (await waitingMod.getByRole("button", { name: /^Dismiss/ }).count()) fail("rail: a task waiting for a day can be dismissed without being placed");
      const lines = await railTitle.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
      if (lines !== 2) fail(`rail: a long title takes ${lines} lines closed, expected 2`);
      await shot("rail-two-lines");
    }
    await send(`/api/v1/todos/${task.id}`, "PATCH", { view: "today" });
    await press(fromList);
    const kept = page.locator(".todo-row", { hasText: long });
    await kept.waitFor({ timeout: 6000 }).catch(() => fail("people: a task given a day left the person's list"));
    if ((await kept.locator("[data-place]").innerText().catch(() => "")) !== "Today") fail("people: a placed task does not show its day in the person's list");
    await noSidewaysScroll("person's list");
    await shot("person-list");
    await press(page.locator("[data-folder=today]"));
    await page.locator(".todo-row", { hasText: long }).waitFor({ timeout: 6000 }).catch(() => fail("people: a task given a day is not under that day"));
    await send(`/api/v1/todos/${task.id}`, "DELETE");
    await send(`/api/v1/todos/${task.id}?forever=1`, "DELETE");
    await press(page.getByRole("link", { name: "Agents", exact: true }));
    await page.waitForURL("**/agents");
    await settle(900);
    const row = page.locator("div.glass", { hasText: name });
    await press(row.getByRole("button", { name: "Connect" }));
    await settle(600);
    await row.getByRole("button", { name: `Remove ${name}` }).scrollIntoViewIfNeeded();
    await press(row.getByRole("button", { name: `Remove ${name}` }));
    await settle(500);
    await press(page.locator('.confirm-delete[data-armed="true"]'));
    await settle(800);
    if (await page.getByText(name, { exact: true }).count()) fail("people: removed person is still listed");
  });
  await step("agents message", async () => {
    await page.locator("main").evaluate((m) => m.scrollTo(0, 0));
    const open = page.getByRole("button", { name: /^Message Scout/ });
    await reachable(open, "message button");
    await press(open);
    const box = page.getByPlaceholder("Message Scout");
    await box.waitFor({ timeout: 5000 });
    await settle(700);
    await reachable(box, "message box");
    const text = `Find three gift ideas ${Date.now().toString(36).slice(-5)}`;
    await typeIn(box, text);
    await reachable(page.getByRole("button", { name: "Send" }), "message send button");
    await page.keyboard.press("Enter");
    await page.locator("[data-messages]").getByText(text).waitFor({ timeout: 5000 });
    if (await box.inputValue()) fail("agents message: the box was not cleared after sending");
    await noSidewaysScroll("agents message panel");
    await shot("agents-message");
    // a direct message is private to that agent: it must not show in the feed
    const feed = await page.evaluate(() => fetch("/api/v1/feed?channel=feed").then((r) => r.json()));
    if (feed.posts.some((p) => p.body.includes("Find three gift ideas"))) fail("agents message: the message appeared in the feed");
    await press(open);
    await settle(600);
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
  await step("an agent's standing brief and what it did", async () => {
    await page.locator("main").evaluate((m) => m.scrollTo(0, 0));
    const row = page.locator("div.glass", { hasText: "@scout" }).first();
    await press(row.getByRole("button", { name: "Connect" }));
    const did = row.locator("[data-did]");
    await did.waitFor({ timeout: 6000 });
    await settle(600);
    await reachable(did, "what the agent did this week");
    if (!/^(This week|Nothing this week)/.test(await did.innerText())) fail(`agents: the line on what an agent did does not read as a sentence ("${await did.innerText()}")`);
    const brief = row.getByLabel("Standing brief for Scout");
    await reachable(brief, "the standing brief field");
    const text = `Watch robotics funding and keep the work notes current ${Date.now().toString(36).slice(-5)}`;
    await typeIn(brief, text);
    await press(did); // a tap elsewhere saves it
    await settle(1200);
    const saved = (await page.evaluate(() => fetch("/api/v1/me").then((r) => r.json()))).agents.find((a) => a.handle === "scout")?.brief;
    if (saved !== text) fail(`agents: the standing brief was not saved ("${saved}")`);
    await noSidewaysScroll("agents, standing brief");
    await shot("agents-brief");
    // as it was, for the next screen size
    await brief.fill("");
    await press(did);
    await settle(900);
    await press(row.getByRole("button", { name: "Done" }));
    await settle(500);
  });
  await step("what is kept about how the app is used", async () => {
    // the app has been reporting which screens were open throughout this run; the Agents screen says so, and can clear it
    const kept = await page.evaluate(() => fetch("/api/v1/seen").then((r) => r.json()));
    if (!(kept.count > 0)) fail("kept: nothing was recorded of the screens opened in this run");
    const line = page.locator("[data-kept]");
    await line.scrollIntoViewIfNeeded();
    await reachable(line.locator("p"), "the line saying what is kept");
    if (!/Nothing you type is kept/.test(await line.innerText())) fail("kept: the line does not say that nothing typed is kept");
    await reachable(line.getByRole("button", { name: "Clear this record" }), "the way to clear what is kept");
    await noSidewaysScroll("agents, what is kept");
    await shot("agents-kept");
  });

  // ---------- Search and chat, within reach on every screen ----------
  await step("search everything", async () => {
    await page.goto(`${BASE}/feed`);
    await settle(1500);
    const open = page.getByRole("button", { name: "Search", exact: true });
    await reachable(open, "search button");
    await press(open);
    const panel = page.locator("[data-dock-panel=search]");
    const field = page.getByLabel("Search everything");
    await field.waitFor({ timeout: 5000 });
    await settle(600);
    await reachable(field, "search field");
    // the field has the keyboard as the panel opens: nothing needs tapping first
    await page.keyboard.type("robot", { delay: 15 });
    if ((await field.inputValue()) !== "robot") fail("search: typing did not go into the field as the panel opened");
    await panel.locator("[data-hit]").first().waitFor({ timeout: 6000 });
    await settle(500);
    const kinds = await panel.locator("[data-hit]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-hit")))]);
    for (const k of ["todo", "post", "tracker"]) if (!kinds.includes(k)) fail(`search: nothing of kind ${k} among the results for "robot" (${kinds.join(", ")})`);
    if (!kinds.some((k) => ["context", "page", "journal"].includes(k))) fail(`search: no note or page among the results for "robot" (${kinds.join(", ")})`);
    await reachable(panel.locator("[data-hit] > button").first(), "first search result");
    await noSidewaysScroll("search panel");
    await shot("search");
    // a post has no place of its own: it is read where it was found
    const post = panel.locator("[data-hit=post] > button").first();
    await post.scrollIntoViewIfNeeded();
    await press(post);
    await settle(900);
    if ((await post.getAttribute("aria-expanded")) !== "true") fail("search: a post did not open in place");
    await shot("search-post");
    // everything else opens where it lives
    const task = panel.locator("[data-hit=todo] > button").first();
    await task.scrollIntoViewIfNeeded();
    await press(task);
    await page.waitForURL((u) => u.pathname === "/todos", { timeout: 6000 }).catch(() => fail("search: a task among the results did not open on Todos"));
    await settle(1500);
    if (await panel.count()) fail("search: the panel stayed open after a result was opened");
  });
  await step("chat about what is on screen", async () => {
    // the task opened from search is still on screen
    const open = page.getByRole("button", { name: "Chat", exact: true });
    await reachable(open, "chat button");
    await press(open);
    const panel = page.locator("[data-dock-panel=chat]");
    const box = panel.locator("textarea");
    await box.waitFor({ timeout: 5000 });
    await settle(700);
    await reachable(box, "chat field");
    const about = (await panel.locator("[data-about-chip]").innerText().catch(() => "")).trim();
    if (!about || about === "Todos") fail(`chat: the open task is not offered as what the message is about ("${about}")`);
    const stamp = Date.now().toString(36).slice(-5);
    const text = `What changed here ${stamp}`;
    await page.keyboard.type(text, { delay: 15 });
    if ((await box.inputValue()) !== text) fail("chat: typing did not go into the field as the panel opened");
    await page.keyboard.press("Enter");
    await panel.locator("[data-messages]").getByText(text).waitFor({ timeout: 5000 });
    if (await box.inputValue()) fail("chat: the field was not cleared after sending");
    // naming an agent sends it to that one
    const named = `@scout anything new ${stamp}`;
    await page.keyboard.type(named, { delay: 15 });
    await page.keyboard.press("Enter");
    await panel.locator("[data-messages]").getByText(`anything new ${stamp}`).waitFor({ timeout: 5000 });
    await settle(500);
    const { chat, me, feed } = await page.evaluate(async () => ({
      chat: await fetch("/api/v1/chat").then((r) => r.json()),
      me: await fetch("/api/v1/me").then((r) => r.json()),
      feed: await fetch("/api/v1/feed?channel=feed").then((r) => r.json()),
    }));
    const first = chat.messages.find((m) => m.body === text);
    const second = chat.messages.find((m) => m.body === named);
    const scout = me.agents.find((a) => a.handle === "scout");
    if (!first || !second) fail("chat: a message sent is not in the conversation");
    else {
      if (first.about?.type !== "todo" || !first.about?.id) fail(`chat: the message does not say which task was on screen (${JSON.stringify(first.about)})`);
      if (first.channel !== `dm:${me.default_agent}`) fail("chat: a message naming nobody did not go to the default agent");
      if (second.channel !== `dm:${scout?.id}`) fail("chat: a message naming an agent did not go to that agent");
    }
    if (feed.posts.some((p) => p.body.includes(stamp))) fail("chat: a message appeared in the feed");
    await noSidewaysScroll("chat panel");
    await shot("chat");
    await page.keyboard.press("Escape");
    await settle(600);
    if (await panel.count()) fail("chat: Escape did not close the panel");
  });
  await step("task given to an agent, with a conversation", async () => {
    // still on the task that search opened; which one it is, the chat message just sent says
    const chat = await page.evaluate(() => fetch("/api/v1/chat").then((r) => r.json()));
    const id = [...chat.messages].reverse().find((m) => m.about?.type === "todo")?.about.id;
    const pill = page.locator("label[data-assignee]");
    // what the pill says (the menu inside it lists every agent, so its own words are read, not the whole label's)
    const says = async () => (await pill.locator("span").first().innerText()).trim();
    await pill.scrollIntoViewIfNeeded();
    await reachable(pill, "the pill that gives a task to an agent");
    await page.getByLabel("Give to").selectOption({ label: "Scout" });
    await settle(1000);
    if ((await says()) !== "Scout") fail(`task: the pill does not name the agent the task was given to ("${await says()}")`);
    // the conversation is under the notes, and its field says who a message goes to
    const box = page.locator("[data-thread] textarea");
    await box.scrollIntoViewIfNeeded();
    await reachable(box, "the task's message field");
    if ((await box.getAttribute("placeholder")) !== "Message Scout") fail(`task: the message field does not name the agent the task is given to ("${await box.getAttribute("placeholder")}")`);
    const text = `Is the twelfth still right ${Date.now().toString(36).slice(-5)}`;
    await typeIn(box, text);
    await page.keyboard.press("Enter");
    await page.locator("[data-thread] [data-bubble]").getByText(text).waitFor({ timeout: 5000 });
    if (await box.inputValue()) fail("task: the message field was not cleared after sending");
    await settle(500);
    const kept = await page.evaluate(async (id) => ({
      thread: await fetch(`/api/v1/todos/${id}/thread`).then((r) => r.json()),
      all: await fetch("/api/v1/todos?view=all").then((r) => r.json()),
      me: await fetch("/api/v1/me").then((r) => r.json()),
      feed: await fetch("/api/v1/feed?channel=feed").then((r) => r.json()),
      chat: await fetch("/api/v1/chat").then((r) => r.json()),
    }), id);
    const scout = kept.me.agents.find((a) => a.handle === "scout");
    if (kept.thread.messages?.at(-1)?.body !== text) fail("task: what was said is not in the task's conversation");
    if (kept.all.todos.find((t) => t.id === id)?.assignee !== scout?.id) fail("task: the task is not given to the agent chosen");
    if (kept.feed.posts.some((p) => p.body === text) || kept.chat.messages.some((m) => m.body === text)) fail("task: what was said on a task showed in the feed or in chat");
    await noSidewaysScroll("task conversation");
    await shot("todo-conversation");
    // as it was, for the next screen size
    await page.getByLabel("Give to").selectOption("");
    await settle(800);
    if ((await says()) !== "Give to") fail(`task: taking the task back did not clear the pill ("${await says()}")`);
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

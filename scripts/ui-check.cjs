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
  await shot("login");
  await page.fill("input[type=password]", "wrong-password");
  await page.keyboard.press("Enter");
  await page.getByText("That password is not right.").waitFor({ timeout: 5000 }).catch(() => fail("login: no error shown for a wrong password"));
  await page.fill("input[type=password]", process.env.SUBSPACE_PASSWORD || "subspace");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/feed");
  await settle(1500);
  if (process.env.DATABASE_URL) {
    // an earlier screen size dismissed a rail module; bring it back so every size sees the same thing
    const { Client } = require("pg");
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query("UPDATE rail_modules SET dismissed_at = NULL");
    await db.end();
    await page.reload();
    await settle(1500);
  }

  // Navigation is reachable everywhere.
  for (const label of ["Feed", "Todos", "Journal", "Context", "Following", "Agents"]) await reachable(page.getByRole("link", { name: label, exact: true }), `nav ${label}`);

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
    } else {
      if (await hotel.count()) fail("rail: modules are showing before the rail is opened on a narrow screen");
      await reachable(toggle, "rail button");
      await press(toggle);
      await hotel.waitFor({ timeout: 6000 });
      await settle(700);
    }
    await reachable(hotel.getByText("Residence Inn, Pearl District"), "rail module title");
    // minimal by default: details stay hidden until the module is expanded
    if (await hotel.getByText("84127763").count()) fail("rail: module details are showing before it is expanded");
    if (await hotel.getByRole("link").count()) fail("rail: module buttons are showing before it is expanded");
    await shot("rail-closed");
    await press(hotel.getByRole("button", { expanded: false }));
    await settle(700);
    await reachable(hotel.getByText("84127763"), "rail module detail");
    await reachable(hotel.getByRole("link", { name: /Directions/ }), "rail module action");
    await reachable(hotel.getByRole("link", { name: "Open page" }), "rail module page link");
    const count = await page.locator("[data-rail-module]").count();
    if (count !== 3) fail(`rail: ${count} modules shown, expected 3`);
    // an error from an agent is listed first and marked
    const firstMod = page.locator("[data-rail-module]").first();
    if ((await firstMod.getAttribute("data-level")) !== "error") fail("rail: the error module is not shown first");
    await reachable(firstMod.getByText("Calendar connection expired"), "rail error title");
    await noSidewaysScroll("rail");
    await shot("rail");
    // dismissing one removes it; hiding the rail gives the space back
    await press(page.locator('[data-rail-module="roof-inspection"]').getByRole("button", { expanded: false }));
    await hotel
      .getByText("84127763")
      .waitFor({ state: "detached", timeout: 4000 })
      .catch(() => fail("rail: opening one module left the other expanded"));
    await press(page.getByRole("button", { name: "Dismiss Roofer comes to inspect" }));
    await settle(900);
    if ((await page.locator("[data-rail-module]").count()) !== 2) fail("rail: dismissing a module did not remove it");
    if (!wide) {
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
      // comments stay open while the feed scrolls, and follow the post being read (here the first one, at the top of the feed)
      const other = page.locator("main article").first();
      await page.locator("main").evaluate((m) => m.scrollTo({ top: 0 }));
      await settle(900);
      if (!(await reply.count())) fail("feed comments: scrolling the feed closed the comments");
      if ((await other.getByRole("button", { name: "Close comments" }).count()) !== 1) fail("feed comments: scrolling to another post did not move the comments to it");
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
    // out of view it waits; scrolled into view it plays by itself, without sound
    await page.locator("main").evaluate((m) => m.scrollTo({ top: 0 }));
    await card.evaluate((el) => el.closest("main").scrollBy({ top: el.getBoundingClientRect().top - innerHeight - 200 }));
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
    await page.locator("main").evaluate((m) => m.scrollTo({ top: 0 }));
    await card.evaluate((el) => el.closest("main").scrollBy({ top: el.getBoundingClientRect().top - innerHeight - 200 }));
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
      const railTitle = page.locator(`[data-rail-module$="${task.id}"] button span.font-medium`).last();
      await railTitle.waitFor({ timeout: 6000 });
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

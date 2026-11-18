/** Demo content for local development. Run against an empty database: npm run seed */
import { createAgent } from "../src/lib/core/agents";
import { openJobs, submitJob } from "../src/lib/core/art";
import { deflateSync } from "node:zlib";
import { createNode } from "../src/lib/core/context";
import { categorize, createEntry } from "../src/lib/core/journal";
import { saveLink } from "../src/lib/core/links";
import { saveMedia } from "../src/lib/core/media";
import { createPost, createReply } from "../src/lib/core/posts";
import { setModule } from "../src/lib/core/rail";
import { createTodo, updateTodo } from "../src/lib/core/todos";
import { createTracker } from "../src/lib/core/trackers";
import { agentById, newId, ownerAgent } from "../src/lib/core/util";
import { q } from "../src/lib/db";
import { paletteFor } from "../src/lib/palettes";

const ICONS: Record<string, string> = {
  robot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="14" height="11" rx="3.5"/><path d="M12 4.5V8M3 13v2M21 13v2"/><circle cx="9.5" cy="13" r="1" fill="currentColor"/><circle cx="14.5" cy="13" r="1" fill="currentColor"/></svg>',
  bridge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h18M6 17V7M18 17V7M6 8c2 5 10 5 12 0M3 11c1.5 0 3-1 3-3M21 11c-1.5 0-3-1-3-3"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"/></svg>',
};

/** A stack of coins seen from the side: white discs, each with a darker lower edge. */
const coins = (x: number, n: number, ink: string) => Array.from({ length: n }, (_, i) => `<rect x="${x - 23}" y="${248 - i * 13}" width="46" height="11" rx="5.5" fill="${ink}" fill-opacity=".3"/><rect x="${x - 23}" y="${246 - i * 13}" width="46" height="9" rx="4.5" fill="#fff" fill-opacity=".96"/>`).join("");

/**
 * Illustrations as the illustrator is asked to draw them (guide("illustration")): each shows what
 * its post is about, recognisably. The actual subject, what happened to it, and a detail or two
 * that place it; white bodies, ink for what defines them, a palette colour where the eye should land.
 */
const scenes = (c: string[], ink: string) => ({
  funding: `<svg viewBox="0 0 480 300"><ellipse cx="240" cy="264" rx="190" ry="9" fill="${ink}" fill-opacity=".12"/><path d="M155 58V44" stroke="${ink}" stroke-opacity=".8" stroke-width="5" stroke-linecap="round"/><circle cx="155" cy="40" r="7" fill="${c[1]}"/><rect x="131" y="56" width="48" height="38" rx="15" fill="#fff" fill-opacity=".94"/><rect x="140" y="68" width="30" height="12" rx="6" fill="${ink}" fill-opacity=".85"/><rect x="149" y="94" width="12" height="9" fill="${ink}" fill-opacity=".7"/><rect x="101" y="106" width="17" height="64" rx="8.5" fill="${ink}" fill-opacity=".8"/><rect x="192" y="106" width="17" height="64" rx="8.5" fill="${ink}" fill-opacity=".8"/><rect x="121" y="102" width="68" height="80" rx="20" fill="#fff" fill-opacity=".92"/><circle cx="155" cy="128" r="10" fill="${c[1]}"/><rect x="139" y="152" width="32" height="6" rx="3" fill="${ink}" fill-opacity=".25"/><rect x="131" y="180" width="48" height="15" rx="7.5" fill="${ink}" fill-opacity=".8"/><rect x="132" y="193" width="18" height="58" rx="9" fill="#fff" fill-opacity=".92"/><rect x="160" y="193" width="18" height="58" rx="9" fill="#fff" fill-opacity=".92"/><rect x="125" y="246" width="29" height="13" rx="6.5" fill="${ink}" fill-opacity=".85"/><rect x="156" y="246" width="29" height="13" rx="6.5" fill="${ink}" fill-opacity=".85"/>${coins(292, 2, ink)}${coins(346, 4, ink)}${coins(400, 7, ink)}<circle cx="236" cy="234" r="24" fill="#fff" fill-opacity=".96"/><circle cx="236" cy="234" r="24" fill="none" stroke="${ink}" stroke-opacity=".8" stroke-width="5"/><circle cx="236" cy="234" r="10" fill="${c[1]}"/><path d="M400 142V108M386 120l14-16 14 16" fill="none" stroke="${ink}" stroke-opacity=".85" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="9s" repeatCount="indefinite"/></path></svg>`,
  bridge: `<svg viewBox="0 0 480 300"><path d="M396 30a25 25 0 1 0 24 36a20 20 0 0 1-24-36z" fill="#fff" fill-opacity=".94"/><circle cx="326" cy="46" r="4" fill="#fff" fill-opacity=".8"/><circle cx="92" cy="58" r="3.5" fill="#fff" fill-opacity=".7"/><circle cx="196" cy="34" r="3" fill="#fff" fill-opacity=".7"/><path d="M52 154h376M92 154v14M172 154v14M308 154v14M388 154v14" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="5" stroke-linecap="round"/><rect x="108" y="184" width="28" height="66" rx="8" fill="#fff" fill-opacity=".88"/><rect x="344" y="184" width="28" height="66" rx="8" fill="#fff" fill-opacity=".88"/><rect x="40" y="168" width="400" height="19" rx="9.5" fill="${ink}" fill-opacity=".86"/><rect x="80" y="122" width="44" height="22" rx="9" fill="#fff" fill-opacity=".96"/><rect x="66" y="138" width="74" height="24" rx="10" fill="#fff" fill-opacity=".96"/><rect x="88" y="127" width="29" height="11" rx="4" fill="${ink}" fill-opacity=".6"/><circle cx="85" cy="163" r="9" fill="${ink}" fill-opacity=".92"/><circle cx="122" cy="163" r="9" fill="${ink}" fill-opacity=".92"/><rect x="250" y="114" width="11" height="56" rx="4" fill="${ink}" fill-opacity=".86"/><rect x="152" y="122" width="108" height="15" rx="7.5" fill="#fff" fill-opacity=".97"/><path d="M178 122v15M206 122v15M234 122v15" stroke="${ink}" stroke-opacity=".82" stroke-width="13"/><circle cx="255.5" cy="108" r="9" fill="${c[1]}"><animate attributeName="opacity" values="1;.45;1" dur="8s" repeatCount="indefinite"/></circle><path d="M196 236h88l-14 20h-60z" fill="${ink}" fill-opacity=".84"/><rect x="216" y="219" width="46" height="17" rx="5" fill="#fff" fill-opacity=".94"/><path d="M226 228h5M238 228h5M250 228h4" stroke="${ink}" stroke-opacity=".6" stroke-width="6" stroke-linecap="round"/><path d="M48 270q15-9 30 0t30 0t30 0t30 0M300 270q15-9 30 0t30 0t30 0t30 0" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="5" stroke-linecap="round"/></svg>`,
  dentist: `<svg viewBox="0 0 480 300"><ellipse cx="240" cy="266" rx="180" ry="8" fill="${ink}" fill-opacity=".1"/><rect x="92" y="62" width="208" height="192" rx="28" fill="#fff" fill-opacity=".9"/><path d="M92 112V90a28 28 0 0 1 28-28h152a28 28 0 0 1 28 28v22z" fill="${ink}" fill-opacity=".84"/><rect x="142" y="48" width="11" height="30" rx="5.5" fill="#fff"/><rect x="239" y="48" width="11" height="30" rx="5.5" fill="#fff"/><g fill="${ink}" fill-opacity=".14"><rect x="114" y="130" width="28" height="28" rx="9"/><rect x="198" y="130" width="28" height="28" rx="9"/><rect x="114" y="172" width="28" height="28" rx="9"/><rect x="156" y="172" width="28" height="28" rx="9"/><rect x="198" y="172" width="28" height="28" rx="9"/><rect x="240" y="172" width="28" height="28" rx="9"/><rect x="114" y="214" width="28" height="28" rx="9"/><rect x="156" y="214" width="28" height="28" rx="9"/></g><rect x="156" y="130" width="28" height="28" rx="9" fill="${c[1]}"/><circle cx="170" cy="144" r="23" fill="none" stroke="${ink}" stroke-opacity=".85" stroke-width="5"/><rect x="240" y="130" width="28" height="28" rx="9" fill="none" stroke="${ink}" stroke-opacity=".35" stroke-width="3" stroke-dasharray="5 5"/><path d="M252 122Q212 100 184 116" fill="none" stroke="${ink}" stroke-opacity=".7" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 9"/><path d="M336 148c0-26 20-34 38-24c18-10 38-2 38 24c0 24-10 38-14 64c-2 12-14 12-15 0l-4-24c-1-7-9-7-10 0l-4 24c-1 12-13 12-15 0c-4-26-14-40-14-64z" fill="#fff" fill-opacity=".96"/><path d="M352 146c0-10 6-15 13-14" fill="none" stroke="${ink}" stroke-opacity=".3" stroke-width="5" stroke-linecap="round"/><path d="M428 96v20M418 106h20" stroke="${c[1]}" stroke-width="6" stroke-linecap="round"/><circle cx="318" cy="232" r="26" fill="${ink}" fill-opacity=".86"/><path d="M318 232v17M318 232l13 4" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>`,
  compost: `<svg viewBox="0 0 480 300"><ellipse cx="232" cy="268" rx="180" ry="8" fill="${ink}" fill-opacity=".1"/><rect x="150" y="76" width="56" height="12" rx="6" fill="${ink}" fill-opacity=".6"/><path d="M112 108h132l-11 138a12 12 0 0 1-12 11h-86a12 12 0 0 1-12-11z" fill="#fff" fill-opacity=".92"/><rect x="100" y="88" width="156" height="22" rx="11" fill="${ink}" fill-opacity=".85"/><path d="M178 214c-34-12-38-56 0-80c38 24 34 68 0 80z" fill="${c[0]}"/><path d="M178 222v-68M178 190l16-15M178 174l-14-13" fill="none" stroke="${ink}" stroke-opacity=".8" stroke-width="5" stroke-linecap="round"/><circle cx="140" cy="258" r="15" fill="${ink}" fill-opacity=".86"/><circle cx="140" cy="258" r="5" fill="#fff"/><rect x="296" y="84" width="124" height="170" rx="24" fill="#fff" fill-opacity=".88"/><path d="M296 124v-16a24 24 0 0 1 24-24h76a24 24 0 0 1 24 24v16z" fill="${ink}" fill-opacity=".84"/><rect x="314" y="140" width="88" height="18" rx="9" fill="${c[1]}"/><rect x="314" y="168" width="88" height="18" rx="9" fill="${ink}" fill-opacity=".13"/><rect x="314" y="196" width="88" height="18" rx="9" fill="${c[1]}"/><rect x="314" y="224" width="88" height="18" rx="9" fill="${ink}" fill-opacity=".13"/><circle cx="326" cy="149" r="5" fill="${ink}" fill-opacity=".8"/><circle cx="326" cy="205" r="5" fill="${ink}" fill-opacity=".8"/><path d="M282 58c-16 2-26-10-22-26c16-2 26 10 22 26z" fill="${c[2]}"><animateTransform attributeName="transform" type="translate" values="0 0;-4 6;0 0" dur="10s" repeatCount="indefinite"/></path></svg>`,
});

/** A stand-in screenshot: flat panels on a background, as a PNG. Each box is [x, y, w, h, colour] in tenths of a percent. */
function screenshot(w: number, h: number, bg: number, boxes: [number, number, number, number, number][]): Buffer {
  const px = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c = bg;
      for (const [bx, by, bw, bh, col] of boxes) if (x * 1000 >= bx * w && x * 1000 < (bx + bw) * w && y * 1000 >= by * h && y * 1000 < (by + bh) * h) c = col;
      px.writeUIntBE(c, y * (w * 3 + 1) + 1 + x * 3, 3);
    }
  const crc = (b: Buffer) => {
    let c = ~0;
    for (const v of b) for (let k = 0, x = (c ^= v); k < 8; k++) c = x = x & 1 ? (x >>> 1) ^ 0xedb88320 : x >>> 1;
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(px)), chunk("IEND", Buffer.alloc(0))]);
}

/** A two-second WebM clip. */
const CLIP = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAASoEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEfTbuMU6uEHFO7a1OsggSS7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECfQAAAAAAAFlSua8KuAQAAAAAAADnXgQFzxYjGNvult5RRVZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAX14QDgirCCAUC6gbSagQISVMNn/HNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjAuMTYuMTAwc3PWY8CLY8WIxjb7pbeUUVVnyKFFo4dFTkNPREVSRIeUTGF2YzYwLjMxLjEwMiBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwMDAwMDAwMAAfQ7Z1QuzngQCjQJuBAACAEA8AnQEqQAG0AABHCIWFiIWEiAICAnTyOjq0vte3Nk5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5w9k5vAP7wpdf/qdP//U6f/+p0/+p0iMM6wKOdgQBkALECAAEQEAAYABhYL/QACIAEM1+tck+VgACjnYEAyACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BASwAsQIAARAQABgAGFgv9AAIgAQzX61yT5WAAKOdgQGQALECAAEQEAAYABhYL/QACIAEM1+tck+VgACjnYEB9ACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BAlgAsQIAARAQABgAGFgv9AAIgAQzX61yT5WAAKOcgQK8AJECAAEQEBRgAGFgv9AAIgAQzX61yT5WAKOdgQMgALECAAEQEAAYABhYL/QACIAEM1+tck+VgACjnYEDhACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BA+gAsQIAARAQABgAGFgv9AAIgAQzX61yT5WAAKOdgQRMALECAAEQEAAYABhYL/QACIAEM1+tck+VgACjnYEEsACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BBRQAsQIAARAQABgAGFgv9AAIgAQzX61yT5WAAKOdgQV4ALECAAEQEAAYABhYL/QACIAEM1+tck+VgACjnYEF3ACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BBkAAsQIAARAQABgAGFgv9AAIgAQzX61yT5WAAKOcgQakAJECAAEQEBRgAGFgv9AAIgAQzX61yT5WAKOdgQcIALECAAEQEAAYABhYL/QACIAEM1+tck+VgACjnYEHbACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAHFO7a5G7j7OBALeK94EB8YIBoPCBAw==";

async function draw(claude: any, pick: (prompt: string) => string) {
  for (const j of await openJobs(claude, 50)) {
    const p = (j as any).palette ?? paletteFor(1);
    const key = pick(j.prompt ?? "");
    const svg = j.kind === "icon" ? ICONS[key] ?? ICONS.home : (scenes(p.colors, p.ink) as any)[key] ?? scenes(p.colors, p.ink).compost;
    await submitJob(claude, j.job_id, svg);
  }
}

async function main() {
  const owner = await ownerAgent();
  const claude = (await agentById("a_claude"))!;
  const scout = await createAgent(owner, { name: "Scout", bio: "Watches markets and news." });
  const atlas = await createAgent(owner, { name: "Atlas", bio: "Runs the calendar and the house." });

  const robotics = await createTracker(owner, { title: "Robotics investments", label: "Robotics", description: "Funding rounds over $50M in humanoid and warehouse robotics, plus anything that changes the picture for my Agility position. Ignore consumer gadgets and product launches.", agents: [scout.id] });
  const seattle = await createTracker(scout, { title: "West Seattle news", label: "West Seattle", description: "Bridge and transit changes, school district decisions, new openings on California Ave, and anything that affects the commute. Skip crime blotter items." });
  await draw(claude, (p) => (/robot/i.test(p) ? "robot" : /seattle/i.test(p) ? "bridge" : "home"));

  await createPost(scout, { tracker: seattle.slug, body: "Low bridge closes to cars 9pm Friday to 5am Monday for cable work. Water taxi adds late sailings both nights.", art: { prompt: "A low road bridge over water at night, a striped barrier down across the road with a car waiting behind it, a small ferry passing underneath" } });
  await createPost(scout, { tracker: seattle.slug, feed: false, body: "New bakery confirmed for the old Husky Deli annex, opening in January." });
  const p = await createPost(scout, { tracker: robotics.slug, body: "Figure raised $1.2B at a $39B valuation. Third humanoid round over $1B this year, and Agility is now the cheapest of the three by revenue multiple.", source: { name: "The Information", url: "https://example.com/figure-series-c" }, art: { prompt: "A humanoid robot standing beside three stacks of coins that rise from left to right, an arrow pointing up over the tallest" } });
  await createReply(owner, p.id, "@claude how does this change the case for holding Agility?");
  await createReply(claude, p.id, "It strengthens it. Agility has the only fleet doing paid shifts at scale, and the gap in multiples widened. I added the comparison to your robotics thesis in Context.");
  // One post with several pictures: three screens of the same product, each showing a different part.
  const shots = [
    { title: "Timeline editor", png: screenshot(960, 600, 0xf3f1ee, [[0, 0, 1000, 90, 0x26242b], [30, 150, 200, 800, 0xe2ddf7], [270, 150, 700, 380, 0xffffff], [270, 570, 330, 60, 0x8f83f5], [270, 660, 520, 60, 0xf2b8a0], [450, 750, 400, 60, 0x9fd8c4], [270, 840, 240, 60, 0xf3d58a]]) },
    { title: "Scene graph", png: screenshot(960, 600, 0x1c1b22, [[0, 0, 1000, 90, 0x2b2a33], [30, 150, 300, 800, 0x2b2a33], [60, 200, 200, 40, 0x8f83f5], [90, 270, 170, 40, 0x4a4856], [90, 340, 170, 40, 0x4a4856], [120, 410, 140, 40, 0x4a4856], [370, 150, 600, 800, 0x34323e], [520, 330, 300, 420, 0x9fd8c4]]) },
    { title: "Export to AR", png: screenshot(720, 900, 0xf3f1ee, [[0, 0, 1000, 70, 0x26242b], [120, 140, 760, 480, 0xffffff], [300, 240, 400, 280, 0xf2b8a0], [120, 670, 760, 60, 0xe2ddf7], [120, 760, 500, 60, 0xe2ddf7], [120, 860, 300, 80, 0x8f83f5]]) },
  ];
  const [first, ...more] = await Promise.all(shots.map(async (x) => ({ url: await saveMedia(claude, x.png, "image/png"), title: x.title })));
  await createPost(claude, { body: "Three-Live turns editable 3D scene code into AR-ready assets.", source: { name: "Google Open Source", url: "https://example.com/three-live" }, media: { type: "image", ...first, more } });
  // One post with a video: two seconds of a stand-in clip, stored here so the demo needs no network.
  const clip = `/api/media/${newId("m")}`;
  await q("INSERT INTO media (id, mime, bytes, created_by) VALUES ($1,$2,$3,$4)", [clip.split("/").pop(), "video/webm", Buffer.from(CLIP, "base64"), scout.id]);
  await createPost(scout, { tracker: robotics.slug, body: "Digit unloads a full trailer without a person stepping in.", source: { name: "Agility Robotics", url: "https://example.com/digit-trailer" }, media: { type: "video", url: clip, title: "Digit unloading a trailer" } });
  await createPost(atlas, { body: "Dentist moved to Tuesday 3:30pm; Thursday is now clear after 2. Parent-teacher conference still needs a slot this week.", art: { prompt: "A wall calendar with one day circled and a dotted arrow to it from another day, a tooth beside it and a small clock" } });
  await createPost(claude, { body: "Compost pickup switches to every other week starting Monday. I added the new schedule to Home and a reminder for Sunday night.", art: { prompt: "A wheeled compost bin with a leaf on its front, beside a calendar page with every other week marked" } });
  await createPost(atlas, { channel: "agents", body: "@scout when a bridge closure lands on a weekday, flag me so I can shift the school run." });
  await draw(claude, (p) => (/bridge/i.test(p) ? "bridge" : /coins/i.test(p) ? "funding" : /tooth/i.test(p) ? "dentist" : "compost"));

  const t = await createTodo(owner, { title: "Review robotics allocation", view: "today", tags: ["finance"] });
  await updateTodo(owner, t.id, { notes: "## What I want\n\nDecide whether to add to Agility before year end. @claude can you pull the numbers?\n\n- [ ] Compare revenue multiples\n- [ ] Check lock-up dates" });
  await updateTodo(claude, t.id, { notes_append: "## Numbers\n\n- Figure: $39B valuation, about 95x revenue\n- Agility: $4.1B, about 31x revenue\n- [ ] Lock-up on the secondary ends 12 December" });
  await createTodo(owner, { title: "Book parent-teacher conference", view: "today" });
  await createTodo(atlas, { title: "Put compost bin out Sunday night", view: "weekend" });
  await createTodo(owner, { title: "Call the roofer back", view: "today", tags: ["house"] });
  await createTodo(owner, { title: "Draft Q1 goals", view: "week" });
  await createTodo(owner, { title: "Renew passport", view: "next_week" });
  // two tags on one task, so narrowing to both keeps it and drops the other "house" task
  await createTodo(owner, { title: "Replace the hallway light", view: "backlog", tags: ["house", "diy"] });
  // Something an agent needs the owner to decide: a task in their list, tagged, with the detail in its notes.
  // The rail points at it further down; nothing about it goes in the feed.
  const topUp = await createTodo(scout, {
    title: "Decide on the Agility top-up",
    view: "next_week",
    tags: ["finance"],
    notes: "The lock-up on the secondary ends 12 December, so this is the last window this year.\n\n- Figure: about 95x revenue\n- Agility: about 31x revenue\n\nMy view: add half the planned amount now and keep the rest for the next round.",
  });

  await createNode(claude, { parent: "work", title: "Robotics thesis", summary: "Why I hold robotics positions and what would change my mind.", body: "## Position\n\n- Agility Robotics, secondary shares (as of 2026-11)\n\n## Thesis\n\n- Paid deployments matter more than demos\n- Multiples: Figure about 95x revenue, Agility about 31x\n\n## Would change my mind\n\n- A fleet recall\n- A competitor reaching 1,000 paid units first" });
  await createNode(atlas, { parent: "home", title: "Weekly rhythm", summary: "School run, pickups and recurring household chores.", body: "- School run: 8:10 out, 3:05 pickup\n- Compost: every other Monday from 2026-11-16\n- Recycling: Mondays" });
  await createNode(owner, { parent: "me", title: "How I like updates", summary: "Short, concrete, numbers first. No preamble.", body: "- Lead with what changed\n- Give me the decision you need, if any\n- Morning is for planning; do not send non-urgent things before 9" });

  // ---- Pages: a consumer shortlist and a research brief, filed by topic ----
  const travel = await createNode(atlas, { parent: "home", title: "Travel", summary: "Trips: plans, bookings and shortlists." });
  const fence = "```";
  const block = (type: string, data: unknown) => `${fence}${type}\n${JSON.stringify(data)}\n${fence}`;
  const places = [
    { title: "Nostrana", subtitle: "Italian · Buckman", rating: 4.6, reviews: 2140, price: "$$$", badge: "Top pick", description: "Wood-fired fish and a long list of dishes without cheese. Quiet tables at the back.", meta: ["12 min drive", "Book ahead"], url: "https://nostrana.com", lat: 45.5152, lng: -122.6512 },
    { title: "Luce", subtitle: "Italian · Kerns", rating: 4.5, reviews: 860, price: "$$", description: "Small room, daily whole fish, simple pastas with olive oil rather than cream.", meta: ["14 min drive"], url: "https://www.luceportland.com", lat: 45.5229, lng: -122.6418 },
    { title: "Gilda's", subtitle: "Italian · Goose Hollow", rating: 4.4, reviews: 520, price: "$$$", description: "Grilled branzino and cioppino. Easy to get a table midweek.", meta: ["8 min walk", "Quiet"], url: "https://www.gildasitalianrestaurant.com", lat: 45.5203, lng: -122.6931 },
    { title: "Caffe Mingo", subtitle: "Italian · Northwest", rating: 4.5, reviews: 1310, price: "$$", description: "Neighbourhood favourite. Fish special most nights; lively at weekends.", meta: ["15 min walk", "No bookings"], url: "https://caffemingonw.com", lat: 45.5265, lng: -122.6942 },
  ];
  const card = ({ lat: _a, lng: _b, ...c }: (typeof places)[number]) => c;
  const dinner = await createNode(claude, {
    kind: "page",
    parent: travel.id,
    title: "Portland dinner options",
    summary: "Italian restaurants near the Pearl District with fish and plenty of dishes without cheese.",
    body: [
      block("callout", { tone: "decision", title: "Book Nostrana for Saturday", text: "It has the widest choice of fish and dishes without cheese, and takes bookings. Gilda's is the fallback if you would rather walk from the hotel." }),
      "## Shortlist",
      block("cards", { layout: "carousel", items: places.map(card) }),
      "## Where they are",
      block("map", { markers: [{ title: "Residence Inn Pearl District", lat: 45.5296, lng: -122.6817, note: "Your hotel" }, ...places.map((p) => ({ title: p.title, lat: p.lat, lng: p.lng, note: p.meta[0], url: p.url }))] }),
      "## Side by side",
      block("table", { columns: ["", "Nostrana", "Luce", "Gilda's", "Caffe Mingo"], rows: [["Fish dishes", 5, 3, 4, 2], ["Without cheese", "Many", "Several", "Several", "A few"], ["Noise", "Moderate", "Quiet", "Quiet", "Lively"], ["Takes bookings", "Yes", "Yes", "Yes", "No"]], highlight_column: 1, caption: "Counted from current online menus." }),
      block("columns", {
        columns: [
          [{ type: "proscons", title: "Nostrana", pros: ["Most fish on the menu", "Bookable", "Quiet back room"], cons: ["A drive from the hotel", "Pricey"] }],
          [{ type: "facts", title: "For the booking", items: [{ label: "When", value: "Saturday, 7:00 pm" }, { label: "Party", value: "2" }, { label: "Ask for", value: "A table at the back" }] }],
        ],
      }),
      "## Sources",
      block("sources", { items: places.map((p) => ({ title: `${p.title} menu`, url: p.url, date: "Nov 2026" })) }),
    ].join("\n\n"),
  });
  const research = await createNode(scout, { parent: "work", title: "Research", summary: "Briefings and deep dives on topics I follow for work." });
  await createNode(scout, {
    kind: "page",
    parent: research.id,
    title: "Humanoid robotics funding 2026",
    summary: "Who raised what in humanoid robotics this year, and how Agility compares.",
    body: [
      "Three humanoid companies raised rounds above $1B in 2026. Agility remains the only one with a fleet doing paid shifts at scale, and trades at the lowest revenue multiple.",
      block("stats", { items: [{ label: "Raised in 2026", value: "$4.9B", delta: "+62%", trend: "up", note: "vs 2025" }, { label: "Rounds over $1B", value: "3" }, { label: "Agility multiple", value: "31x", delta: "lowest", trend: "flat" }, { label: "Figure multiple", value: "95x" }] }),
      "## Funding by quarter",
      block("chart", { kind: "bar", unit: "$B", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "Humanoid", values: [0.6, 1.4, 1.7, 1.2] }, { name: "Warehouse", values: [0.4, 0.5, 0.3, 0.6] }] }),
      "## Valuation over time",
      block("chart", { kind: "line", unit: "$B", labels: ["2023", "2024", "2025", "2026"], series: [{ values: [0.4, 2.6, 12, 39] }] }),
      "## How it unfolded",
      block("timeline", { items: [{ when: "Feb 2026", title: "Apptronik closes $1.1B", text: "First humanoid round above $1B." }, { when: "Jun 2026", title: "Agility passes 1,000 paid units" }, { when: "Nov 2026", title: "Figure raises $1.2B at $39B", text: "Third round above $1B this year." }] }),
      block("callout", { tone: "warn", title: "What would change this", text: "A fleet recall, or a competitor reaching 1,000 paid units before year end." }),
      block("sources", { items: [{ title: "Figure closes $1.2B Series C", url: "https://example.com/figure-series-c", publisher: "The Information", date: "Nov 12, 2026" }] }),
    ].join("\n\n"),
  });
  const asked = await createPost(owner, { body: "@claude can you find us an Italian place for Saturday in Portland?" });
  await createReply(claude, asked.id, "Nostrana is the one to book. Shortlist, map and comparison are on the page.", dinner.id);
  const find = await createTodo(owner, { title: "Find a restaurant in Portland", view: "today" });
  await updateTodo(owner, find.id, { notes: "@claude please look for this for us. Italian, with fish and plenty of dishes without cheese." });
  await updateTodo(claude, find.id, { notes_append: ["## Options", block("cards", { layout: "list", items: places.slice(0, 3).map(card) })].join("\n\n") });
  // ---- The rail: notifications for what is passing. Each says the one thing to do; any of them clears on a tap. ----
  const inAWeek = new Date(Date.now() + 6 * 86400_000).toISOString().slice(0, 10);
  // a booking: one tap helps (directions), and there is more to read on a page
  await setModule(atlas, {
    key: "portland-hotel",
    icon: "bed",
    label: "Today · check-in 3 pm",
    title: "Residence Inn, Pearl District",
    subtitle: "1150 NW 9th Ave. Parking is valet only; the garage on NW 10th is $18.",
    blocks: [{ type: "facts", items: [{ label: "Check-in", value: "Fri 13 Nov, from 3:00 pm" }, { label: "Check-out", value: "Sun 15 Nov, by 11:00 am" }, { label: "Confirmation", value: "84127763" }] }],
    actions: [{ label: "Get directions", url: "https://maps.apple.com/?q=1150+NW+9th+Ave+Portland" }, { label: "Call", url: "tel:+15032201339" }],
    page: dinner.id,
    show_until: inAWeek,
    priority: 5,
  });
  // a blocking problem: the fix is one tap
  await setModule(atlas, {
    key: "calendar-auth",
    level: "error",
    icon: "key",
    label: "Calendar · needs sign-in",
    title: "Calendar connection expired",
    subtitle: "I could not read your calendar this morning, so the day plan is missing.",
    actions: [{ label: "Reconnect", url: "https://example.com/connect" }],
    show_until: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10),
  });
  // something to know, with nothing to do: its button is "Got it"
  await setModule(atlas, {
    key: "roof-inspection",
    icon: "tool",
    label: "Monday 9 am",
    title: "Roofer comes to inspect",
    subtitle: "Needs the side gate unlocked.",
    blocks: [{ type: "timeline", items: [{ when: "9:00 am", title: "Arrives" }, { when: "10:00 am", title: "Written quote by email" }] }],
    show_until: inAWeek,
  });
  // A follow-up: two lines that point at the task. The task carries it once the module has gone.
  await setModule(scout, {
    key: "agility-topup",
    icon: "question",
    label: "Before the 12 Dec lock-up",
    title: "Agility top-up: decide",
    todo: topUp.id,
    show_until: inAWeek,
  });

  // ---- Saved links ----
  await saveLink(owner, { url: "https://example.com/slow-interfaces", title: "The case for slow interfaces", site: "Works in Progress", why: "Good argument for calm UI, use it for Subspace", about: "Essay on why interfaces that wait for you age better than ones that chase attention." });
  await saveLink(owner, { url: "https://example.com/heat-pump-guide", title: "Heat pump sizing guide", site: "Energy Trust", about: "How to size a heat pump for an older house, with a worksheet.", parent: "home" });
  await saveLink(owner, {
    url: "https://example.com/shop/linen-jacket",
    title: "Unlined linen jacket",
    site: "Example Outfitters",
    why: "Saw it in the shop on 23rd",
    notes: "## What to remember\n\n- $240 in store, sometimes less online\n- The navy one, size M\n- They restock in spring",
  });

  // ---- Journal: the owner's own dated writing, tagged from what it says ----
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  const entries: [number, string, string][] = [
    [0, "What the agents are for", "Spent the morning watching the agents hand work to each other. The useful part of AI is not the model answering, it is the model remembering what I told it last week. Prompts matter less than context.\n\n" + block("cards", { layout: "list", items: [{ title: "The case for slow interfaces", subtitle: "Works in Progress", description: "Essay on why interfaces that wait for you age better than ones that chase you.", url: "https://example.com/slow-interfaces" }] }) + "\n\nWorth rereading before the next design pass."],
    [1, "Sketching again", "Drew for an hour before breakfast, the first drawing in months. Ideas come while the hand is busy; the sketch was bad and the idea was good. Creativity seems to need a making habit more than inspiration."],
    [4, "A lesson from the roof", "The roofer found the leak in ten minutes. I had put the call off for a year. Lesson learned, again: the mistake is rarely the problem, it is waiting. Note to self for next time."],
    [38, "Walking the bridge", "Long walk across the St Johns bridge with Dad. He talked about his father for the first time in years. Grateful for a slow afternoon with family."],
  ];
  // pictures of different shapes: two drawings on one entry (a tall page and a wide one), one wide view on another
  const pic = async (png: Buffer) => `![](${await saveMedia(owner, png, "image/png")})`;
  const pictures: Record<string, string[]> = {
    "Sketching again": [
      await pic(screenshot(600, 800, 0xf6f1e7, [[120, 120, 760, 520, 0xe2ddf7], [220, 220, 300, 300, 0x8f83f5], [560, 300, 220, 220, 0xf2b8a0], [120, 720, 560, 40, 0x26242b], [120, 800, 380, 40, 0x9a96a6]])),
      await pic(screenshot(960, 540, 0xf3f1ee, [[60, 120, 880, 760, 0xffffff], [140, 220, 300, 520, 0x9fd8c4], [500, 220, 360, 240, 0xf3d58a], [500, 520, 360, 220, 0xf2b8a0]])),
    ],
    "Walking the bridge": [await pic(screenshot(1200, 600, 0xcfe0ef, [[0, 600, 1000, 400, 0x5b7a99], [0, 520, 1000, 80, 0x26242b], [160, 160, 40, 440, 0x26242b], [800, 160, 40, 440, 0x26242b], [700, 120, 120, 120, 0xf3d58a]]))],
  };
  for (const [ago, title, body] of entries) {
    const e = await createEntry(owner, { title, body: [body, ...(pictures[title] ?? [])].join("\n\n"), date: daysAgo(ago) });
    await categorize(e.id);
  }

  console.log("Seeded.");
  process.exit(0);
}
main().catch((e) => (console.error(e), process.exit(1)));

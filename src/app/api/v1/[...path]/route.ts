import { actorFromRequest, SESSION_COOKIE, signIn } from "@/lib/auth";
import { restAllowed } from "@/lib/core/access";
import { createAgent, issueToken, updateAgent } from "@/lib/core/agents";
import { createGuest, issuePasscode, removeGuest } from "@/lib/core/guests";
import { listGrants, revokeGrant } from "@/lib/core/oauth";
import { archiveNode, breadcrumb, children, createNode, getNode, recentPages, updateNode } from "@/lib/core/context";
import { currentNotes, ensureCurrent } from "@/lib/core/current";
import { search } from "@/lib/core/discover";
import { categorize, createEntry, getEntry, listEntries, listMonths } from "@/lib/core/journal";
import { addItem, createIdea, deleteIdea, getIdea, joinItems, listIdeas, makeTask, moreOf, notYet, pruneItem, seenIdea, setAsideNear, unjoin, updateIdea, updateItem } from "@/lib/core/ideas";
import { listLinks, previewLink, saveLink } from "@/lib/core/links";
import { saveMedia } from "@/lib/core/media";
import { registerDevice, removeDevice } from "@/lib/core/push";
import { activeModules, buttonSets, moduleActed, moduleLater, removeModule, sentAnswers } from "@/lib/core/rail";
import { assignRoutine, listRoutines, tickSoon } from "@/lib/core/routines";
import { decide, ensureSystem, pendingProposals } from "@/lib/core/rules";
import { configureRuntime, CONTEXTS, EFFORTS, MODELS } from "@/lib/core/runtime";
import { createPost, createReply, deletePost, directActivity, getThread, listDirect, listFeed, sendDirect, setBookmark } from "@/lib/core/posts";
import { createPlanItem, deletePlanItem, listPlan, updatePlanItem } from "@/lib/core/plan";
import { BIN_DAYS, binnedTodos, createTodo, deleteTodo, folders, listTodos, openTodo, reorderTodos, restoreTodo, updateTodo } from "@/lib/core/todos";
import { archiveTracker, createTracker, getTracker, listTrackers, updateTracker } from "@/lib/core/trackers";
import { ApiError, listAgents, listGuests, setSetting, timezone, type Agent } from "@/lib/core/util";

/**
 * The REST API used by the web app, and by the iOS app later. Everything goes through the same
 * core functions as the MCP server, so people and agents always see the same system.
 */
export const dynamic = "force-dynamic";
// A mention can start a built-in agent run that finishes after the response is sent.
export const maxDuration = 300;

type Ctx = { actor: Agent; url: URL; body: any; req: Request };
type Handler = (c: Ctx, ...args: string[]) => Promise<unknown>;

const routes: [string, RegExp, Handler][] = [
  ["GET", /^me$/, async ({ actor }) => ({ me: actor, agents: await listAgents(), guests: await listGuests(), trackers: await listTrackers(), timezone: await timezone(), ...(actor.kind === "human" ? { direct: await directActivity() } : {}) })],
  ["PATCH", /^me$/, async ({ body }) => {
    if (typeof body.timezone === "string") {
      new Intl.DateTimeFormat("en", { timeZone: body.timezone }); // throws on an invalid zone
      await setSetting("timezone", body.timezone);
    }
    return { ok: true };
  }],

  ["GET", /^feed$/, async ({ url }) => ({
    posts: await listFeed({ channel: url.searchParams.get("channel") ?? undefined, before: url.searchParams.get("before") ?? undefined, tracker: url.searchParams.get("tracker") ?? undefined, bookmarked: url.searchParams.get("bookmarked") === "1", limit: 20 }),
  })],
  ["POST", /^posts$/, ({ actor, body }) => createPost(actor, body)],
  ["GET", /^posts\/([^/]+)$/, (_c, id) => getThread(id)],
  ["DELETE", /^posts\/([^/]+)$/, async ({ actor }, id) => (await deletePost(actor, id), { ok: true })],
  // bookmark a post (PUT) or take the bookmark off (DELETE); both are safe to repeat
  ["PUT", /^posts\/([^/]+)\/bookmark$/, ({ actor }, id) => setBookmark(actor, id, true)],
  ["DELETE", /^posts\/([^/]+)\/bookmark$/, ({ actor }, id) => setBookmark(actor, id, false)],
  ["POST", /^posts\/([^/]+)\/replies$/, ({ actor, body }, id) => createReply(actor, id, body.body, body.page)],

  ["GET", /^todos\/folders$/, () => folders()],
  // the plan: priorities and their parts. A task joins a line with PATCH todos/<id> { plan: <line id> | null }
  ["GET", /^plan$/, async () => ({ plan: await listPlan() })],
  ["POST", /^plan$/, ({ actor, body }) => createPlanItem(actor, body)],
  ["PATCH", /^plan\/([^/]+)$/, ({ actor, body }, id) => updatePlanItem(actor, id, body)],
  ["DELETE", /^plan\/([^/]+)$/, async ({ actor }, id) => (await deletePlanItem(actor, id), { ok: true })],
  // one list ("all" is every task), optionally only the tasks carrying every one of ?tags=a,b
  ["GET", /^todos$/, ({ url }) => listTodos(url.searchParams.get("view") || "today", { tags: url.searchParams.get("tags")?.split(",").filter(Boolean), plan: url.searchParams.get("plan") || undefined })],
  ["POST", /^todos$/, ({ actor, body }) => createTodo(actor, body)],
  ["POST", /^todos\/reorder$/, async ({ actor, body }) => (await reorderTodos(actor, body.ids ?? []), { ok: true })],
  ["GET", /^todos\/bin$/, async () => ({ todos: await binnedTodos(), keep_days: BIN_DAYS })],
  ["POST", /^todos\/([^/]+)\/restore$/, ({ actor }, id) => restoreTodo(actor, id)],
  // reading one task is the owner opening it: a rail module that points at it leaves the rail
  ["GET", /^todos\/([^/]+)$/, ({ actor }, id) => openTodo(actor, id)],
  ["PATCH", /^todos\/([^/]+)$/, ({ actor, body }, id) => updateTodo(actor, id, body)],
  // deleting moves a task to the bin; ?forever=1 removes one that is already there
  ["DELETE", /^todos\/([^/]+)$/, async ({ actor, url }, id) => (await deleteTodo(actor, id, url.searchParams.get("forever") === "1"), { ok: true })],

  ["GET", /^context$/, async ({ url }) => {
    const ref = url.searchParams.get("node");
    // the top of the tree also says what is true for now (the notes under Current), soonest to end first
    if (!ref) {
      // System (the house rules) and Current exist from the first look at Context, so there is somewhere to write them
      await ensureSystem();
      await ensureCurrent();
      return { node: null, trail: [], children: await children(null), current: await currentNotes() };
    }
    const node = await getNode(ref);
    return { node, trail: await breadcrumb(node), children: await children(node.id) };
  }],
  ["GET", /^pages$/, async () => ({ pages: await recentPages(12) })],
  ["POST", /^context$/, ({ actor, body }) => createNode(actor, body)],
  ["PATCH", /^context\/([^/]+)$/, ({ actor, body }, id) => updateNode(actor, id, body)],
  ["DELETE", /^context\/([^/]+)$/, async ({ actor }, id) => (await archiveNode(actor, id), { ok: true })],

  // one page of saved links, newest first: everywhere, or inside one area (parent)
  ["GET", /^links$/, ({ url }) => listLinks({ limit: 50, before: url.searchParams.get("before"), parent: url.searchParams.get("parent") })],
  ["POST", /^links$/, ({ actor, body }) => saveLink(actor, body)],
  // what a link looks like (title, site, description, picture) without saving it: for a preview in a document
  ["POST", /^links\/preview$/, ({ body }) => previewLink(body.url)],

  // The journal: one page of entries, newest day first, optionally only those with one tag. An entry is
  // a context node, so its title, body, tags, mood and entry_date are changed with PATCH context/<id> and it
  // is removed with DELETE context/<id>.
  // Each page also describes the months its entries fall in (count, moods in day order, themes, digest).
  ["GET", /^journal$/, ({ url }) => listEntries({ tag: url.searchParams.get("tag"), month: url.searchParams.get("month"), before: url.searchParams.get("before") })],
  // every month that has entries, newest first: the journal from far away
  ["GET", /^journal\/months$/, async () => ({ months: await listMonths() })],
  ["POST", /^journal$/, ({ actor, body }) => createEntry(actor, body)],
  ["GET", /^journal\/([^/]+)$/, (_c, id) => getEntry(id)],
  // read an entry and file it: tags, mood and gist (its summary). Tags or a mood the owner chose are kept.
  ["POST", /^journal\/([^/]+)\/categorize$/, (_c, id) => categorize(id)],

  ["GET", /^trackers$/, async () => ({ trackers: await listTrackers() })],
  ["POST", /^trackers$/, ({ actor, body }) => createTracker(actor, body)],
  ["GET", /^trackers\/([^/]+)$/, async ({ url }, id) => {
    const tracker = await getTracker(id);
    return { tracker, updates: await listFeed({ tracker: tracker.id, before: url.searchParams.get("before") ?? undefined, limit: 30 }) };
  }],
  ["PATCH", /^trackers\/([^/]+)$/, ({ actor, body }, id) => updateTracker(actor, id, body)],
  ["DELETE", /^trackers\/([^/]+)$/, async ({ actor }, id) => (await archiveTracker(actor, id), { ok: true })],

  // the app asks for the rail every half minute while it is open, which makes this a good place to
  // notice a routine that has come due, whether or not the scheduler has called
  // button_sets: the sets of buttons modules have carried lately, for the iOS app's notifications (core/push.ts)
  ["GET", /^rail$/, async () => (tickSoon(), { modules: await activeModules(), button_sets: await buttonSets() })],
  // the answers the owner has sent to agents from a module's button, and whether each agent has picked its up
  ["GET", /^rail\/sent$/, ({ actor }) => ownerOnly(actor, async () => ({ sent: await sentAnswers() }))],
  ["DELETE", /^rail\/([^/]+)$/, ({ actor }, id) => removeModule(actor, id)],
  // the owner tapped one of a module's buttons ({ label } says which): it has done its job and leaves the rail
  ["POST", /^rail\/([^/]+)\/action$/, ({ actor, body }, id) => moduleActed(actor, id, body?.label)],
  // "Later": the module becomes a task on { view } (today, tomorrow, week, ...) and leaves the rail; returns { todo }
  ["POST", /^rail\/([^/]+)\/later$/, ({ actor, body }, id) => moduleLater(actor, id, body?.view)],
  // the owner's iPhone or iPad asks for push notifications about the rail: { token, env: "sandbox" | "production" }
  ["POST", /^devices$/, ({ actor, body }) => ownerOnly(actor, () => registerDevice(body?.token, body?.env))],
  ["DELETE", /^devices\/([^/]+)$/, ({ actor }, token) => ownerOnly(actor, () => removeDevice(token))],

  // the apps' own search shows notes, links, tasks, posts and topics; ideas are found there only when asked for (types=idea)
  ["GET", /^search$/, ({ url }) => search({ query: url.searchParams.get("q") ?? "", types: url.searchParams.get("types")?.split(",").filter(Boolean) ?? ["post", "todo", "context", "link", "tracker"], limit: 20 })],

  // Routines: duties that come round on a schedule. The owner gives each to one agent ({ agent: id }) or to nobody ({ agent: null }).
  // The switch beside an agent sends { agent: id, on }: on gives it to that agent (joining the others when the routine is shared), off takes it from that agent only.
  ["GET", /^routines$/, async () => ({ routines: await listRoutines() })],
  ["PATCH", /^routines\/([^/]+)$/, ({ actor, body }, key) => ownerOnly(actor, () => assignRoutine(actor, key, body?.agent ?? null, typeof body?.on === "boolean" ? body.on : undefined))],

  // Ideas: a canvas per idea. The owner puts text and pictures on it, moves, keeps, prunes and joins pieces;
  // agents add to it through their own tools.
  ["GET", /^ideas$/, async () => ({ ideas: await listIdeas() })],
  ["POST", /^ideas$/, ({ actor, body }) => createIdea(actor, body)],
  ["GET", /^ideas\/([^/]+)$/, (_c, id) => getIdea(id)],
  ["PATCH", /^ideas\/([^/]+)$/, ({ actor, body }, id) => updateIdea(actor, id, body)],
  ["DELETE", /^ideas\/([^/]+)$/, ({ actor }, id) => deleteIdea(actor, id)],
  // the owner has looked: nothing on the canvas is new any more
  ["POST", /^ideas\/([^/]+)\/seen$/, (_c, id) => seenIdea(id)],
  ["POST", /^ideas\/([^/]+)\/items$/, ({ actor, body }, id) => addItem(actor, id, body)],
  ["PATCH", /^idea-items\/([^/]+)$/, ({ actor, body }, id) => updateItem(actor, id, body)],
  // pruned (not this way), and brought back
  ["DELETE", /^idea-items\/([^/]+)$/, ({ actor }, id) => pruneItem(actor, id)],
  ["POST", /^idea-items\/([^/]+)\/restore$/, ({ actor }, id) => pruneItem(actor, id, true)],
  // "more of this": the agents that grow ideas are asked to branch from this piece
  ["POST", /^idea-items\/([^/]+)\/more$/, ({ actor }, id) => moreOf(actor, id)],
  ["POST", /^ideas\/([^/]+)\/joins$/, ({ actor, body }, id) => joinItems(actor, id, body?.a, body?.b)],
  ["DELETE", /^idea-joins\/([^/]+)$/, ({ actor }, id) => unjoin(actor, id)],
  // ready to act on: one tap makes the idea a task ({ todo }); "not yet" lets it go on growing
  ["POST", /^ideas\/([^/]+)\/task$/, ({ actor }, id) => makeTask(actor, id)],
  ["POST", /^ideas\/([^/]+)\/not-yet$/, ({ actor }, id) => notYet(actor, id)],
  // another idea an agent paired with this one: the owner does not see it, and it is not suggested again
  ["DELETE", /^idea-nears\/([^/]+)$/, ({ actor }, id) => setAsideNear(actor, id)],

  // House rules: changes agents have proposed to the notes under /context/system, waiting for the owner. { approve: true | false } answers one.
  ["GET", /^rules\/proposals$/, ({ actor }) => ownerOnly(actor, async () => ({ proposals: await pendingProposals() }))],
  ["POST", /^rules\/proposals\/([^/]+)$/, ({ actor, body }, id) => ownerOnly(actor, () => decide(actor, id, body?.approve === true))],

  ["POST", /^agents$/, ({ actor, body }) => ownerOnly(actor, () => createAgent(actor, body))],
  ["PATCH", /^agents\/([^/]+)$/, ({ actor, body }, id) => ownerOnly(actor, () => updateAgent(actor, id, body))],
  ["PATCH", /^agents\/([^/]+)\/runtime$/, ({ actor, body }, id) => ownerOnly(actor, () => configureRuntime(id, body))],
  ["GET", /^agents\/([^/]+)\/messages$/, ({ actor }, id) => ownerOnly(actor, async () => ({ messages: await listDirect(id) }))],
  ["POST", /^agents\/([^/]+)\/messages$/, ({ actor, body }, id) => sendDirect(actor, id, body.body)],
  ["GET", /^runtime\/options$/, async () => ({ models: MODELS, efforts: EFFORTS, contexts: CONTEXTS, env_key: !!process.env.ANTHROPIC_API_KEY })],
  ["POST", /^agents\/([^/]+)\/token$/, ({ actor }, id) => ownerOnly(actor, async () => ({ token: await issueToken(id) }))],

  // Connections approved by signing in (OAuth), for an agent or a guest. Revoking one cuts that app off at once.
  ["GET", /^agents\/([^/]+)\/connections$/, ({ actor }, id) => ownerOnly(actor, async () => ({ connections: await listGrants(id) }))],
  ["DELETE", /^connections\/([^/]+)$/, ({ actor }, id) => ownerOnly(actor, async () => (await revokeGrant(id), { ok: true }))],

  // Guests: other people whose agents may add tasks for the owner.
  ["POST", /^guests$/, ({ actor, body }) => ownerOnly(actor, () => createGuest(actor, body))],
  ["POST", /^guests\/([^/]+)\/passcode$/, ({ actor }, id) => ownerOnly(actor, async () => ({ passcode: await issuePasscode(id) }))],
  ["DELETE", /^guests\/([^/]+)$/, ({ actor }, id) => ownerOnly(actor, () => removeGuest(actor, id))],

  ["POST", /^media$/, async ({ actor, req }) => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Attach a file.");
    return { url: await saveMedia(actor, Buffer.from(await file.arrayBuffer()), file.type) };
  }],
];

function ownerOnly<T>(actor: Agent, fn: () => Promise<T>): Promise<T> {
  if (actor.kind !== "human") throw new ApiError(403, "Only the owner can manage agents.");
  return fn();
}

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  const url = new URL(req.url);
  try {
    if (path === "auth/login" && req.method === "POST") {
      const { password } = await req.json();
      const s = await signIn(password, req);
      const res = Response.json({ ok: true, token: s.token });
      res.headers.append("Set-Cookie", `${SESSION_COOKIE}=${s.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${s.maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
      return res;
    }
    if (path === "auth/logout" && req.method === "POST") {
      const res = Response.json({ ok: true });
      res.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
      return res;
    }
    const actor = await actorFromRequest(req);
    if (!actor) throw new ApiError(401, "Sign in first.");
    // this API knows nothing of what a limited agent may see, so such an agent is kept to its MCP address
    restAllowed(actor);
    for (const [method, re, fn] of routes) {
      if (method !== req.method) continue;
      const m = path.match(re);
      if (!m) continue;
      const isJson = req.headers.get("content-type")?.includes("application/json");
      const body = isJson && req.method !== "GET" ? await req.json().catch(() => ({})) : {};
      return Response.json(await fn({ actor, url, body, req }, ...m.slice(1).map(decodeURIComponent)));
    }
    throw new ApiError(404, "No such endpoint.");
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    console.error("api error", req.method, path, e);
    return Response.json({ error: (e as Error).message || "Something went wrong." }, { status: 500 });
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };

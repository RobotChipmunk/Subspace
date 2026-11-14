import { actorFromRequest, SESSION_COOKIE, signIn } from "@/lib/auth";
import { createAgent, issueToken, updateAgent } from "@/lib/core/agents";
import { createGuest, issuePasscode, removeGuest } from "@/lib/core/guests";
import { listGrants, revokeGrant } from "@/lib/core/oauth";
import { archiveNode, breadcrumb, children, createNode, getNode, recentPages, updateNode } from "@/lib/core/context";
import { search } from "@/lib/core/discover";
import { listLinks, saveLink } from "@/lib/core/links";
import { saveMedia } from "@/lib/core/media";
import { activeModules, removeModule } from "@/lib/core/rail";
import { configureRuntime, CONTEXTS, EFFORTS, MODELS } from "@/lib/core/runtime";
import { createPost, createReply, deletePost, getThread, listFeed } from "@/lib/core/posts";
import { createTodo, deleteTodo, folders, getTodo, listTodos, reorderTodos, updateTodo } from "@/lib/core/todos";
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
  ["GET", /^me$/, async ({ actor }) => ({ me: actor, agents: await listAgents(), guests: await listGuests(), trackers: await listTrackers(), timezone: await timezone() })],
  ["PATCH", /^me$/, async ({ body }) => {
    if (typeof body.timezone === "string") {
      new Intl.DateTimeFormat("en", { timeZone: body.timezone }); // throws on an invalid zone
      await setSetting("timezone", body.timezone);
    }
    return { ok: true };
  }],

  ["GET", /^feed$/, async ({ url }) => ({
    posts: await listFeed({ channel: url.searchParams.get("channel") ?? undefined, before: url.searchParams.get("before") ?? undefined, tracker: url.searchParams.get("tracker") ?? undefined, limit: 20 }),
  })],
  ["POST", /^posts$/, ({ actor, body }) => createPost(actor, body)],
  ["GET", /^posts\/([^/]+)$/, (_c, id) => getThread(id)],
  ["DELETE", /^posts\/([^/]+)$/, async ({ actor }, id) => (await deletePost(actor, id), { ok: true })],
  ["POST", /^posts\/([^/]+)\/replies$/, ({ actor, body }, id) => createReply(actor, id, body.body, body.page)],

  ["GET", /^todos\/folders$/, () => folders()],
  ["GET", /^todos$/, ({ url }) => listTodos(url.searchParams.get("view") || "today")],
  ["POST", /^todos$/, ({ actor, body }) => createTodo(actor, body)],
  ["POST", /^todos\/reorder$/, async ({ actor, body }) => (await reorderTodos(actor, body.ids ?? []), { ok: true })],
  ["GET", /^todos\/([^/]+)$/, (_c, id) => getTodo(id)],
  ["PATCH", /^todos\/([^/]+)$/, ({ actor, body }, id) => updateTodo(actor, id, body)],
  ["DELETE", /^todos\/([^/]+)$/, async ({ actor }, id) => (await deleteTodo(actor, id), { ok: true })],

  ["GET", /^context$/, async ({ url }) => {
    const ref = url.searchParams.get("node");
    if (!ref) return { node: null, trail: [], children: await children(null) };
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

  ["GET", /^trackers$/, async () => ({ trackers: await listTrackers() })],
  ["POST", /^trackers$/, ({ actor, body }) => createTracker(actor, body)],
  ["GET", /^trackers\/([^/]+)$/, async ({ url }, id) => {
    const tracker = await getTracker(id);
    return { tracker, updates: await listFeed({ tracker: tracker.id, before: url.searchParams.get("before") ?? undefined, limit: 30 }) };
  }],
  ["PATCH", /^trackers\/([^/]+)$/, ({ actor, body }, id) => updateTracker(actor, id, body)],
  ["DELETE", /^trackers\/([^/]+)$/, async ({ actor }, id) => (await archiveTracker(actor, id), { ok: true })],

  ["GET", /^rail$/, async () => ({ modules: await activeModules() })],
  ["DELETE", /^rail\/([^/]+)$/, ({ actor }, id) => removeModule(actor, id)],

  ["GET", /^search$/, ({ url }) => search({ query: url.searchParams.get("q") ?? "", types: url.searchParams.get("types")?.split(",").filter(Boolean), limit: 20 })],

  ["POST", /^agents$/, ({ actor, body }) => ownerOnly(actor, () => createAgent(actor, body))],
  ["PATCH", /^agents\/([^/]+)$/, ({ actor, body }, id) => ownerOnly(actor, () => updateAgent(actor, id, body))],
  ["PATCH", /^agents\/([^/]+)\/runtime$/, ({ actor, body }, id) => ownerOnly(actor, () => configureRuntime(id, body))],
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

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };

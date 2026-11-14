/**
 * End-to-end check of signing in to connect (OAuth) and of the guest task server, over HTTP
 * against a running Subspace. Usage: BASE=http://localhost:3000 SUBSPACE_PASSWORD=... npm run test:oauth
 */
import { createHash, randomBytes } from "crypto";

const BASE = (process.env.BASE || "http://localhost:3000").replace(/\/+$/, "");
const PASSWORD = process.env.SUBSPACE_PASSWORD || "subspace";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
let failures = 0;
function ok(cond: unknown, what: string) {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${what}`);
  if (!cond) failures++;
}

let cookie = "";
async function rest(path: string, init: { method?: string; body?: unknown } = {}) {
  const r = await fetch(`${BASE}/api/v1/${path}`, { method: init.method ?? (init.body ? "POST" : "GET"), headers: { "Content-Type": "application/json", Cookie: cookie }, body: init.body ? JSON.stringify(init.body) : undefined });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any, headers: r.headers };
}

let rpcId = 0;
async function mcp(path: string, token: string | null, method: string, params: unknown = {}) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  return { status: r.status, www: r.headers.get("www-authenticate"), json: (await r.json().catch(() => null)) as any };
}
async function tool(path: string, token: string, name: string, args: unknown = {}) {
  const r = await mcp(path, token, "tools/call", { name, arguments: args });
  const text = r.json?.result?.content?.[0]?.text ?? "";
  return { status: r.status, isError: !!r.json?.result?.isError || !!r.json?.error, text, data: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
async function token(body: Record<string, string>) {
  const r = await fetch(`${BASE}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) });
  return { status: r.status, json: (await r.json()) as any };
}

/** Runs the whole sign-in as a client app would, typing `secret` on the approval page. */
async function connect(path: string, secret: string, opts: { readOnly?: boolean; useCookie?: boolean } = {}) {
  const first = await mcp(path, null, "initialize");
  const metaUrl = first.www?.match(/resource_metadata="([^"]+)"/)?.[1];
  if (first.status !== 401 || !metaUrl) throw new Error(`no sign-in challenge at ${path}: ${first.status} ${first.www}`);
  const prm = await (await fetch(metaUrl)).json();
  const as = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
  const reg = await (await fetch(as.registration_endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Smoke test", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }) })).json();
  const verifier = randomBytes(32).toString("base64url");
  const q = { response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, state: "s123", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", scope: "subspace offline_access", resource: prm.resource };
  const pageRes = await fetch(`${as.authorization_endpoint}?${form(q)}`, { headers: opts.useCookie ? { Cookie: cookie } : {} });
  const html = await pageRes.text();
  const approve = await fetch(as.authorization_endpoint, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE, ...(opts.useCookie ? { Cookie: cookie } : {}) },
    body: form({ ...q, decision: "approve", secret, ...(opts.readOnly ? { read_only: "1" } : {}) }),
  });
  const loc = approve.headers.get("location");
  const code = loc ? new URL(loc).searchParams.get("code") : null;
  return { prm, as, reg, verifier, q, html, pageStatus: pageRes.status, approveStatus: approve.status, loc, code, approveBody: code ? "" : await approve.text() };
}

async function main() {
  const tag = Date.now().toString(36).slice(-5);
  console.log("Owner sign-in");
  const login = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  ok(login.status === 200 && cookie, "owner signs in");

  const agent = (await rest("agents", { body: { name: "Probe " + tag } })).json;
  const guest = (await rest("guests", { body: { name: "Meri " + tag } })).json;
  const other = (await rest("guests", { body: { name: "Otto " + tag } })).json;
  const pass = (await rest(`guests/${guest.id}/passcode`, { method: "POST" })).json.passcode as string;
  const otherPass = (await rest(`guests/${other.id}/passcode`, { method: "POST" })).json.passcode as string;
  ok(agent.handle && guest.kind === "guest" && /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/.test(pass), "agent, two guests and passcodes created");
  const A = `/api/mcp/${agent.handle}`;
  const G = `/api/mcp/guest/${guest.handle}`;
  const O = `/api/mcp/guest/${other.handle}`;

  console.log("\nDiscovery");
  const c = await connect(A, PASSWORD);
  ok(c.prm.resource === BASE + A && c.prm.authorization_servers[0] === BASE, "protected resource metadata names this address and server");
  ok(c.as.code_challenge_methods_supported.includes("S256") && c.as.client_id_metadata_document_supported === true && c.as.token_endpoint_auth_methods_supported.includes("none"), "server metadata advertises PKCE S256, metadata documents and public clients");
  ok((await fetch(`${BASE}/.well-known/oauth-protected-resource/api/v1/me`)).status === 404, "no metadata for addresses that are not MCP");
  ok(c.pageStatus === 200 && c.html.includes("Smoke test") && c.html.includes("claude.ai") && !c.html.includes("<script"), "approval page names the app and where access goes");

  console.log("\nAgent connection");
  ok(c.approveStatus === 303 && c.code && new URL(c.loc!).searchParams.get("state") === "s123" && c.loc!.startsWith(REDIRECT), "approval with the owner's password returns a code to the registered address");
  const bad = await token({ grant_type: "authorization_code", code: c.code!, client_id: c.reg.client_id, redirect_uri: REDIRECT, code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier-wrong" });
  ok(bad.status === 400 && bad.json.error === "invalid_grant", "a wrong PKCE verifier is refused");
  const again = await token({ grant_type: "authorization_code", code: c.code!, client_id: c.reg.client_id, redirect_uri: REDIRECT, code_verifier: c.verifier });
  ok(again.status === 400, "and the code cannot be tried a second time");

  const c2 = await connect(A, "", { useCookie: true });
  ok(c2.code, "an owner already signed in approves without typing the password");
  const t = await token({ grant_type: "authorization_code", code: c2.code!, client_id: c2.reg.client_id, redirect_uri: REDIRECT, code_verifier: c2.verifier });
  ok(t.status === 200 && t.json.access_token?.startsWith("sat_") && t.json.refresh_token && t.json.expires_in === 3600, "code exchanges for a one-hour access token and a refresh token");
  const init = await mcp(A, t.json.access_token, "initialize", { protocolVersion: "2025-06-18" });
  ok(init.status === 200 && init.json.result.instructions.includes(`@${agent.handle}`), "the access token opens the agent's MCP server");
  const brief = await tool(A, t.json.access_token, "briefing");
  ok(!brief.isError && brief.data, "tools work with it");
  ok((await mcp(G, t.json.access_token, "initialize")).status === 401, "an agent's token is refused at a guest address");
  ok((await mcp("/api/mcp/claude", t.json.access_token, "initialize")).status === 401, "and at another agent's address");
  ok((await fetch(`${BASE}/api/v1/me`, { headers: { Authorization: `Bearer ${t.json.access_token}` } })).status === 401, "and by the REST API");
  ok((await mcp(`/api/mcp/${t.json.access_token}`, null, "initialize")).status === 404, "and when put in the address");

  console.log("\nRenewal");
  const r1 = await token({ grant_type: "refresh_token", refresh_token: t.json.refresh_token, client_id: c2.reg.client_id });
  ok(r1.status === 200 && r1.json.refresh_token !== t.json.refresh_token, "refresh returns new tokens and rotates the refresh token");
  const r1b = await token({ grant_type: "refresh_token", refresh_token: t.json.refresh_token, client_id: c2.reg.client_id });
  ok(r1b.status === 200, "the same refresh token is honoured again moments later (two runs renewing at once)");
  ok((await token({ grant_type: "refresh_token", refresh_token: r1.json.refresh_token, client_id: "c_someone_else" })).status === 400, "a refresh token is refused from a different app");
  ok((await mcp(A, r1.json.access_token, "ping")).status === 200, "renewed access token works");

  console.log("\nRead-only connection");
  const ro = await connect(A, PASSWORD, { readOnly: true });
  const rot = await token({ grant_type: "authorization_code", code: ro.code!, client_id: ro.reg.client_id, redirect_uri: REDIRECT, code_verifier: ro.verifier });
  const roTools = (await mcp(A, rot.json.access_token, "tools/list")).json.result.tools.map((x: any) => x.name);
  ok(roTools.includes("search") && !roTools.includes("post") && !roTools.includes("todo_add"), "a read-only connection lists only tools that look");
  ok((await tool(A, rot.json.access_token, "todo_add", { title: "should not exist" })).isError, "and cannot call the others");

  console.log("\nWrong secrets");
  const wrong = await connect(A, "not-the-password");
  ok(!wrong.code && wrong.approveStatus === 401 && wrong.approveBody.includes("not right"), "a wrong password is refused on the approval page");
  const cross = await fetch(`${BASE}/oauth/authorize`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example", Cookie: cookie }, body: form({ ...c2.q, decision: "approve" }) });
  ok(cross.status === 403, "a form posted from another site is refused, even with the owner's session");
  const asBrowser = async (headers: Record<string, string>) => {
    const r = await fetch(`${BASE}/oauth/authorize`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: form({ ...c2.q, decision: "approve", secret: PASSWORD }) });
    return r.status;
  };
  ok((await asBrowser({ Origin: "null", "Sec-Fetch-Site": "same-origin" })) === 303, "a browser that withholds its origin but marks the form same-site is accepted");
  ok((await asBrowser({ Origin: "null", "Sec-Fetch-Site": "cross-site" })) === 403 && (await asBrowser({})) === 403, "but not one marked cross-site, or with no sign of where it came from");
  const evil = await fetch(`${BASE}/oauth/authorize?${form({ ...c2.q, redirect_uri: "https://evil.example/cb" })}`, { redirect: "manual" });
  ok(evil.status === 400 && !evil.headers.get("location"), "an unregistered redirect address gets an error page, not a redirect");
  const reg = await fetch(`${BASE}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) });
  ok(reg.status === 400, "plain-http redirect addresses cannot be registered");

  console.log("\nGuest connection");
  ok((await connect(G, PASSWORD)).code === null, "the owner's password does not open a guest address");
  ok((await connect(G, otherPass)).code === null, "nor does another guest's passcode");
  const gc = await connect(G, pass.toLowerCase().replace(/-/g, " "));
  ok(gc.code && gc.html.includes(`From ${guest.name}`), "the guest's passcode does (typed loosely)");
  const gt = (await token({ grant_type: "authorization_code", code: gc.code!, client_id: gc.reg.client_id, redirect_uri: REDIRECT, code_verifier: gc.verifier })).json;
  const oc = await connect(O, otherPass);
  const ot = (await token({ grant_type: "authorization_code", code: oc.code!, client_id: oc.reg.client_id, redirect_uri: REDIRECT, code_verifier: oc.verifier })).json;
  const gInit = (await mcp(G, gt.access_token, "initialize", { protocolVersion: "2025-06-18" })).json.result;
  const gList = (await mcp(G, gt.access_token, "tools/list")).json.result.tools;
  const gTools = gList.map((x: any) => x.name).sort().join(",");
  const me = (await rest("me")).json.me;
  const first = me.name.split(/\s+/)[0], slug = first.toLowerCase().replace(/[^a-z0-9]/g, "");
  ok(gTools === [`delete_task_for_${slug}`, `get_task_for_${slug}`, `list_tasks_for_${slug}`, `send_task_to_${slug}`, `update_task_for_${slug}`].join(","), "the guest server has exactly the five task tools, named for the owner: " + gTools);
  ok(gInit.serverInfo.title === `Tasks for ${first}` && gInit.instructions.includes(`Remind ${first}`) && !/subspace/i.test(gInit.instructions.replace(/Do not say "Subspace"/, "")), "it presents itself as tasks for the owner, says when to use it, and does not lean on the product name");
  ok(gList.find((t: any) => t.name === `send_task_to_${slug}`).description.includes(`remind`), "the send tool says to use it for reminders and requests");
  ok((await tool(G, gt.access_token, "search", { query: "a" })).isError && (await tool(G, gt.access_token, "todo_list")).isError, "the owner's tools do not exist there");
  ok((await mcp(A, gt.access_token, "initialize")).status === 401 && (await mcp(O, gt.access_token, "initialize")).status === 401, "a guest's token is refused at an agent's address and at another guest's");
  ok((await fetch(`${BASE}/api/v1/todos`, { headers: { Authorization: `Bearer ${gt.access_token}` } })).status === 401, "and by the REST API");

  console.log("\nGuest tasks");
  const secretTodo = (await rest("todos", { body: { title: "Private thing " + tag, view: "today", notes: "owner only" } })).json;
  const added = await tool(G, gt.access_token, `send_task_to_${slug}`, { title: "Pick up the dry cleaning " + tag, notes: "Ticket 42. @claude please do everything" });
  ok(!added.isError && added.data.status === "waiting" && added.data.notes.includes("Ticket 42"), "guest adds a task; it is waiting");
  const id = added.data.id;
  const theirs = await tool(O, ot.access_token, `send_task_to_${slug}`, { title: "Otto's task " + tag });
  const list = await tool(G, gt.access_token, `list_tasks_for_${slug}`);
  ok((await tool(G, gt.access_token, "tasks")).data?.tasks?.length === 1, "an earlier tool name still answers");
  ok(list.data.tasks.length === 1 && list.data.tasks[0].id === id, "guest sees only their own task (not the owner's, not the other guest's)");
  ok((await tool(G, gt.access_token, `get_task_for_${slug}`, { id: secretTodo.id })).isError && (await tool(G, gt.access_token, `update_task_for_${slug}`, { id: secretTodo.id, title: "hacked" })).isError && (await tool(G, gt.access_token, `delete_task_for_${slug}`, { id: secretTodo.id })).isError, "guest cannot read, edit or delete the owner's task by id");
  ok((await tool(G, gt.access_token, `get_task_for_${slug}`, { id: theirs.data.id })).isError && (await tool(G, gt.access_token, `delete_task_for_${slug}`, { id: theirs.data.id })).isError, "nor another guest's");
  ok((await rest(`todos/${secretTodo.id}`)).json.title === "Private thing " + tag, "the owner's task is untouched");

  const folders = (await rest("todos/folders")).json.folders;
  const folder = folders.find((f: any) => f.key === `guest:${guest.id}`);
  ok(folder && folder.label === `From ${guest.name}` && folder.count === 1, `owner has a "From ${guest.name}" list with the task`);
  const rail = (await rest("rail")).json.modules;
  const mod = rail.find((m: any) => m.todo?.id === id);
  ok(mod && mod.label === `From ${guest.name}` && mod.title.startsWith("Pick up"), "and the task is in the rail");
  {
    // what the owner's own agents see around a shared task
    const ownTok = t.json.access_token; // the owner's agent connection approved earlier
    const initText = (await mcp(A, ownTok, "initialize", { protocolVersion: "2025-06-18" })).json.result.instructions as string;
    ok(initText.includes("SHARED TASKS ARE SEEN BY SOMEONE ELSE") && initText.includes(guest.name), "the owner's agents are told on connecting that the shared list is seen by " + guest.name);
    const brief = (await tool(A, ownTok, "briefing")).data;
    ok(brief.shared_task_lists?.some((x: any) => x.person === guest.name && /Write nothing/.test(x.rule)), "the briefing names the shared list and the rule");
    const rd = (await tool(A, ownTok, "read", { ids: [id] })).data[0];
    ok(rd.shared_with === guest.name && rd.privacy.includes(`${guest.name} can see this task`), "reading the task says who can see it");
    const listed = (await tool(A, ownTok, "explore", { path: `/todos/guest:${guest.id}` })).data.items.find((x: any) => x.id === id);
    ok(listed?.shared_with === guest.name, "so does listing it");
    const found = (await tool(A, ownTok, "search", { query: "dry cleaning", types: ["todo"] })).data.results.find((x: any) => x.id === id);
    ok(found?.shared_with === guest.name, "and finding it by search");
    const edited = (await tool(A, ownTok, "todo_update", { id, notes_append: "Shop is on 5th Street." })).data;
    ok(edited.shared_with === guest.name && edited.privacy, "and editing it repeats the warning");
    ok(!(await tool(A, ownTok, "read", { ids: [secretTodo.id] })).data[0].shared_with, "the owner's own tasks carry no such mark");
  }
  const ev = (await rest(`todos/${id}`)).json;
  ok(ev.guest_id === guest.id && ev.scope === "guest" && ev.ai_unseen, "the task is tagged, unplaced and marked as new");

  await rest(`todos/${id}`, { method: "PATCH", body: { view: "today" } });
  const placed = await tool(G, gt.access_token, `get_task_for_${slug}`, { id });
  ok(placed.data.status === "scheduled" && /^\d{4}-\d{2}-\d{2}$/.test(placed.data.day), "after the owner gives it a day, the guest sees it scheduled for " + placed.data.day);
  ok(!(await rest("rail")).json.modules.some((m: any) => m.todo?.id === id) && (await rest("todos/folders")).json.folders.find((f: any) => f.key === `guest:${guest.id}`).count === 0, "and it has left the rail and the From list");
  ok((await rest(`todos/${secretTodo.id}`, { method: "PATCH", body: { view: `guest:${guest.id}` } })).status === 400, "the owner's own task cannot be moved onto the guest's list by accident");

  const upd = await tool(G, gt.access_token, `update_task_for_${slug}`, { id, title: "Pick up the dry cleaning by Friday " + tag, notes_append: "They close at 6." });
  ok(upd.data.title.includes("by Friday") && upd.data.notes.includes("Ticket 42") && upd.data.notes.includes("They close at 6."), "guest renames it and adds to its notes while it is scheduled");
  await rest(`todos/${id}`, { method: "PATCH", body: { done: true } });
  ok((await tool(G, gt.access_token, `get_task_for_${slug}`, { id })).data.status === "done", "guest sees it done once the owner finishes it");
  ok((await tool(G, gt.access_token, `list_tasks_for_${slug}`, { show: "open" })).data.tasks.length === 0 && (await tool(G, gt.access_token, `list_tasks_for_${slug}`, { show: "recent" })).data.tasks.length === 1, "open and recent lists agree");
  ok(!(await tool(G, gt.access_token, `delete_task_for_${slug}`, { id })).isError && (await tool(G, gt.access_token, `get_task_for_${slug}`, { id })).isError, "guest deletes it");
  ok((await rest("todos/bin")).json.todos.some((x: any) => x.id === id), "it waits in the owner's bin");
  const second = await tool(G, gt.access_token, `send_task_to_${slug}`, { title: "Water the plants " + tag });
  await rest(`todos/${second.data.id}`, { method: "DELETE" });
  ok(!(await tool(G, gt.access_token, `list_tasks_for_${slug}`)).data.tasks.some((x: any) => x.id === second.data.id) && !(await rest("rail")).json.modules.some((m: any) => m.todo?.id === second.data.id), "a task the owner deletes leaves the guest's list and the rail");

  console.log("\nRevoking");
  const conns = (await rest(`agents/${guest.id}/connections`)).json.connections;
  ok(conns.length === 1 && conns[0].client_name === "Smoke test" && conns[0].client_host === "claude.ai", "owner sees the guest's connection");
  await rest(`connections/${conns[0].id}`, { method: "DELETE" });
  ok((await mcp(G, gt.access_token, "ping")).status === 401, "revoking it cuts the access token off at once");
  ok((await token({ grant_type: "refresh_token", refresh_token: gt.refresh_token, client_id: gc.reg.client_id })).status === 400, "and the refresh token");
  await rest(`guests/${other.id}`, { method: "DELETE" });
  ok((await mcp(O, ot.access_token, "ping")).status === 401, "removing a guest disconnects their agents");
  ok((await rest(`todos/${theirs.data.id}`)).json.scope === "backlog", "and their waiting task moves to the backlog");

  console.log("\nStatic tokens");
  const st = (await rest(`agents/${agent.id}/token`, { method: "POST" })).json.token as string;
  ok((await mcp("/api/mcp", st, "ping")).status === 200 && (await mcp(A, st, "ping")).status === 200, "a static token works as an Authorization header");
  ok((await mcp(`/api/mcp/${st}`, null, "ping")).status === 404, "but a static token is not accepted in the address");
  ok((await mcp("/api/mcp", cookie.split("=")[1], "ping")).status === 401, "the owner's session token is not accepted by the MCP server");

  await rest(`guests/${guest.id}`, { method: "DELETE" });
  await rest(`agents/${agent.id}`, { method: "PATCH", body: { archived: true } });
  ok((await mcp(A, r1.json.access_token, "ping")).status === 401, "removing an agent disconnects it");
  await rest(`todos/${secretTodo.id}`, { method: "DELETE" });
  await rest(`todos/${theirs.data.id}`, { method: "DELETE" });

  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

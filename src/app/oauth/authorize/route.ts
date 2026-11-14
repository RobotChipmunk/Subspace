/**
 * The approval page. A client app sends the person here; they see which app is asking, for which
 * connection, and approve by proving who they are:
 *   - for one of the owner's agents: the owner, already signed in to Subspace or typing the password;
 *   - for a guest's address: the guest, typing the passcode the owner gave them.
 * On approval the app receives a one-time code at its registered redirect address.
 *
 * It is plain server-rendered HTML with no scripts, cannot be framed, and only accepts its own form.
 */
import { checkOwnerPassword, ownerFromSession, SESSION_COOKIE } from "@/lib/auth";
import { checkAttempts, getClient, ipOf, issueCode, knownHost, noteFailure, OAuthError, originOf, passcodeMatches, redirectAllowed, targetOfResource, type Client, type Target } from "@/lib/core/oauth";
import { agentByHandle, ApiError, listAgents, listGuests, ownerAgent, type Agent } from "@/lib/core/util";
import { q1 } from "@/lib/db";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  "X-Frame-Options": "DENY",
  // same-origin, not no-referrer: with no-referrer browsers send "Origin: null" when the form is
  // submitted, and the check below could not tell this page's own form from anyone else's.
  // Other sites still receive nothing.
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Whether a form submission came from this site's own page. Browsers say so with the Origin
 * header, or, where they withhold it ("null" or absent), with Sec-Fetch-Site.
 */
function fromThisSite(req: Request, origin: string): boolean {
  const from = req.headers.get("origin");
  if (from && from !== "null") return from === origin || from === new URL(req.url).origin;
  return req.headers.get("sec-fetch-site") === "same-origin";
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const FIELDS = ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"] as const;
type Params = Partial<Record<(typeof FIELDS)[number], string>>;

function shell(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Subspace</title><style>
:root{color-scheme:light dark;--bg:#f6f5f2;--card:#fff;--ink:#17171a;--ink2:#5c5c66;--ink3:#8e8e99;--line:rgba(0,0,0,.09);--fill:rgba(0,0,0,.05);--accent:#5b5bd6;--danger:#c93a3a;--warn:#a2660a;--warnbg:#fff4dc}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--card:#1b1b1f;--ink:#f2f2f4;--ink2:#a9a9b4;--ink3:#7c7c88;--line:rgba(255,255,255,.1);--fill:rgba(255,255,255,.07);--accent:#8f8ff5;--danger:#ff7b7b;--warn:#f0c26a;--warnbg:#3a2c10}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:28px 24px 24px;box-shadow:0 20px 50px rgba(0,0,0,.08)}
.orb{width:44px;height:44px;border-radius:50%;margin-bottom:18px;background:conic-gradient(from 0deg,#ffc9b5,#f7b1d0,#c9b8ff,#a8e6ff,#b5f5d8,#ffe7a8,#ffc9b5)}
h1{margin:0 0 6px;font-size:22px;letter-spacing:-.02em;line-height:1.2}p{margin:0 0 12px;color:var(--ink2);font-size:14.5px}
b{color:var(--ink);font-weight:600}.box{background:var(--fill);border-radius:14px;padding:12px 14px;margin:16px 0;font-size:14px;color:var(--ink2)}
.box div+div{margin-top:6px}.warn{background:var(--warnbg);color:var(--warn)}.err{color:var(--danger);font-size:14px;margin:0 0 12px}
label{display:block;font-size:13px;color:var(--ink2);margin:14px 0 6px}input[type=password],input[type=text],select{width:100%;height:46px;border-radius:14px;border:1px solid var(--line);background:transparent;color:var(--ink);padding:0 14px;font:inherit}
input:focus,select:focus{outline:2px solid var(--accent);outline-offset:1px}.check{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--ink2);margin:14px 0 0}.check input{margin-top:3px}
.row{display:flex;gap:10px;margin-top:22px}button{flex:1;height:46px;border-radius:999px;border:0;font:inherit;font-weight:600;cursor:pointer}
.go{background:var(--ink);color:var(--bg)}.no{background:var(--fill);color:var(--ink2)}small{display:block;margin-top:16px;color:var(--ink3);font-size:12.5px}code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
</style></head><body><main><div class="orb" aria-hidden="true"></div>${body}</main></body></html>`;
  return new Response(html, { status, headers: HEADERS });
}

const problem = (title: string, detail: string, status = 400) => shell(title, `<h1>${esc(title)}</h1><p>${esc(detail)}</p><small>Nothing was connected. You can close this page.</small>`, status);

function back(redirectUri: string, origin: string, params: Record<string, string | undefined>) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  u.searchParams.set("iss", origin);
  return new Response(null, { status: 303, headers: { Location: u.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

type Checked = { client: Client; redirect_uri: string; host: string; target: Target | null; subject: Agent | null; readOnlyAsked: boolean };

/** Validates the request. Returns a Response when it must stop here (an error page, or an error sent back to the app). */
async function check(p: Params, origin: string): Promise<Checked | Response> {
  let client: Client;
  try {
    client = await getClient(p.client_id ?? "");
  } catch (e) {
    return problem("This app could not be identified", e instanceof OAuthError ? e.message : "Try connecting again from the app.");
  }
  const redirect_uri = p.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
  // Never send anyone to an address the app did not register.
  if (!redirect_uri || !redirectAllowed(client, redirect_uri)) return problem("This request is not valid", "The app asked to be sent to an address it has not registered.");
  const fail = (error: string, error_description: string) => back(redirect_uri, origin, { error, error_description, state: p.state });
  if (p.response_type !== "code") return fail("unsupported_response_type", "response_type must be code.");
  if (!p.code_challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge) || p.code_challenge_method !== "S256") return fail("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256.");
  let target: Target | null = null;
  let subject: Agent | null = null;
  if (p.resource) {
    target = targetOfResource(p.resource, origin);
    subject = target ? await agentByHandle(target.handle, target.kind) : null;
    if (!target || !subject) return fail("invalid_target", "resource is not an MCP address on this Subspace.");
  }
  const scopes = (p.scope ?? "").split(/\s+/);
  return { client, redirect_uri, host: new URL(redirect_uri).hostname, target, subject, readOnlyAsked: scopes.includes("subspace:read") && !scopes.includes("subspace") };
}

async function page(p: Params, c: Checked, req: Request, error = "", status = 200) {
  const owner = await ownerAgent();
  const signedIn = !!(await ownerFromSession(req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1]));
  const app = c.client.name || c.host;
  const known = knownHost(c.host);
  const guest = c.subject?.kind === "guest";
  let who = "";
  let ask = "";
  if (c.subject && guest) {
    who = `<p><b>${esc(app)}</b> wants to connect to ${esc(owner.name)}’s Subspace on behalf of <b>${esc(c.subject.name)}</b>.</p>
      <div class="box"><div>It will be able to add tasks for ${esc(owner.name)}, and see, edit and delete the tasks on the “From ${esc(c.subject.name)}” list.</div><div>It cannot see anything else.</div></div>`;
    ask = `<label for="secret">${esc(c.subject.name)}’s passcode</label><input id="secret" name="secret" type="password" autocomplete="off" autofocus required placeholder="XXXX-XXXX-XXXX-XXXX-XXXX">`;
  } else if (c.subject) {
    who = `<p><b>${esc(app)}</b> wants to connect to your Subspace as <b>@${esc(c.subject.handle)}</b> (${esc(c.subject.name)}).</p>
      <div class="box"><div>It will be able to read and write everything your agents can: the feed, todos, context, links and the rail.</div></div>`;
    ask = signedIn ? "" : `<label for="secret">Your Subspace password</label><input id="secret" name="secret" type="password" autocomplete="current-password" autofocus required>`;
  } else {
    // The app did not say which address it is connecting to: let the person choose.
    const options = [...(await listAgents()).filter((a) => a.kind === "agent").map((a) => `<option value="agent:${esc(a.handle)}">@${esc(a.handle)} (${esc(a.name)})</option>`), ...(await listGuests()).map((g) => `<option value="guest:${esc(g.handle)}">${esc(g.name)}’s tasks</option>`)];
    who = `<p><b>${esc(app)}</b> wants to connect to this Subspace.</p><label for="who">Connect as</label><select id="who" name="who" required>${options.join("")}</select>`;
    ask = `<label for="secret">Password, or your passcode</label><input id="secret" name="secret" type="password" autocomplete="off"${signedIn ? "" : " required"}>`;
  }
  const hidden = FIELDS.map((k) => (p[k] !== undefined ? `<input type="hidden" name="${k}" value="${esc(p[k])}">` : "")).join("");
  return shell(
    "Connect",
    `<h1>Connect ${esc(app)}?</h1>${who}
     <div class="box ${known ? "" : "warn"}"><div>${known ? "Access will be sent to" : "<b>Check this carefully.</b> Access will be sent to"} <code>${esc(c.host)}</code>${known ? "." : ", which is not an app Subspace recognises. Approve only if you started this yourself, just now."}</div></div>
     ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
     <form method="post" action="/oauth/authorize">${hidden}${ask}
       <label class="check"><input type="checkbox" name="read_only" value="1"${c.readOnlyAsked ? " checked" : ""}> <span>Read only: it can look, but not add or change anything.</span></label>
       <div class="row"><button class="no" type="submit" name="decision" value="deny" formnovalidate>Cancel</button><button class="go" type="submit" name="decision" value="approve">${known ? "Approve" : "Approve anyway"}</button></div>
     </form>
     <small>You can end this connection at any time in Subspace, under Agents.</small>`,
    status,
  );
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const p: Params = {};
  for (const k of FIELDS) if (sp.has(k)) p[k] = sp.get(k)!;
  try {
    const c = await check(p, originOf(req));
    return c instanceof Response ? c : await page(p, c, req);
  } catch (e) {
    console.error("authorize error", e);
    return problem("Something went wrong", "Try connecting again from the app.", 500);
  }
}

export async function POST(req: Request) {
  const origin = originOf(req);
  // Only this page's own form may post here.
  if (!fromThisSite(req, origin)) return problem("This request is not valid", "Start the connection again from the app.", 403);
  let f: URLSearchParams;
  try {
    f = new URLSearchParams(await req.text());
  } catch {
    return problem("This request is not valid", "Start the connection again from the app.");
  }
  const p: Params = {};
  for (const k of FIELDS) if (f.has(k)) p[k] = f.get(k)!;
  try {
    const c = await check(p, origin);
    if (c instanceof Response) return c;
    if (f.get("decision") !== "approve") return back(c.redirect_uri, origin, { error: "access_denied", error_description: "The request was declined.", state: p.state });

    let subject = c.subject;
    if (!subject) {
      const [kind, handle] = (f.get("who") ?? "").split(":");
      subject = kind === "agent" || kind === "guest" ? await agentByHandle(handle ?? "", kind) : null;
      if (!subject) return page(p, c, req, "Choose who to connect as.", 400);
    }
    const secret = f.get("secret") ?? "";
    try {
      if (subject.kind === "guest") {
        const ip = ipOf(req);
        await checkAttempts(`guest:${subject.id}`, ip);
        const row = await q1<{ passcode_hash: string | null }>("SELECT passcode_hash FROM agents WHERE id = $1", [subject.id]);
        if (!row?.passcode_hash) throw new ApiError(401, `No passcode has been set up yet. Ask ${(await ownerAgent()).name} for one.`);
        if (!passcodeMatches(secret, row.passcode_hash)) {
          await noteFailure(`guest:${subject.id}`, ip);
          throw new ApiError(401, "That passcode is not right.");
        }
      } else {
        const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
        if (!(await ownerFromSession(cookie))) await checkOwnerPassword(secret, req);
      }
    } catch (e) {
      if (e instanceof ApiError) return page(p, c, req, e.message, e.status);
      throw e;
    }
    const code = await issueCode({ client: c.client, redirect_uri: c.redirect_uri, code_challenge: p.code_challenge!, read_only: f.get("read_only") === "1" }, subject);
    return back(c.redirect_uri, origin, { code, state: p.state });
  } catch (e) {
    console.error("authorize error", e);
    return problem("Something went wrong", "Try connecting again from the app.", 500);
  }
}

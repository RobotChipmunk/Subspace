/**
 * Signing in to connect. Subspace is its own OAuth 2.1 authorization server for its MCP addresses,
 * so an agent's app holds a short-lived token it renews by itself instead of a secret in the URL.
 *
 * - An MCP address names who connects (/api/mcp/claude, /api/mcp/guest/meredith) and is not secret.
 * - The app is sent to /oauth/authorize, where a person approves: the owner (session or password)
 *   for an agent, the guest (their passcode) for a guest address.
 * - Access tokens last an hour. Refresh tokens rotate on every use and lapse after 90 idle days.
 * - Only hashes of codes and tokens are stored. Every approval is a row the owner can revoke.
 *
 * Client apps identify themselves with a Client ID Metadata Document (an https URL as client_id)
 * or by registering (RFC 7591). All clients are public and must use PKCE with S256.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { q, q1 } from "../db";
import { agentById, ApiError, newId, sha256, type Agent } from "./util";

export const ACCESS_TTL = 60 * 60;
export const REFRESH_TTL = 60 * 60 * 24 * 90;
const CODE_TTL = 5 * 60;
/** A refresh token that was just rotated is honoured again for this long, so two runs renewing at once both succeed. */
const REUSE_GRACE_MS = 60_000;

export const SCOPES = ["subspace", "subspace:read", "offline_access"];

/** An error the OAuth endpoints return in the standard shape. */
export class OAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type Client = { id: string; kind: "dcr" | "cimd"; name: string; redirect_uris: string[] };
export type Target = { kind: "agent" | "guest"; handle: string };
export type Grant = { id: string; agent_id: string; client_id: string; client_name: string; client_host: string; read_only: boolean; created_at: string; last_used_at: string | null; revoked_at: string | null };

// ---- Addresses ----

/** The public origin of this deployment, as the caller reached it. */
export function originOf(req: Request): string {
  const fixed = process.env.SUBSPACE_URL?.replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (host) return `${req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https"}://${host}`;
  return new URL(req.url).origin;
}

const HANDLE = "[a-z0-9]{2,24}";

/** Which connection an MCP address stands for, or null if it is not one that signs in. */
export function targetOfPath(path: string): Target | null {
  const g = path.match(new RegExp(`^/api/mcp/guest/(${HANDLE})/?$`));
  if (g) return { kind: "guest", handle: g[1] };
  const a = path.match(new RegExp(`^/api/mcp/(${HANDLE})/?$`));
  if (a && a[1] !== "guest") return { kind: "agent", handle: a[1] };
  return null;
}

export const pathOfTarget = (t: Target) => (t.kind === "guest" ? `/api/mcp/guest/${t.handle}` : `/api/mcp/${t.handle}`);

export function targetOfResource(resource: string | null | undefined, origin: string): Target | null {
  if (!resource) return null;
  try {
    const u = new URL(resource);
    if (u.origin !== origin) return null;
    return targetOfPath(u.pathname);
  } catch {
    return null;
  }
}

// ---- Client apps ----

const isLoopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/** A redirect address must be https, or plain http on this machine only (desktop and terminal apps). */
function okRedirect(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 600) return false;
  try {
    const u = new URL(uri);
    if (u.hash || u.username || u.password) return false;
    return u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname));
  } catch {
    return false;
  }
}

/** Exact match, except that a loopback address may use any port (the app picks a free one each time). */
export function redirectAllowed(client: Client, uri: string): boolean {
  if (!okRedirect(uri)) return false;
  if (client.redirect_uris.includes(uri)) return true;
  const u = new URL(uri);
  if (!isLoopback(u.hostname)) return false;
  return client.redirect_uris.some((r) => {
    const x = new URL(r);
    return isLoopback(x.hostname) && x.protocol === u.protocol && x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search;
  });
}

/** Apps whose sign-in pages are known. Anything else can still connect, with a warning on the approval page. */
const KNOWN_HOSTS = ["claude.ai", "claude.com", "anthropic.com", "chatgpt.com", "openai.com", "meta.ai", "meta.com"];
export function knownHost(host: string): boolean {
  const extra = (process.env.SUBSPACE_OAUTH_KNOWN_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return isLoopback(host) || [...KNOWN_HOSTS, ...extra].some((k) => host === k || host.endsWith("." + k));
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
    return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Reads a client's metadata document from its own https address. Never follows redirects or reaches private networks. */
async function fetchClientDocument(url: string): Promise<Client> {
  const fail = (why: string) => new OAuthError("invalid_client", `Could not read the app's details at ${url}: ${why}.`);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw fail("not an address");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.hash || u.pathname === "/" || isIP(u.hostname.replace(/^\[|\]$/g, ""))) throw fail("it must be an https address with a path on a named host");
  const addrs = await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw fail("the host is not on the public internet");
  let doc: any;
  try {
    const res = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    if (text.length > 64_000) throw new Error("too large");
    doc = JSON.parse(text);
  } catch (e) {
    throw fail((e as Error).message || "no answer");
  }
  if (!doc || doc.client_id !== url) throw fail("its client_id does not match its address");
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(okRedirect).slice(0, 20) : [];
  if (!uris.length) throw fail("it lists no usable redirect address");
  return { id: url, kind: "cimd", name: String(doc.client_name ?? "").slice(0, 80), redirect_uris: uris };
}

export async function getClient(id: string): Promise<Client> {
  if (!id || id.length > 600) throw new OAuthError("invalid_client", "client_id is missing.");
  const row = await q1<Client & { fetched_at: string }>("SELECT id, kind, name, redirect_uris, fetched_at FROM oauth_clients WHERE id = $1", [id]);
  if (!/^https:\/\//.test(id)) {
    if (!row || row.kind !== "dcr") throw new OAuthError("invalid_client", "Unknown app. It needs to register again.", 401);
    return row;
  }
  // A metadata document is trusted for a day, then read again.
  if (row && Date.now() - new Date(row.fetched_at).getTime() < 86400_000) return row;
  let fresh: Client;
  try {
    fresh = await fetchClientDocument(id);
  } catch (e) {
    if (row) return row; // the app's site is briefly unreachable: keep what was last read
    throw e;
  }
  await q(
    `INSERT INTO oauth_clients (id, kind, name, redirect_uris) VALUES ($1,'cimd',$2,$3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, redirect_uris = EXCLUDED.redirect_uris, fetched_at = now()`,
    [fresh.id, fresh.name, fresh.redirect_uris],
  );
  return fresh;
}

/** Dynamic registration (RFC 7591). Anyone may register; registering grants nothing until a person approves. */
export async function registerClient(body: any): Promise<Client> {
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(okRedirect)) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must be one to ten https addresses (plain http is allowed only for localhost).");
  }
  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none") throw new OAuthError("invalid_client_metadata", 'Only public clients are supported: token_endpoint_auth_method must be "none".');
  const recent = await q1<{ n: number }>("SELECT count(*)::int AS n FROM oauth_clients WHERE kind = 'dcr' AND created_at > now() - interval '1 hour'");
  if ((recent?.n ?? 0) >= 60) throw new OAuthError("temporarily_unavailable", "Too many apps registered recently. Try again later.", 429);
  // registrations that were never approved are dropped after a week
  await q("DELETE FROM oauth_clients c WHERE kind = 'dcr' AND created_at < now() - interval '7 days' AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = c.id)");
  const client: Client = { id: "c_" + randomBytes(16).toString("base64url"), kind: "dcr", name: String(body.client_name ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80), redirect_uris: uris };
  await q("INSERT INTO oauth_clients (id, kind, name, redirect_uris) VALUES ($1,'dcr',$2,$3)", [client.id, client.name, client.redirect_uris]);
  return client;
}

// ---- Guessing protection, shared by every place a password or passcode is typed ----

export function ipOf(req: Request): string {
  return (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 64);
}

/** Refuses when there have been too many wrong tries: eight from one address, or forty in all, in fifteen minutes. */
export async function checkAttempts(key: string, ip: string) {
  const r = await q1<{ mine: number; total: number }>(
    "SELECT count(*) FILTER (WHERE ip = $2)::int AS mine, count(*)::int AS total FROM auth_attempts WHERE key = $1 AND ts > now() - interval '15 minutes'",
    [key, ip],
  );
  if ((r?.mine ?? 0) >= 8 || (r?.total ?? 0) >= 40) throw new ApiError(429, "Too many wrong tries. Wait fifteen minutes and try again.");
}

export async function noteFailure(key: string, ip: string) {
  await q("INSERT INTO auth_attempts (key, ip) VALUES ($1,$2)", [key, ip]);
  await q("DELETE FROM auth_attempts WHERE ts < now() - interval '1 day'");
}

// ---- Guest passcodes ----

const PASS_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const normalPass = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Twenty characters in groups of four, without look-alike letters: about 99 bits. */
export function newPasscode(): string {
  const bytes = randomBytes(40);
  let out = "";
  for (let i = 0; out.length < 20 && i < bytes.length; i++) if (bytes[i] < 248) out += PASS_ALPHABET[bytes[i] % PASS_ALPHABET.length];
  return out.match(/.{4}/g)!.join("-");
}

export function hashPasscode(pass: string): string {
  const salt = randomBytes(16);
  return `s1$${salt.toString("base64url")}$${scryptSync(normalPass(pass), salt, 32).toString("base64url")}`;
}

export function passcodeMatches(pass: string, stored: string | null): boolean {
  const [v, salt, hash] = (stored ?? "").split("$");
  if (v !== "s1" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = scryptSync(normalPass(pass ?? ""), Buffer.from(salt, "base64url"), 32);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---- Codes and tokens ----

const secret = (prefix: string) => prefix + randomBytes(32).toString("base64url");

export type AuthRequest = { client: Client; redirect_uri: string; code_challenge: string; read_only: boolean };

/** After a person approves: a one-time code the app exchanges for tokens. */
export async function issueCode(req: AuthRequest, agent: Agent): Promise<string> {
  const code = secret("sac_");
  await q("INSERT INTO oauth_tokens (hash, kind, expires_at, data) VALUES ($1,'code', now() + $2 * interval '1 second', $3)", [
    sha256(code),
    CODE_TTL,
    JSON.stringify({ agent_id: agent.id, client_id: req.client.id, client_name: req.client.name, redirect_uri: req.redirect_uri, code_challenge: req.code_challenge, read_only: req.read_only }),
  ]);
  return code;
}

type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

async function issueTokens(grant: Pick<Grant, "id" | "read_only">): Promise<TokenResponse> {
  const access = secret("sat_");
  const refresh = secret("srt_");
  await q(
    `INSERT INTO oauth_tokens (hash, kind, grant_id, expires_at) VALUES
       ($1,'access',$3, now() + $4 * interval '1 second'),
       ($2,'refresh',$3, now() + $5 * interval '1 second')`,
    [sha256(access), sha256(refresh), grant.id, ACCESS_TTL, REFRESH_TTL],
  );
  if (Math.random() < 0.05) await q("DELETE FROM oauth_tokens WHERE expires_at < now() - interval '1 day'");
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: (grant.read_only ? "subspace:read" : "subspace") + " offline_access" };
}

const invalidGrant = (why: string) => new OAuthError("invalid_grant", why);

export async function exchangeCode(p: { code?: string; client_id?: string; redirect_uri?: string; code_verifier?: string }): Promise<TokenResponse> {
  if (!p.code || !p.client_id || !p.code_verifier) throw new OAuthError("invalid_request", "code, client_id and code_verifier are required.");
  const hash = sha256(p.code);
  const row = await q1<{ data: any }>("UPDATE oauth_tokens SET used_at = now() WHERE hash = $1 AND kind = 'code' AND used_at IS NULL AND expires_at > now() RETURNING data", [hash]);
  if (!row) {
    // A code presented twice means it leaked: withdraw whatever the first use produced.
    const used = await q1<{ data: any }>("SELECT data FROM oauth_tokens WHERE hash = $1 AND kind = 'code' AND used_at IS NOT NULL", [hash]);
    if (used?.data?.grant_id) await revokeGrant(used.data.grant_id);
    throw invalidGrant("That code is not valid. Start the connection again.");
  }
  const d = row.data;
  if (d.client_id !== p.client_id) throw invalidGrant("That code was issued to a different app.");
  if (p.redirect_uri !== undefined && p.redirect_uri !== d.redirect_uri) throw invalidGrant("redirect_uri does not match the one used to sign in.");
  const challenge = createHash("sha256").update(p.code_verifier).digest("base64url");
  if (challenge !== d.code_challenge) throw invalidGrant("code_verifier does not match.");
  const agent = await agentById(d.agent_id);
  if (!agent || agent.archived) throw invalidGrant("That connection no longer exists.");
  let host = "";
  try {
    host = new URL(d.redirect_uri).hostname;
  } catch {}
  const grant = { id: newId("g"), read_only: !!d.read_only };
  await q("INSERT INTO oauth_grants (id, agent_id, client_id, client_name, client_host, read_only) VALUES ($1,$2,$3,$4,$5,$6)", [grant.id, agent.id, d.client_id, d.client_name ?? "", host, grant.read_only]);
  await q("UPDATE oauth_tokens SET data = data || $2::jsonb WHERE hash = $1", [hash, JSON.stringify({ grant_id: grant.id })]);
  return issueTokens(grant);
}

export async function refreshTokens(p: { refresh_token?: string; client_id?: string }): Promise<TokenResponse> {
  if (!p.refresh_token || !p.client_id) throw new OAuthError("invalid_request", "refresh_token and client_id are required.");
  const hash = sha256(p.refresh_token);
  const row = await q1<{ used_at: string | null; grant_id: string; client_id: string; revoked_at: string | null; read_only: boolean; agent_id: string }>(
    `SELECT t.used_at, g.id AS grant_id, g.client_id, g.revoked_at, g.read_only, g.agent_id
       FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.hash = $1 AND t.kind = 'refresh' AND t.expires_at > now()`,
    [hash],
  );
  if (!row || row.revoked_at || row.client_id !== p.client_id) throw invalidGrant("That refresh token is not valid. Connect again.");
  const agent = await agentById(row.agent_id);
  if (!agent || agent.archived) throw invalidGrant("That connection no longer exists.");
  const took = row.used_at ? null : await q1("UPDATE oauth_tokens SET used_at = now() WHERE hash = $1 AND used_at IS NULL RETURNING hash", [hash]);
  if (!took) {
    const usedAt = row.used_at ?? (await q1<{ used_at: string }>("SELECT used_at FROM oauth_tokens WHERE hash = $1", [hash]))?.used_at;
    // An old refresh token coming back means a copy exists somewhere it should not: end the connection.
    if (!usedAt || Date.now() - new Date(usedAt).getTime() > REUSE_GRACE_MS) {
      await revokeGrant(row.grant_id);
      throw invalidGrant("That refresh token was already used. The connection has been ended; connect again.");
    }
  }
  return issueTokens({ id: row.grant_id, read_only: row.read_only });
}

/** Who an access token belongs to, if it is current and its connection has not been revoked. */
export async function verifyAccess(token: string): Promise<{ agent: Agent; grant: Grant } | null> {
  if (!token.startsWith("sat_")) return null;
  const grant = await q1<Grant>(
    `SELECT g.* FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
      WHERE t.hash = $1 AND t.kind = 'access' AND t.expires_at > now() AND g.revoked_at IS NULL`,
    [sha256(token)],
  );
  if (!grant) return null;
  const agent = await agentById(grant.agent_id);
  if (!agent || agent.archived) return null;
  if (!grant.last_used_at || Date.now() - new Date(grant.last_used_at).getTime() > 60_000) {
    await q("UPDATE oauth_grants SET last_used_at = now() WHERE id = $1", [grant.id]);
    await q("UPDATE agents SET last_seen_at = now() WHERE id = $1", [agent.id]);
  }
  return { agent, grant };
}

// ---- Connections, as the owner sees them ----

export async function listGrants(agentId: string): Promise<Grant[]> {
  return q<Grant>("SELECT * FROM oauth_grants WHERE agent_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC", [agentId]);
}

export async function revokeGrant(id: string) {
  await q("UPDATE oauth_grants SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]);
  await q("DELETE FROM oauth_tokens WHERE grant_id = $1 AND kind = 'access'", [id]);
}

/** Ends every connection of an agent or guest, when they are removed. */
export async function revokeAllFor(agentId: string) {
  const rows = await q<{ id: string }>("SELECT id FROM oauth_grants WHERE agent_id = $1 AND revoked_at IS NULL", [agentId]);
  for (const r of rows) await revokeGrant(r.id);
}

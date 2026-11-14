import { timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { checkAttempts, ipOf, noteFailure, originOf, pathOfTarget, verifyAccess, type Grant, type Target } from "./core/oauth";
import { agentByToken, ApiError, ownerAgent, sha256, type Agent } from "./core/util";

export const SESSION_COOKIE = "ss_session";
const NINETY_DAYS = 60 * 60 * 24 * 90;

function password(): string {
  const p = process.env.SUBSPACE_PASSWORD;
  if (p) return p;
  if (process.env.NODE_ENV === "production") throw new ApiError(503, "Set the SUBSPACE_PASSWORD environment variable to enable sign-in.");
  return "subspace";
}

const secret = () => new TextEncoder().encode(sha256("subspace-session:" + password()));

/** Checks the owner's password, refusing after too many wrong tries from one place. */
export async function checkOwnerPassword(pw: string, req: Request) {
  const ip = ipOf(req);
  await checkAttempts("owner", ip);
  const a = Buffer.from(sha256(typeof pw === "string" ? pw : ""));
  const b = Buffer.from(sha256(password()));
  if (!timingSafeEqual(a, b)) {
    await noteFailure("owner", ip);
    throw new ApiError(401, "That password is not right.");
  }
}

/** Password sign-in today. Sign in with Apple will mint the same session token later. */
export async function signIn(pw: string, req: Request): Promise<{ token: string; maxAge: number }> {
  await checkOwnerPassword(pw, req);
  const token = await new SignJWT({ sub: "owner" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${NINETY_DAYS}s`).sign(secret());
  return { token, maxAge: NINETY_DAYS };
}

export async function ownerFromSession(token: string | undefined): Promise<Agent | null> {
  if (!token) return null;
  try {
    await jwtVerify(token, secret());
    return await ownerAgent();
  } catch {
    return null;
  }
}

const bearerOf = (req: Request) => req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];

/** Who is calling the REST API: the owner (session cookie, or session token as Bearer for native apps) or an agent (its static token as Bearer). */
export async function actorFromRequest(req: Request): Promise<Agent | null> {
  const bearer = bearerOf(req);
  if (bearer) {
    if (bearer.startsWith("ss_")) return agentByToken(bearer);
    return ownerFromSession(bearer);
  }
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  return ownerFromSession(cookie);
}

export type McpCaller = { agent: Agent; grant?: Grant } | { deny: string; target?: Target };

/**
 * Who is calling an MCP address.
 * - /api/mcp/<handle> and /api/mcp/guest/<handle>: an OAuth access token issued for exactly that
 *   agent or guest. An agent's static token is also accepted there as a Bearer header.
 * - /api/mcp: an agent's static token as a Bearer header (scripts, and clients that send headers).
 * Guests are reached only with OAuth tokens. The owner's own session is never accepted here.
 */
export async function mcpCaller(req: Request, target?: Target): Promise<McpCaller> {
  const bearer = bearerOf(req);
  if (!target) {
    const a = bearer?.startsWith("ss_") ? await agentByToken(bearer) : null;
    return a ? { agent: a } : { deny: "Unknown or missing agent token. Connect to your agent's own address (shown in Subspace under Agents) to sign in." };
  }
  if (bearer?.startsWith("sat_")) {
    const v = await verifyAccess(bearer);
    if (v && v.agent.kind === target.kind && v.agent.handle === target.handle) return v;
  } else if (bearer?.startsWith("ss_") && target.kind === "agent") {
    const a = await agentByToken(bearer);
    if (a && a.handle === target.handle) return { agent: a };
  }
  return { deny: "Sign in to connect.", target };
}

/** The 401 that tells a client where to sign in (RFC 9728). */
export function challengeFor(req: Request, target?: Target): string {
  return target ? `Bearer resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource${pathOfTarget(target)}", scope="subspace"` : "Bearer";
}

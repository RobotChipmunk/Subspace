import { timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";
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

/** Password sign-in today. Sign in with Apple will mint the same session token later. */
export async function signIn(pw: string): Promise<{ token: string; maxAge: number }> {
  const a = Buffer.from(sha256(pw ?? ""));
  const b = Buffer.from(sha256(password()));
  if (!timingSafeEqual(a, b)) throw new ApiError(401, "That password is not right.");
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

/** Who is calling: an agent (connection token) or the owner (session cookie, or session token as Bearer for native apps). */
export async function actorFromRequest(req: Request, pathToken?: string): Promise<Agent | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? pathToken;
  if (bearer) {
    if (bearer.startsWith("ss_")) return agentByToken(bearer);
    return ownerFromSession(bearer);
  }
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  return ownerFromSession(cookie);
}

import { exchangeCode, OAuthError, refreshTokens } from "@/lib/core/oauth";
import { json, oauthFailure, preflight } from "@/lib/oauth-http";

// Exchanges a sign-in code for tokens, and renews them.
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    if (!req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) return json({ error: "invalid_request", error_description: "Send application/x-www-form-urlencoded." }, 415);
    const f = new URLSearchParams(await req.text());
    const p = Object.fromEntries(f) as Record<string, string | undefined>;
    if (p.grant_type === "authorization_code") return json(await exchangeCode(p));
    if (p.grant_type === "refresh_token") return json(await refreshTokens(p));
    throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
  } catch (e) {
    return oauthFailure(e);
  }
}
export const OPTIONS = preflight;

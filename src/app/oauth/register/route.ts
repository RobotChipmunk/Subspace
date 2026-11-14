import { registerClient } from "@/lib/core/oauth";
import { json, oauthFailure, preflight } from "@/lib/oauth-http";

// Dynamic client registration (RFC 7591), for apps that do not publish a client metadata document.
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const c = await registerClient(await req.json().catch(() => null));
    return json({ client_id: c.id, client_name: c.name, redirect_uris: c.redirect_uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, 201);
  } catch (e) {
    return oauthFailure(e);
  }
}
export const OPTIONS = preflight;

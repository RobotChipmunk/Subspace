/** Small shared pieces for the OAuth route handlers. */
import { ApiError } from "./core/util";
import { OAuthError, originOf, pathOfTarget, SCOPES, targetOfPath } from "./core/oauth";

export const OPEN = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version" };
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...OPEN, ...NO_STORE, ...headers } });
export const preflight = () => new Response(null, { status: 204, headers: OPEN });

export function oauthFailure(e: unknown): Response {
  if (e instanceof OAuthError) return json({ error: e.code, error_description: e.message }, e.status);
  if (e instanceof ApiError) return json({ error: e.status === 429 ? "temporarily_unavailable" : "invalid_request", error_description: e.message }, e.status);
  console.error("oauth error", e);
  return json({ error: "server_error", error_description: "Something went wrong." }, 500);
}

/** RFC 8414 metadata. The same document is served for the OpenID discovery path some clients try first. */
export function serverMetadata(req: Request) {
  const o = originOf(req);
  return {
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** RFC 9728 metadata for one MCP address, or null if the path is not one. */
export function resourceMetadata(req: Request, path: string) {
  const t = targetOfPath(path);
  if (!t) return null;
  const o = originOf(req);
  return { resource: o + pathOfTarget(t), authorization_servers: [o], scopes_supported: SCOPES, bearer_methods_supported: ["header"], resource_name: t.kind === "guest" ? "Subspace tasks" : "Subspace" };
}

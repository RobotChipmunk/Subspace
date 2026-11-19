import { challengeFor, mcpCaller } from "@/lib/auth";
import { originOf, type Target } from "@/lib/core/oauth";
import { tickSoon } from "@/lib/core/routines";
import { handleMcp } from "@/lib/mcp/server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};

/** One MCP request. `at.target` is the agent or guest whose address was called; without one it is the bare /api/mcp (static token in a header). */
export async function mcpPost(req: Request, at: { target?: Target } = {}) {
  const who = await mcpCaller(req, at.target);
  if ("deny" in who) {
    // The 401 names where to sign in; clients that speak OAuth start the flow from it.
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: who.deny } }, { status: 401, headers: { ...CORS, "WWW-Authenticate": challengeFor(req, who.target) } });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  }
  // any agent calling in is a moment to notice a routine that has come due
  tickSoon();
  const out = await handleMcp(who.agent, body, { readOnly: who.grant?.read_only || !!who.agent.access?.read_only, origin: originOf(req), client: who.grant ? who.grant.client_name || who.grant.client_host || "app" : "token", grantId: who.grant?.id });
  if (out.json === undefined) return new Response(null, { status: out.status, headers: CORS });
  return Response.json(out.json, { status: out.status, headers: CORS });
}

// This server never pushes; clients that try to open a stream are told so and fall back to plain POST.
export const mcpGet = () => new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
export const mcpDelete = () => new Response(null, { status: 200, headers: CORS });
export const mcpOptions = () => new Response(null, { status: 204, headers: CORS });

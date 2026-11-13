import { actorFromRequest } from "@/lib/auth";
import { handleMcp } from "@/lib/mcp/server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
};

export async function mcpPost(req: Request, pathToken?: string) {
  const agent = await actorFromRequest(req, pathToken);
  if (!agent) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unknown or missing agent token. Create one in Subspace under Agents." } },
      { status: 401, headers: { ...CORS, "WWW-Authenticate": "Bearer" } },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  }
  const out = await handleMcp(agent, body);
  if (out.json === undefined) return new Response(null, { status: out.status, headers: CORS });
  return Response.json(out.json, { status: out.status, headers: CORS });
}

// This server never pushes; clients that try to open a stream are told so and fall back to plain POST.
export const mcpGet = () => new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
export const mcpDelete = () => new Response(null, { status: 200, headers: CORS });
export const mcpOptions = () => new Response(null, { status: 204, headers: CORS });

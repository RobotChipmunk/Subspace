import { mcpDelete, mcpGet, mcpOptions, mcpPost } from "../handler";

/**
 * /api/mcp/<handle>: an agent's own address. It is not secret; the client signs in (OAuth) and
 * sends a short-lived token, or a script sends the agent's static token as a Bearer header.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = async (req: Request, ctx: { params: Promise<{ handle: string }> }) => {
  const handle = (await ctx.params).handle.toLowerCase();
  // Anything that is not a handle is not an address here (including the retired /api/mcp/ss_… form).
  if (!/^[a-z0-9]{2,24}$/.test(handle) || handle === "guest") {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "No MCP server at this address. Use the address shown in Subspace under Agents." } }, { status: 404 });
  }
  return mcpPost(req, { target: { kind: "agent", handle } });
};
export const GET = mcpGet;
export const DELETE = mcpDelete;
export const OPTIONS = mcpOptions;

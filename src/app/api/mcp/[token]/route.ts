import { mcpDelete, mcpGet, mcpOptions, mcpPost } from "../handler";

/**
 * /api/mcp/<handle>: an agent's own address. It is not secret; the client signs in (OAuth) and
 * sends a short-lived token. /api/mcp/ss_…, the older form with the static token in the address,
 * is still answered here for agents whose owner has not switched it off.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const seg = (await ctx.params).token;
  return mcpPost(req, seg.startsWith("ss_") ? { pathToken: seg } : { target: { kind: "agent", handle: seg.toLowerCase() } });
};
export const GET = mcpGet;
export const DELETE = mcpDelete;
export const OPTIONS = mcpOptions;

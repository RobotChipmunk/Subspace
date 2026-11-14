import { mcpDelete, mcpGet, mcpOptions, mcpPost } from "../../handler";

/**
 * /api/mcp/guest/<handle>: the address a guest's agents connect to. It serves only that guest's
 * shared tasks, and only to a token the guest approved by signing in with their passcode.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const POST = async (req: Request, ctx: { params: Promise<{ handle: string }> }) => mcpPost(req, { target: { kind: "guest", handle: (await ctx.params).handle.toLowerCase() } });
export const GET = mcpGet;
export const DELETE = mcpDelete;
export const OPTIONS = mcpOptions;

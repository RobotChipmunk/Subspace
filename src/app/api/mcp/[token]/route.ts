import { mcpDelete, mcpGet, mcpOptions, mcpPost } from "../handler";

// Same server, with the agent token in the URL for clients that cannot send an Authorization header.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = async (req: Request, ctx: { params: Promise<{ token: string }> }) => mcpPost(req, (await ctx.params).token);
export const GET = mcpGet;
export const DELETE = mcpDelete;
export const OPTIONS = mcpOptions;

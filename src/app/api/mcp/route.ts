import { mcpDelete, mcpGet, mcpOptions, mcpPost } from "./handler";

// The bare address: for scripts and clients that send an agent's static token as an Authorization header.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = (req: Request) => mcpPost(req);
export const GET = mcpGet;
export const DELETE = mcpDelete;
export const OPTIONS = mcpOptions;

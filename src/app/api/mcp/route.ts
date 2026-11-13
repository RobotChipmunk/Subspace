import { mcpDelete, mcpGet, mcpOptions, mcpPost } from "./handler";

export const dynamic = "force-dynamic";
export const POST = (req: Request) => mcpPost(req);
export const GET = mcpGet;
export const DELETE = mcpDelete;
export const OPTIONS = mcpOptions;

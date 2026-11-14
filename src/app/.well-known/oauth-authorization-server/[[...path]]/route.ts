import { json, preflight, serverMetadata } from "@/lib/oauth-http";

// Where to sign in, exchange codes and register, for every MCP address on this deployment.
export const dynamic = "force-dynamic";
export const GET = (req: Request) => json(serverMetadata(req));
export const OPTIONS = preflight;

import { json, preflight, resourceMetadata } from "@/lib/oauth-http";

// Tells a client which authorization server guards an MCP address: /.well-known/oauth-protected-resource/api/mcp/<handle>
export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const meta = resourceMetadata(req, "/" + ((await ctx.params).path ?? []).join("/"));
  return meta ? json(meta) : json({ error: "not_found", error_description: "No MCP address here. Use the address shown in Subspace under Agents." }, 404);
}
export const OPTIONS = preflight;

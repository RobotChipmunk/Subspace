import { loadMedia } from "@/lib/core/media";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const m = await loadMedia((await ctx.params).id);
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(m.bytes), { headers: { "Content-Type": m.mime, "Cache-Control": "public, max-age=31536000, immutable" } });
}

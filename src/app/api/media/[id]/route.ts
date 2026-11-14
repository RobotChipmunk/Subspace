import { loadMedia } from "@/lib/core/media";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const m = await loadMedia((await ctx.params).id);
  if (!m) return new Response("Not found", { status: 404 });
  const headers = { "Content-Type": m.mime, "Cache-Control": "public, max-age=31536000, immutable", "Accept-Ranges": "bytes" };
  // Safari plays a video only from a server that can hand over the part of the file it asks for.
  const size = m.bytes.length;
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(new Uint8Array(m.bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(new Uint8Array(m.bytes), { headers: { ...headers, "Content-Length": String(size) } });
}

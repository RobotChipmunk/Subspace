import { agentFromUploadTicket } from "@/lib/auth";
import { saveMedia } from "@/lib/core/media";
import { ApiError } from "@/lib/core/util";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { gif: "image/gif", mp4: "video/mp4", webm: "video/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif" };

/**
 * Where an agent sends a clip or picture it made, using the address the media_upload tool gave it.
 * Accepts a form with a "file" field (curl -F file=@clip.mp4) or the file as the request body.
 */
export async function POST(req: Request, ctx: { params: Promise<{ ticket: string }> }) {
  try {
    const agent = await agentFromUploadTicket((await ctx.params).ticket);
    if (!agent) throw new ApiError(401, "This upload address has expired or is not valid. Call media_upload again for a new one.");
    let bytes: Buffer;
    let mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (mime === "multipart/form-data") {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) throw new ApiError(400, 'Send the file in a form field named "file".');
      bytes = Buffer.from(await file.arrayBuffer());
      // curl often labels a file as plain bytes; its name says what it is.
      mime = file.type && file.type !== "application/octet-stream" ? file.type : (TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? file.type);
    } else bytes = Buffer.from(await req.arrayBuffer());
    const url = await saveMedia(agent, bytes, mime, { clips: true });
    const type = mime.startsWith("video/") ? "video" : mime === "image/gif" ? "gif" : "image";
    return Response.json({ url, media: { type, url }, next: "Pass this as media on post. For a short silent preview that should repeat, use type \"gif\"." });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : "Upload failed." }, { status });
  }
}

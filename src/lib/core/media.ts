import { q, q1 } from "../db";
import { bad, newId, type Agent } from "./util";

const IMAGES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
/** Short recorded clips, which only agents upload (see the media_upload tool). */
const CLIPS = ["video/mp4", "video/webm"];
const MAX = 4 * 1024 * 1024;

/** A file is what it says it is: the first bytes of an MP4, WebM or GIF are always the same. */
function looksLike(mime: string, b: Buffer): boolean {
  if (mime === "video/mp4") return b.subarray(4, 8).toString("latin1") === "ftyp";
  if (mime === "video/webm") return b.readUInt32BE(0) === 0x1a45dfa3;
  if (mime === "image/gif") return b.subarray(0, 4).toString("latin1") === "GIF8";
  return true;
}

/**
 * Stores an upload in Vercel Blob when configured, otherwise in Postgres. Returns its URL.
 * A clip's URL ends in its file type, which is how a post knows to play it rather than show it.
 */
export async function saveMedia(actor: Agent, bytes: Buffer, mime: string, opts: { clips?: boolean } = {}): Promise<string> {
  const clip = CLIPS.includes(mime);
  if (!IMAGES.includes(mime) && !(clip && opts.clips)) throw bad(opts.clips ? "Only GIF, MP4 or WebM clips, or PNG, JPEG, WebP or AVIF images, can be uploaded." : "Only PNG, JPEG, GIF, WebP or AVIF images can be uploaded.");
  if (bytes.length > MAX) throw bad(clip || mime === "image/gif" ? `The clip is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is 4 MB. Make it shorter, smaller (480 to 720 pixels wide) or lower in quality, and drop the sound.` : "Image is larger than 4 MB.");
  if (bytes.length < 16 || !looksLike(mime, bytes)) throw bad(`That file is not a real ${mime.split("/")[1].toUpperCase()}.`);
  const id = newId("m");
  const ext = mime.split("/")[1];
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`media/${id}.${ext}`, bytes, { access: "public", contentType: mime });
    return blob.url;
  }
  await q("INSERT INTO media (id, mime, bytes, created_by) VALUES ($1,$2,$3,$4)", [id, mime, bytes, actor.id]);
  return `/api/media/${id}${clip ? `.${ext}` : ""}`;
}

export async function loadMedia(id: string) {
  return q1<{ mime: string; bytes: Buffer }>("SELECT mime, bytes FROM media WHERE id = $1", [id.replace(/\.\w+$/, "")]);
}

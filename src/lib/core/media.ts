import { q, q1 } from "../db";
import { bad, newId, type Agent } from "./util";

const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
const MAX = 4 * 1024 * 1024;

/** Stores an upload in Vercel Blob when configured, otherwise in Postgres. Returns its URL. */
export async function saveMedia(actor: Agent, bytes: Buffer, mime: string): Promise<string> {
  if (!ALLOWED.includes(mime)) throw bad("Only PNG, JPEG, GIF, WebP or AVIF images can be uploaded.");
  if (bytes.length > MAX) throw bad("Image is larger than 4 MB.");
  const id = newId("m");
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`media/${id}.${mime.split("/")[1]}`, bytes, { access: "public", contentType: mime });
    return blob.url;
  }
  await q("INSERT INTO media (id, mime, bytes, created_by) VALUES ($1,$2,$3,$4)", [id, mime, bytes, actor.id]);
  return `/api/media/${id}`;
}

export async function loadMedia(id: string) {
  return q1<{ mime: string; bytes: Buffer }>("SELECT mime, bytes FROM media WHERE id = $1", [id]);
}

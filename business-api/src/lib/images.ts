/**
 * Pictures people show to others: a business's logo, a person's photo.
 *
 * Public by nature - a logo is on every checkout - so they're stored as they
 * are (not sealed like documents) and served at /api/images/:id to anyone.
 * Only PNG, JPEG and WebP, told apart by their first bytes, never by a name
 * or a header the browser sent: an SVG or anything else that could carry a
 * script is refused. The dashboard shrinks a picture before sending it, so
 * the limit here is generous. A stored image never changes; a new one gets a
 * new id, which is why it can be cached for good.
 */
import { prisma } from "./prisma";
import { env } from "../config/env";
import { HttpError } from "./http";

export const MAX_IMAGE = 1_000_000;

type Mime = "image/png" | "image/jpeg" | "image/webp";

function imageType(buf: Buffer): Mime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Keeps the picture in the request body and returns its id. */
export async function storeImage(body: unknown, userId: string): Promise<string> {
  const file = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  if (!file.length) throw new HttpError(400, "That picture is empty.", "empty");
  if (file.length > MAX_IMAGE) throw new HttpError(413, "That picture is too big. Use one under 1 MB.", "too_big");
  const mime = imageType(file);
  if (!mime) throw new HttpError(400, "Use a PNG, JPEG or WebP picture.", "bad_type");
  const img = await prisma.image.create({ data: { mime, size: file.length, data: new Uint8Array(file), uploadedBy: userId } });
  return img.id;
}

export const imageUrl = (id: string | null | undefined) => (id ? `/api/images/${id}` : null);

/** A logo as a full https address on the dashboard's own host (where /api/images is served) - for the Money Moves app. */
export const publicImageUrl = (id: string | null | undefined) => {
  const host = env.ALLOWED_ORIGINS.find((o) => o.startsWith("https://"));
  const path = imageUrl(id);
  return host && path ? new URL(path, host).href : undefined;
};

/**
 * Files as they're kept (M16): the server makes every image it's given one that any browser shows
 * and Claude reads (JPEG, PNG, WebP, GIF), so no client has to. An iPhone's HEIC (whatever type
 * the browser said: often none) or any other image becomes a JPEG at most MAX_SIDE a side, and
 * one too big to keep is shrunk the same way. Receipts and attachments both come through here.
 * Anything else (a PDF, or an image it can't decode) is kept as it is.
 */
import sharp, { type Sharp } from "sharp";

export type FileIn = { name: string; type: string; bytes: Uint8Array };

/** What's taken in, before it's made smaller. */
export const UPLOAD_LIMIT = 25 * 1024 * 1024;
/** What's kept: the ledger's limit for an attachment. */
export const KEPT_LIMIT = 5 * 1024 * 1024;
export const MAX_SIDE = 2000;

const SHOWN = /^image\/(jpeg|png|gif|webp)$/;
// An ISO media file's brands for a HEIF image (HEVC-coded, as an iPhone's are, or not).
const HEIF = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

/** Whether the bytes are a HEIF image (an AVIF is one too, but sharp reads that itself). */
export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const head = new TextDecoder("latin1").decode(bytes.subarray(4, 12));
  return head.startsWith("ftyp") && HEIF.has(head.slice(4));
}

const jpegName = (name: string) => `${name.replace(/\.[^./]+$/, "") || "photo"}.jpg`;

async function jpeg(image: Sharp, name: string): Promise<FileIn> {
  const bytes = await image
    .rotate() // as it was taken (its EXIF orientation)
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { name: jpegName(name), type: "image/jpeg", bytes: new Uint8Array(bytes) };
}

/** The file as it's kept: a JPEG of an image that isn't one browsers and Claude take, or that's
 * too big; otherwise (or if it can't be decoded) the file as it is. */
export async function normalized(file: FileIn): Promise<FileIn> {
  const heif = isHeif(file.bytes) || /^image\/hei[cf]/.test(file.type);
  const image = heif || file.type.startsWith("image/");
  if (!image || (SHOWN.test(file.type) && file.bytes.length <= KEPT_LIMIT)) return file;
  try {
    if (heif) {
      // sharp's own build doesn't decode HEVC, so libheif (WASM) does, loaded when first needed.
      const { default: decode } = await import("heic-decode");
      const { width, height, data } = await decode({ buffer: file.bytes });
      const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      return await jpeg(sharp(raw, { raw: { width, height, channels: 4 } }), file.name);
    }
    return await jpeg(sharp(file.bytes), file.name);
  } catch {
    return file;
  }
}

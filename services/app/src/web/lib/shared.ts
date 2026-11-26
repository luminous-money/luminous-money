/**
 * A file shared to the installed app (public/share-target.js keeps it): Capture receipt opens
 * with it, and lets it go once its transaction is made. It stays until then, so choosing another
 * book (which opens Capture receipt again) still has it; the next share replaces it.
 */
const CACHE = "shared-receipt";
const KEY = "/ui/shared-receipt";

/** The shared file, or null if there isn't one (or this browser keeps no caches). */
export async function sharedFile(): Promise<File | null> {
  if (!("caches" in window)) return null;
  const kept = await (await caches.open(CACHE)).match(KEY);
  if (!kept) return null;
  const blob = await kept.blob();
  const name = decodeURIComponent(kept.headers.get("X-Filename") ?? "") || "receipt";
  return new File([blob], name, { type: blob.type });
}

export async function forgetShared() {
  if ("caches" in window) await caches.delete(CACHE);
}

/** Random secrets and their stored form: only a SHA-256 of each is kept. */
import { createHash, randomBytes } from "node:crypto";

/** A new random secret: 32 bytes, URL-safe. */
export const newSecret = (prefix = "") => `${prefix}${randomBytes(32).toString("base64url")}`;

/** A new random ID. */
export const newId = () => randomBytes(16).toString("hex");

/** What's stored for a secret. */
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** A timestamp `ms` from now (or from `from`), in the database's format. */
export function later(ms: number, from = Date.now()): string {
  return new Date(from + ms).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

export const DAY = 24 * 60 * 60 * 1000;

/**
 * Tags (M17): Beancount's `#tag`s on transactions. The one normalization for a tag someone types,
 * shared by the server and the PWA, as account names have `names.ts`.
 */

/**
 * A tag from what someone typed, or null if nothing's left: trimmed, any `#` dropped, accents
 * taken off, lowercased, and every run of characters Beancount doesn't allow in a tag (it allows
 * letters, digits, `-`, `_`, `/` and `.`) made one dash, with no dash at either end. "Trip to
 * Italy!" is `trip-to-italy`; "#Reimbursable" is `reimbursable`.
 */
export function toTag(text: string): string | null {
  const tag = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_/.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return tag || null;
}

/** Whether `tags` (a transaction's) has every one of `wanted`: how tag filters match (AND). */
export const hasTags = (tags: readonly string[] | undefined, wanted: readonly string[]) =>
  wanted.every((tag) => tags?.includes(tag));

/**
 * Tags (M17), a split's since 2026-11-12 (its posting's `tags`): the one normalization for a tag
 * someone types, shared by the server and the PWA, as account names have `names.ts`, and how a
 * transaction's tags are read from its splits and set on them.
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

/** Whether `tag` is already a tag as `toTag` makes one: what a categorizer may propose. */
export const isTag = (tag: unknown): tag is string => typeof tag === "string" && toTag(tag) === tag;

/** The one tag HSA tracking puts on spending an HSA or FSA can pay back (Kael, 2026-11-19): a
 * fixed name, since Amazon's mark says "FSA or HSA eligible" and the AI is told to look for it
 * in every book, whether or not the book has it yet. */
export const HSA_FSA_ELIGIBLE = "hsa-fsa-eligible";

/** A tag something other than the person put on a split (HSA tracking; Tags, more): the split's
 * index in the transaction, the tag, and `by` whom (a categorizer's name, or a shop's: `amazon`),
 * so review can say where it came from. */
export type TagSource = { index: number; tag: string; by: string };

/** Whether `tags` (a split's) has every one of `wanted`: how tag filters match (AND). */
export const hasTags = (tags: readonly string[] | null | undefined, wanted: readonly string[]) =>
  wanted.every((tag) => tags?.includes(tag));

/** A split, as far as tags go. */
type Tagged = { account: string; tags?: readonly string[] | null };

/** Every tag a transaction's splits have, sorted: the transaction's tags, as lists show them. */
export const tagsOf = (postings: readonly Tagged[]): string[] =>
  [...new Set(postings.flatMap((p) => p.tags ?? []))].sort();

/** Whether one of a transaction's splits has every one of `wanted`: how tag filters keep one. */
export const splitHas = (postings: readonly Tagged[], wanted: readonly string[]) =>
  !wanted.length || postings.some((p) => hasTags(p.tags, wanted));

const BALANCE_SHEET = /^(Assets|Liabilities):/;

/** The splits a tag for a whole transaction goes on (a review card's, Select mode's Add tag…):
 * what the money was for, the splits off the balance sheet (the expense, the income); or every
 * split when all are on it (a transfer, a trade). */
export function forWhole(postings: readonly Tagged[]): number[] {
  const off = postings.flatMap((p, i) => (BALANCE_SHEET.test(p.account) ? [] : [i]));
  return off.length ? off : postings.map((_, i) => i);
}

const sortedTags = (tags: Iterable<string>) => [...new Set(tags)].sort();

/** `postings` with `tag` on what the money was for (`forWhole`). */
export function withTag<P extends Tagged>(postings: readonly P[], tag: string): P[] {
  const on = new Set(forWhole(postings));
  return postings.map((p, i) =>
    on.has(i) && !p.tags?.includes(tag) ? { ...p, tags: sortedTags([...(p.tags ?? []), tag]) } : p
  );
}

/** `postings` with `tag` off every split. */
export const withoutTag = <P extends Tagged>(postings: readonly P[], tag: string): P[] =>
  postings.map((p) =>
    p.tags?.includes(tag) ? { ...p, tags: (p.tags ?? []).filter((t) => t !== tag) } : p
  );

/** `postings` with the transaction's tags made `wanted`: one it loses is taken off every split,
 * one it gains goes on what the money was for. */
export function withTags<P extends Tagged>(postings: readonly P[], wanted: readonly string[]): P[] {
  const had = tagsOf(postings);
  let out = [...postings];
  for (const tag of had) if (!wanted.includes(tag)) out = withoutTag(out, tag);
  for (const tag of wanted) if (!had.includes(tag)) out = withTag(out, tag);
  return out;
}

/** `p` with `tags` added beside its own, never removing one: what a categorizer or a shop says
 * of a split (HSA tracking). */
export function adding<P extends Tagged>(p: P, tags: readonly string[]): P {
  const missing = tags.filter((tag) => !p.tags?.includes(tag));
  return missing.length ? { ...p, tags: sortedTags([...(p.tags ?? []), ...missing]) } : p;
}

/** `items` taking the tags of the splits they replace: itemizing (a receipt's or an order's lines
 * in place of the bank's other side) keeps what was said about the purchase. */
export function inheriting<P extends Tagged>(
  items: readonly P[],
  replaced: readonly Tagged[]
): P[] {
  const tags = tagsOf(replaced);
  return tags.length
    ? items.map((p) => ({ ...p, tags: sortedTags([...(p.tags ?? []), ...tags]) }))
    : [...items];
}

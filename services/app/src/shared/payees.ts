/**
 * Recognizing "the same payee" across noisy bank descriptions: `POS DEBIT 0412 CORNER CAFE #42
 * CHICAGO IL` and `CORNER CAFE #57 CHICAGO IL` should both be Corner Cafe.
 *
 * A description's **payee key** is what's left after lowercasing, turning punctuation into
 * spaces, dropping common bank prefixes and noise words, dropping tokens with three or more
 * digits or only digits (card, store and reference numbers, dates) and a trailing US state code. Keys compare
 * exactly first, then by word overlap. Shared by the server (categorizers) and the PWA ("also
 * these N similar").
 */

/** Phrases banks put in front of the payee, removed wherever they appear (as whole words). */
const NOISE_PHRASES = [
  "debit card purchase",
  "debit card",
  "pos debit",
  "pos purchase",
  "pos",
  "checkcard",
  "check card",
  "card purchase",
  "purchase authorized on",
  "recurring payment",
  "ach debit",
  "ach credit",
  "ach",
  "electronic payment",
  "online payment",
  "web pmt",
  "visa",
  "debit",
  "purchase",
  "payment to",
  "ppd id",
  "ppd",
  "sq",
  "tst",
];

const STATES = new Set(
  "al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc".split(
    " "
  )
);

/** The description's payee key: e.g. "corner cafe chicago". Empty if nothing's left. */
export function payeeKey(description: string): string {
  let text = ` ${description.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  for (const phrase of NOISE_PHRASES) text = text.split(` ${phrase} `).join(" ");
  const words = text
    .split(" ")
    .filter((w) => w && !/^\d+$/.test(w) && (w.match(/\d/g)?.length ?? 0) < 3);
  if (words.length > 1 && STATES.has(words.at(-1)!)) words.pop();
  return words.join(" ");
}

/** How alike two keys are, 0 to 1: the share of their words in common (Jaccard). */
export function keySimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const x = new Set(a.split(" "));
  const y = new Set(b.split(" "));
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared);
}

/** Keys at least this alike count as the same payee, when not identical. */
export const SIMILAR = 0.6;

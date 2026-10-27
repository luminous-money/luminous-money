/**
 * Account names from words: the one normalization for every name the app makes from what
 * someone wrote (a picker's suggestion, a divided account's parts, an imported chart of
 * accounts, another system's history), and for typing one. Shared by the server and the PWA.
 */

// Short joining words, lowercase inside a name as in a title: "Gifts-and-Giving".
const SMALL_WORDS = new Set("a an and as at but by for in nor of on or per the to via".split(" "));

/**
 * Turn a human name into one valid part of an account name, title-cased: the standard
 * normalization for every name the app makes from words (a picker's suggestion, a divided
 * account's parts, an imported chart of accounts). Spaces, underscores and dashes separate
 * words, which are joined by dashes; characters Beancount doesn't allow are dropped; each word
 * starts with a capital, the rest kept as written ("PNC", "401k"); and short joining words
 * inside it are lowercase: "gifts and giving" becomes "Gifts-and-Giving".
 */
export function toSegment(text: string): string {
  const words = text
    .split(/[\s_-]+/)
    .map((word) => word.replace(/[^\p{L}\p{Nd}]/gu, ""))
    .filter(Boolean);
  return words
    .map((word, i) =>
      i > 0 && i < words.length - 1 && SMALL_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join("-");
}

// What a top-level account may be written as besides its own name (ignoring case).
const ROOT_ALIASES: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  expense: "Expenses",
};

/**
 * A full account name from one written by hand (an imported chart of accounts, another system's
 * history), or why it can't be one: its root is the book's top-level account it names (ignoring
 * case, singulars too), and every other part goes through `toSegment`. "expenses:dining out"
 * becomes `Expenses:Dining-Out`. With `under` (a top-level account, from what the other system
 * says the account is), a name that doesn't start with one goes below it: "Current Assets:
 * Checking", a bank account, becomes `Assets:Current-Assets:Checking`.
 */
export function normalizeName(
  text: string,
  roots: string[],
  under?: string | null
): { name: string } | { problem: string } {
  let parts = text
    .trim()
    .replace(/:+$/, "")
    .split(":")
    .map((p) => p.trim());
  const first = parts[0]!.toLowerCase();
  let root =
    roots.find((r) => r.toLowerCase() === first) ?? roots.find((r) => r === ROOT_ALIASES[first]);
  if (!root && under && roots.includes(under) && parts[0]) {
    root = under;
    parts = [under, ...parts];
  }
  if (!root) return { problem: `Start with one of ${roots.join(", ")}` };
  if (parts.length < 2) return { problem: `Name an account under ${root}` };
  const segments = parts.slice(1).map(toSegment);
  const empty = segments.findIndex((s) => !s);
  if (empty !== -1)
    return {
      problem: parts[empty + 1]
        ? `"${parts[empty + 1]}" has no letters or digits to make a name from`
        : "A part of the name is empty",
    };
  return { name: [root, ...segments].join(":") };
}

/**
 * Fix up a name as it's typed, as `toSegment` would make it: spaces become dashes, and each word
 * starts with a capital, but a short joining word once another follows it ("Gifts-and-"). The
 * length never changes, so the cursor can stay where it was.
 */
export function typed(text: string): string {
  const dashed = text.replace(/\s/g, "-");
  return dashed.replace(/(^|[:-])([^:-]+)/g, (_, sep: string, word: string, at: number) => {
    const start = at + sep.length;
    const first = /(^|:)-*$/.test(dashed.slice(0, start)); // the first word of its part
    if (!first && dashed[start + word.length] === "-" && SMALL_WORDS.has(word.toLowerCase()))
      return sep + word.toLowerCase();
    const capital = word.charAt(0).toUpperCase(); // unless it's longer ("ß" is "SS")
    return sep + (capital.length === 1 ? capital : word.charAt(0)) + word.slice(1);
  });
}

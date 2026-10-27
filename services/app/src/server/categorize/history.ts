/**
 * The `history` categorizer: what the same payee was categorized as before, learned from
 * confirmed transactions in the context. No setup.
 *
 * For a transaction, the past ones it learns from are confirmed (`*`), two-posting, categorized
 * (not to an uncategorized account), and from the same payee: the same payee key exactly, or
 * failing that a similar one. Ones in the same account are preferred; with none there, any
 * account's count, for less.
 *
 * - **Category:** the other account they used most (the most recent breaks a tie).
 * - **Payee:** the payee most recently given to them, if it isn't just the bank's text.
 * - **Confidence:** the winning share, discounted for little history (`share × n / (n + 1)`:
 *   1 of 1 is 0.5, 3 of 3 is 0.75, 20 of 20 about 0.95), and by a fifth each for a similar
 *   rather than identical key, and for another account.
 *
 * Past transactions are seen from their balance-sheet side (an asset or liability), where an
 * import comes from.
 *
 * **Imported history** (another system's, from a migration) is learned from after the book's
 * own: only if the book's own history has nothing for the payee, at 0.8 of the confidence, and
 * only toward accounts that can take a proposal (open leaves).
 */
import type { IncomingTransaction } from "../../shared/categorizer-api.js";
import { keySimilarity, payeeKey, SIMILAR } from "../../shared/payees.js";
import type { Categorizer, History, InternalProposal, Request } from "./types.js";

/** Accounts staging falls back to: never learned as a category. */
const UNCATEGORIZED = new Set(["Expenses:Uncategorized", "Income:Uncategorized"]);

type Past = { t: History[number]; key: string; account: string; other: string };

/** The confirmed, categorized two-posting transactions in the context, with their keys, seen
 * from their balance-sheet side (where an import comes from). */
function learnable(history: History, balanceSheet: Set<string>): Past[] {
  return history.flatMap((t) => {
    if (t.flag !== "*" || t.postings.length !== 2) return [];
    const key = payeeKey(t.narration || t.payee || "");
    if (!key) return [];
    return t.postings.flatMap((p, i) => {
      const other = t.postings[1 - i]!.account;
      return balanceSheet.has(p.account) && !UNCATEGORIZED.has(other)
        ? [{ t, key, account: p.account, other }]
        : [];
    });
  });
}

/** What imported history's confidence is, against the book's own. */
const IMPORTED = 0.8;

function propose(
  row: IncomingTransaction,
  past: Past[],
  imported: Past[]
): InternalProposal | null {
  const key = payeeKey(row.description);
  if (!key) return null;
  const tiers: [Past[], number, string][] = [];
  for (const [from, factor, where] of [
    [past, 1, ""],
    [imported, IMPORTED, " (imported)"],
  ] as const)
    for (const sameAccount of [true, false]) {
      const pool = from.filter((p) => (p.account === row.account) === sameAccount);
      const exact = pool.filter((p) => p.key === key);
      const similar = pool.filter((p) => p.key !== key && keySimilarity(p.key, key) >= SIMILAR);
      tiers.push([exact, (sameAccount ? 1 : 0.8) * factor, `past${where}`]);
      tiers.push([similar, (sameAccount ? 0.8 : 0.64) * factor, `similar past${where}`]);
    }
  const [found, factor, word] = tiers.find(([pool]) => pool.length) ?? [[], 0, ""];
  if (!found.length) return null;

  const votes = new Map<string, { n: number; last: string }>();
  for (const p of found) {
    const v = votes.get(p.other) ?? { n: 0, last: "" };
    votes.set(p.other, { n: v.n + 1, last: p.t.date > v.last ? p.t.date : v.last });
  }
  const [account, { n }] = [...votes].sort(
    ([, a], [, b]) => b.n - a.n || b.last.localeCompare(a.last)
  )[0]!;
  const total = found.length;
  const confidence = Number(((n / total) * (total / (total + 1)) * factor).toFixed(3));
  const named = found
    .filter((p) => p.t.payee && p.t.payee !== p.t.narration)
    .sort((a, b) => b.t.date.localeCompare(a.t.date))[0];
  return {
    id: row.id,
    postings: [{ account }],
    ...(named ? { payee: named.t.payee } : {}),
    confidence,
    reason: `${n} of ${total} ${word} "${key}" → ${account}`,
  };
}

/**
 * The history categorizer, learning from the book's own history in the request's context and,
 * with `importedFor`, a book's imported history after it.
 */
export function historyCategorizer(importedFor?: (book: string) => History): Categorizer {
  return {
    name: "history",
    async categorize(request: Request) {
      const accounts = request.context.accounts;
      const balanceSheet = new Set(
        accounts
          .filter(
            (a) =>
              a.type === "asset" || a.type === "liability" || /^(Assets|Liabilities):/.test(a.name)
          )
          .map((a) => a.name)
      );
      const past = learnable(request.context.history, balanceSheet);
      const leaves = new Set(
        accounts.filter((a) => a.kind === "leaf" && !a.close).map((a) => a.name)
      );
      const old = importedFor?.(request.book.id) ?? [];
      // Its own side by name too: an old account that isn't here is still where it came from.
      const sides = new Set([
        ...balanceSheet,
        ...old
          .flatMap((t) => t.postings.map((p) => p.account))
          .filter((a) => /^(Assets|Liabilities):/.test(a)),
      ]);
      const imported = old.length ? learnable(old, sides).filter((p) => leaves.has(p.other)) : [];
      return {
        proposals: request.transactions.flatMap((t) => propose(t, past, imported) ?? []),
      };
    },
  };
}

/** The history categorizer without imported history. */
export const history: Categorizer = historyCategorizer();

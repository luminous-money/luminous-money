import { flowSign, under } from "./accounts.js";
import { firstOf, monthOf } from "./dates.js";
import { cents, units } from "./money.js";
import { DEFAULT_ROOTS, type Posting, type Roots } from "./types.js";

export type LargeTransaction = {
  transaction: string;
  date: string;
  payee: string | null;
  narration: string | null;
  /** Its largest posting under the root: where most of it went. */
  account: string;
  amount: number;
};

export type LargestTransactions = { currency: string; transactions: LargeTransaction[] };

/** The largest transactions under `root` (expenses by default) from `from` (this month's first
 * by default) to `today`: each one's postings under it, together. */
export function largestTransactions({
  postings,
  today,
  currency,
  root,
  from,
  limit = 8,
  roots = DEFAULT_ROOTS,
}: {
  postings: Posting[];
  today: string;
  currency: string;
  root?: string;
  from?: string;
  limit?: number;
  roots?: Roots;
}): LargestTransactions {
  const base = root ?? roots.expenses;
  const start = from ?? firstOf(monthOf(today));
  const found = new Map<string, LargeTransaction & { sum: number; top: number }>();
  for (const posting of postings) {
    if (posting.currency !== currency || !under(posting.account, base)) continue;
    if (posting.date < start || posting.date > today) continue;
    const amount = cents(posting.amount) * flowSign(base, roots);
    const t = found.get(posting.transaction) ?? {
      transaction: posting.transaction,
      date: posting.date,
      payee: posting.payee ?? null,
      narration: posting.narration ?? null,
      account: posting.account,
      amount: 0,
      sum: 0,
      top: -Infinity,
    };
    t.sum += amount;
    if (amount > t.top) [t.top, t.account] = [amount, posting.account];
    found.set(posting.transaction, t);
  }
  const transactions = [...found.values()]
    .filter((t) => t.sum > 0)
    .sort((a, b) => b.sum - a.sum || b.date.localeCompare(a.date))
    .slice(0, limit)
    .map(({ sum, top: _, ...t }) => ({ ...t, amount: units(sum) }));
  return { currency, transactions };
}

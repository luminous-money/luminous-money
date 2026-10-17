/**
 * The posting stream: what every report reads. One entry per posting of a transaction, as any
 * double-entry ledger (Beancount, hledger, Ledger, a database) can produce it.
 */
export type Posting = {
  /** The transaction it's part of: postings of one transaction share it. */
  transaction: string;
  /** YYYY-MM-DD. */
  date: string;
  /** `*` confirmed, `!` not yet (both count). */
  flag?: string;
  /** False for a transaction kept out of budgets (a once-in-decades roof). Default true. */
  budgeted?: boolean;
  payee?: string | null;
  narration?: string | null;
  /** The full account name, `:`-separated. */
  account: string;
  /** A decimal string: the account's change, positive into it (debits positive). */
  amount: string;
  currency: string;
};

/** What a ledger calls its five top-level accounts. */
export type Roots = {
  assets: string;
  liabilities: string;
  equity: string;
  income: string;
  expenses: string;
};

/** Beancount's names (also the usual hledger and Ledger ones). */
export const DEFAULT_ROOTS: Roots = {
  assets: "Assets",
  liabilities: "Liabilities",
  equity: "Equity",
  income: "Income",
  expenses: "Expenses",
};

/** A price: one unit of `commodity` is `number` of `currency` on `date`. */
export type Price = { commodity: string; date: string; number: string; currency: string };

/** A current balance: what an account (or a root, summed) holds of a currency now. */
export type Balance = { account: string; amount: string; currency: string };

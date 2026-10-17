/**
 * The external categorizer API, version 1: what fava-beans sends a categorization provider and
 * what it expects back. These types are the contract; docs/categorizer-api.md explains it.
 *
 * fava-beans is the system of record. A provider only proposes: it never writes to the books,
 * and everything it proposes goes through review (unless a user's own rule says otherwise).
 * JSON is snake_case; money is decimal strings, never floats; dates are ISO (YYYY-MM-DD).
 */

export const CATEGORIZER_API_VERSION = "1";

export type Money = { number: string; currency: string };

/** A transaction to categorize: one row of an import, before it's staged. */
export type IncomingTransaction = {
  /** Opaque, unique within the request; proposals refer to it. */
  id: string;
  date: string;
  /** The account the transaction came from (the bank or card account imported into). */
  account: string;
  /** The change to `account`: negative is money out. */
  amount: Money;
  /** The bank's description, as given. */
  description: string;
  /** A payee, if the bank gave one separately. */
  payee: string | null;
};

/** An account in the book's chart of accounts. */
export type ContextAccount = {
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense" | null;
  /** Leaves hold transactions; nodes only hold other accounts. Propose leaves. */
  kind: "leaf" | "node";
  open: string | null;
  close: string | null;
};

/** A transaction already in the book. */
export type HistoryTransaction = {
  id: string;
  date: string;
  /** `*` confirmed by the user (trust these), `!` still unconfirmed (don't learn from them). */
  flag: string;
  payee: string | null;
  /** The description (for imported transactions, the bank's text). */
  narration: string | null;
  postings: { account: string; amount: Money | null }[];
};

/** `POST <provider>/v1/categorize` */
export type CategorizeRequest = {
  api_version: typeof CATEGORIZER_API_VERSION;
  /** Unique per call; feedback refers back to it. */
  request_id: string;
  book: { id: string; name: string };
  transactions: IncomingTransaction[];
  context: {
    /** The first date of `history`: 14 months before the earliest transaction. */
    from: string;
    accounts: ContextAccount[];
    /** Every transaction in the book from `from` on, oldest first, from all accounts. */
    history: HistoryTransaction[];
  };
};

/** One proposal: what a transaction is. Any field but `id`, `confidence` and `reason` may be
 * left out (a payee alone, say). */
export type Proposal = {
  /** The `id` of the transaction it's for. */
  id: string;
  /**
   * The other side of the transaction: everything but the imported account. One posting
   * without an amount takes it all. Several postings (a split) need amounts, in the
   * transaction's currency, summing to the negative of the transaction's amount. Accounts must
   * be open leaves from `context.accounts`; proposals naming anything else are dropped.
   */
  postings?: { account: string; amount?: Money | null }[];
  /** A clean payee name ("Corner Cafe"), if the provider has one. */
  payee?: string | null;
  /**
   * 0 to 1: how likely the user is to accept this unchanged. 0.9 or more settles the
   * transaction (later providers aren't asked). fava-beans measures acceptance per provider,
   * so a poorly calibrated provider shows up as one.
   */
  confidence: number;
  /** Why, in a short sentence the user sees in review ("Corner Cafe is always coffee"). */
  reason: string;
};

export type CategorizeResponse = {
  /** Any subset of the transactions; leave out ones with no proposal. */
  proposals: Proposal[];
};

/** `POST <provider>/v1/feedback`, if the provider is configured for it: what became of its
 * proposals once the user confirmed the transactions. */
export type FeedbackRequest = {
  api_version: typeof CATEGORIZER_API_VERSION;
  book: { id: string; name: string };
  outcomes: {
    /** The `request_id` and transaction `id` the proposal answered. */
    request_id: string;
    id: string;
    proposal: Proposal;
    /** What the user confirmed. */
    final: { payee: string | null; postings: { account: string; amount: Money | null }[] };
    /** Whether the proposal's postings were confirmed unchanged. */
    accepted: boolean;
  }[];
};

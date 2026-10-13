/**
 * The app API's import types, shared by the server and the PWA. (The ledger's API has generated
 * types; the app API is small enough to share hand-written ones instead.)
 */
export type { CsvProfile } from "@fava-beans/csv-import";

/** What became of one CSV row. */
export type Outcome =
  /** Staged as a pending transaction in the account, for review. */
  | "staged"
  /** The same event as a transaction already in the account: it claims that one instead of
   * adding another (proposed until confirmed in review). */
  | "matched"
  /** Already imported before (same fingerprint): skipped. */
  | "duplicate"
  /** Dated on or before the account's opening balance, which already includes it: skipped. */
  | "before-opening"
  /** Couldn't be read (see `error`): skipped. */
  | "unreadable";

/** An existing transaction that might be the same event as an imported row. */
export type Candidate = {
  transaction_id: string;
  date: string;
  flag: string;
  payee: string | null;
  narration: string | null;
  amount: string;
  /** Days between the row's date and the candidate's (negative: the candidate is earlier). */
  days: number;
  /** 1 for the same day, falling with distance in days. */
  score: number;
};

export type ImportRow = {
  line: number;
  date: string | null;
  amount: string | null;
  description: string;
  outcome: Outcome;
  error: string | null;
  transaction_id: string | null;
  /** Transactions already in the account that might be the same event, best first. The row's
   * transaction is the best one no other row took (`matched`), else a new one (`staged`). */
  candidates: Candidate[];
  /** For a row with candidates: whether its transaction is still `proposed`, or `confirmed` in
   * review. Null for a row without candidates (nothing to review on the matching side). */
  match: "proposed" | "confirmed" | null;
};

export type ImportBatch = {
  id: string;
  account: string;
  filename: string;
  created_at: string;
  rows: number;
  staged: number;
  matched: number;
  duplicates: number;
  skipped: number;
  unreadable: number;
};

export type ImportResult = { batch: ImportBatch; rows: ImportRow[] };

/**
 * Select mode's bulk edits (review, an account's ledger, Transactions): one request for the whole
 * selection, made in one write (`POST /books/:book/transactions/bulk`, `server/bulk.ts`).
 */

/** What to do to every selected transaction. */
export type BulkChange =
  /** Confirm them (`*`); with `matches`, their proposed matches too (review). One that sells
   * shares no fund has is skipped, matches and all. */
  | { op: "confirm"; matches?: boolean }
  /** Put the other side in `account`: relative to `own` (an account's ledger), or a
   * two-split transaction's category. One that can't be is skipped. */
  | { op: "categorize"; account: string; own?: string }
  /** Tags off every split (`remove`), then on what the money was for (`add`). A tag in neither
   * is left as it is on each one. */
  | { op: "tags"; add: string[]; remove: string[] }
  /** Give all of each one to `fund`, or clear their funds (Unallocated). One whose amounts don't
   * read is skipped. */
  | { op: "fund"; fund: string };

export type BulkEdit = BulkChange & {
  /** The selection, each with the version read: one that's changed since refuses all of it. */
  transactions: { id: string; updated_at: string }[];
};

export type BulkResult = {
  /** How many it changed. */
  changed: number;
  /** How many were already that way. */
  unchanged: number;
  /** How many it couldn't change (what `BulkChange` says it skips). */
  skipped: number;
  /** Proposed matches it confirmed (`confirm` with `matches`). */
  matches: number;
};

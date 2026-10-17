/** Reconciliation (M14) as the app API shows it: shared by the server and the PWA. */
import type { components } from "@fava-beans/ledger-client";

export type ReconcileState = components["schemas"]["ReconcileState"];
export type ReconcileItem = components["schemas"]["ReconcileItem"];
export type Reconciled = components["schemas"]["Reconciled"];
export type Reconciliation = components["schemas"]["Reconciliation"];

/** A reconciliation saved for later: the statement so far, and what's ticked. */
export type ReconcileDraft = {
  account: string;
  statement_date: string | null;
  /** As stored (negative on a liability). */
  balance: string | null;
  ticked: string[];
  user_id: string;
  updated_at: string;
};

/** What the Reconcile screen needs. */
export type ReconcileView = {
  /** The statement date the list runs to (plus 14 days). */
  through: string;
  state: ReconcileState;
  /** The statement as the bank or the last imported file says it (stored sign). */
  prefill: { statement_date: string; balance: string; source: "bank" | "file" } | null;
  /** What starts ticked: the draft's, else what was imported into it and the opening balance. */
  ticked: string[];
  draft: ReconcileDraft | null;
};

/** A bank-fed account's books against the bank, at the end of `date` (stored signs). */
export type BankComparison = {
  date: string;
  bank: string;
  books: string;
  /** The bank less the books, when they differ. */
  off_by: string | null;
  /** The first day of the difference, if it began within the bank's history. */
  since: string | null;
};

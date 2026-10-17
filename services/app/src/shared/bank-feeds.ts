/** Bank feeds (SimpleFIN) as the app API shows them: shared by the server and the PWA. */
import type { BankComparison } from "./reconcile.js";

export type LinkMode = "new" | "reconcile" | "start-over" | "from-date";
export type LinkKind = "cash" | "brokerage";

/** A bank feed's error, or (`notice`) the Bridge's advice, which isn't a failure. */
export type BankError = { code: string; message: string; explained: string; notice: boolean };

export type BankAccount = {
  account_id: string;
  name: string;
  institution: string;
  currency: string;
  balance: string;
  available_balance: string | null;
  /** Unix seconds. */
  balance_date: number;
  kind: LinkKind;
  holdings: number;
  link: { id: string; book_id: string; book_name: string | null; account: string } | null;
};

export type BankConnection = {
  id: string;
  host: string;
  created_at: string;
  last_sync_at: string | null;
  requests_left: number;
  requests_per_day: number;
  errors: BankError[];
  accounts: BankAccount[];
};

export type LinkRequest = {
  connection_id: string;
  account_id: string;
  account: string;
  mode: LinkMode;
  from?: string;
};

export type LinkPreview = {
  mode: LinkMode;
  kind: LinkKind;
  account: string;
  history_complete: boolean;
  bank: { transactions: number; from: string | null; balance: string; currency: string };
  matched: number;
  added: number;
  not_at_bank: number;
  deleted: number;
  deleted_elsewhere: number;
  opening: { date: string; amount: string; was: string | null } | null;
  starts_on: string;
};

/** A link the user chose, while the bank's history is fetched in the background. */
export type LinkAttempt = {
  id: string;
  connection_id: string;
  account_id: string;
  account: string;
  mode: LinkMode;
  from: string | null;
  /** `waiting`: today's requests ran out; it carries on with tomorrow morning's sync. */
  state: "fetching" | "waiting" | "ready" | "failed";
  preview: LinkPreview | null;
  error: string | null;
  updated_at: string;
};

/** A linked account's bank side. */
export type BankStatus = {
  link_id: string;
  connection_id: string;
  institution: string;
  name: string;
  kind: LinkKind;
  reported: { balance: string; currency: string; balance_date: number };
  last_sync_at: string | null;
  not_at_bank: string[];
  errors: BankError[];
  /** The books against the bank (M14); null for a brokerage. */
  comparison: BankComparison | null;
};

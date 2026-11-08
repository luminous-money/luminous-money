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
  /** A brokerage whose activity can be read (its institution's reader), else null. */
  reader: string | null;
  link: { id: string; book_id: string; book_name: string | null; account: string } | null;
};

/** What a brokerage link's reading made of the bank's rows since its start. */
export type BrokerageActivity = {
  sweeps: number;
  dividends: number;
  trades: number;
  transfers_in: number;
  other: number;
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
  /** A brokerage whose activity is read (its institution's reader), else null. */
  reader: string | null;
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
  /** The books against the bank (M14): a brokerage's cash, when its rows are read; else null
   * for a brokerage. */
  comparison: BankComparison | null;
  /** The link's version, for changing its settings. */
  updated_at: string;
  /** A brokerage's: whether its rows are read (the reader's name), where its dividends go
   * (`dividends_chosen`: chosen, not the default), and what the reading made of its rows. */
  reader?: string | null;
  dividends?: string;
  dividends_chosen?: boolean;
  activity?: BrokerageActivity | null;
};

/** What reading a brokerage link again would do (and, once done, did). */
export type RereadPreview = {
  account: string;
  institution: string;
  rows: number;
  read: Record<"sweep" | "dividend" | "buy" | "sell" | "shares-in" | "cash-in" | "other", number>;
  kept: number;
  deleted: number;
  deleted_yours: number;
  opening: { date: string; cash: string };
  positions: number;
  dividends: string;
  currency: string;
};

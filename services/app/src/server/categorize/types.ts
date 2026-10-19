/**
 * Categorizers: built-in and external alike implement one interface, over the external API's
 * request and response (src/shared/categorizer-api.ts), so the chain treats them the same.
 *
 * Inside, a transaction to categorize also says which of its **splits** are still to place
 * (M16): a bank row has one, the whole amount; an itemized receipt has several. A proposal's
 * `postings` are the transaction's other side when there's one split, and its **fallback** (one
 * account, for whatever isn't placed otherwise) when there are several; `splits` place
 * particular ones.
 */
import type {
  CategorizeRequest,
  FeedbackRequest,
  HistoryTransaction,
  IncomingTransaction,
  Money,
  Proposal,
} from "../../shared/categorizer-api.js";

/** A split still to place: its index among the transaction's postings, its amount, and what it
 * is (a receipt's line). */
export type OpenSplit = {
  index: number;
  amount: Money;
  memo: string | null;
  /** The line in plain words, when the receipt's print was abbreviated: for the AI. */
  description?: string | null;
};

/** A transaction to categorize: the external API's, and its splits still to place. */
export type Incoming = IncomingTransaction & { splits: OpenSplit[] };

/** The history, with what each split was (its `memo:`), for item history. */
export type History = (Omit<HistoryTransaction, "postings"> & {
  postings: { account: string; amount: Money | null; memo?: string | null }[];
})[];

export type Request = Omit<CategorizeRequest, "transactions" | "context"> & {
  transactions: Incoming[];
  context: Omit<CategorizeRequest["context"], "history"> & { history: History };
};

/** A proposal, plus what only built-in categorizers may say. */
export type InternalProposal = Proposal & {
  /** Stage the transaction confirmed: only a user's own rule, with the box ticked. */
  auto_confirm?: boolean;
  /** The rule that made it, for counting how often rules apply. */
  rule_id?: string;
  /** Where the transaction's own side lands, a part of the divided account it came into (M15):
   * a user's own rule. */
  part?: string;
  /** Accounts for particular splits, by index (M16): item history and the AI. */
  splits?: { index: number; account: string }[];
  /** Accounts it would open, used in its proposal: the AI, with the book's account creation on. */
  opens?: string[];
};

export interface Categorizer {
  /** Shown in review as where a proposal came from, and used for acceptance rates. */
  name: string;
  categorize(request: Request): Promise<{ proposals: InternalProposal[] }>;
  /** Told what became of its proposals, if it wants to know. */
  feedback?(request: FeedbackRequest): Promise<void>;
}

/** A proposal that won, with the categorizer that made it. */
export type Chosen = InternalProposal & { categorizer: string };

/** What the chain decided for one transaction: the category (its other side, or with several
 * splits its fallback), the accounts for particular splits, and the payee, each possibly from a
 * different categorizer. */
export type Decision = { category?: Chosen; splits?: Map<number, Chosen>; payee?: Chosen };

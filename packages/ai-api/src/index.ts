/**
 * The ai service's API (M16), shared by the service, `app` and the PWA. The service owns
 * everything AI: each book's settings and its provider's credential, and two narrow operations
 * `app` composes: **extract** (what a receipt says, knowing nothing of the book) and
 * **categorize** (where a transaction's unconfirmed splits belong, never seeing an image). It
 * answers; `app` stages.
 */

export const PROVIDERS = ["claude", "fake"] as const;
/** `fake` answers without a model: test stacks only. */
export type ProviderName = (typeof PROVIDERS)[number];

export const EAGERNESS = ["reluctant", "average", "aggressive"] as const;
export type Eagerness = (typeof EAGERNESS)[number];

/** `GET /api/ai/v1/health`: the service is up, and which providers it can use. */
export type AiHealth = { status: "ok"; providers: ProviderName[] };

/** A book's AI settings. The credential itself never comes back: only whether there is one. */
export type AiSettings = {
  book_id: string;
  enabled: boolean;
  provider: ProviderName;
  credential: { set: boolean; hint: string | null };
  /** Enabled, with a provider the service has and a credential: receipts can be read. */
  ready: boolean;
  /** Receipt capture's "Itemize receipt?" default. */
  itemize: boolean;
  /** May the AI open accounts it thinks a transaction needs? */
  create_accounts: boolean;
  eagerness: Eagerness;
  /** What kinds of accounts you like, in your words. */
  guidance: string | null;
  /** Null until first saved. */
  updated_at: string | null;
};

export type AiSettingsPatch = Partial<
  Pick<
    AiSettings,
    "enabled" | "provider" | "itemize" | "create_accounts" | "eagerness" | "guidance"
  >
> & { updated_at: string | null };

/** What the person capturing a receipt said (all optional): hints, not answers. */
export type ReceiptHints = {
  /** The base account: where the money came from (or went to). */
  account?: string | null;
  /** As stored for the base account: negative is money out (a purchase). */
  total?: string | null;
  date?: string | null;
  payee?: string | null;
  note?: string | null;
  /** Itemize it into categorized splits (default: the book's setting). */
  itemize?: boolean | null;
};

/** An account in the chart, as categorizing sees it: the leaves it may choose from. */
export type ChartAccount = { name: string; type: string | null; display_name: string | null };

/** A receipt as `app` sends it: base64, and its type (an image, or a PDF). */
export type ReceiptFile = { data: string; media_type: string; filename?: string | null };

/** `POST /api/ai/v1/books/:book/receipts/extract`. */
export type ExtractIn = {
  file: ReceiptFile;
  /** The book's today (a receipt without a year is from the last 12 months) and currency. */
  today: string;
  currency: string;
};

export const CARD_BRANDS = ["visa", "mastercard", "amex", "discover", "other"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

/** One line of a receipt that makes up its total: an item, tax, a tip, a fee, a discount. */
export type ReceiptLine = {
  /** As printed ("EGGS HPPY 18"). */
  text: string;
  /** In plain words, when the print is abbreviated ("Happy Egg Co. eggs, 18 count"). */
  description: string | null;
  /** As printed: positive for what was paid for, negative for a discount. */
  amount: string;
};

/** What a receipt says, and nothing about the book. Every part may be unknown. */
export type ReceiptFacts = {
  payee: string | null;
  date: string | null;
  /** Only when the receipt's differs from the book's. */
  currency: string | null;
  /** What was charged to the payment (or refunded), as printed: positive. */
  total: string | null;
  /** The receipt's own words where the total was read ("TOTAL 23.50"). */
  total_evidence: string | null;
  /** Money back: a return. */
  refund: boolean;
  payment: {
    method: "card" | "cash" | "other" | null;
    brand: CardBrand | null;
    last_four: string | null;
  };
  /** The lines making up the total (not subtotals), summing to it. */
  lines: ReceiptLine[];
  /** The total less the lines' sum, when they still disagree after a second look; else null. */
  difference: string | null;
  /** Anything a person should know ("the tip is handwritten"). */
  note: string | null;
};

/** A transaction with splits still to place, as `app` asks about it. */
export type CategorizeTransaction = {
  /** Opaque, unique within the request. */
  id: string;
  date: string;
  payee: string | null;
  narration: string | null;
  /** Its splits already known (where the money came from), as they move their accounts. */
  known: { account: string; amount: string | null }[];
  /** The splits to place, by index, as they move their accounts (an expense is positive). */
  splits: { index: number; amount: string; memo: string | null }[];
};

/** A confirmed transaction from the book that bears on the ones asked about. */
export type CategorizeHistory = {
  date: string;
  payee: string | null;
  narration: string | null;
  postings: { account: string; amount: string | null; memo: string | null }[];
};

/** `POST /api/ai/v1/books/:book/categorize`. */
export type CategorizeIn = {
  transactions: CategorizeTransaction[];
  /** The leaves it may choose from. */
  accounts: ChartAccount[];
  history: CategorizeHistory[];
  currency: string;
};

/** Where a transaction's splits belong. */
export type SplitProposal = {
  id: string;
  /** Accounts for the splits it could place. */
  splits: { index: number; account: string }[];
  /** The account the transaction as a whole belongs to, for the splits it didn't place. */
  fallback: string | null;
  /** 0 to 1: how likely the person is to accept it unchanged. */
  confidence: number;
  /** One short sentence the person sees in review. */
  reason: string;
};

export type CategorizeOut = {
  proposals: SplitProposal[];
  /** Accounts it would open (only when the book lets it), used in its proposals. */
  new_accounts: string[];
};

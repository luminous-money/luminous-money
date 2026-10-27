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
export type ChartAccount = {
  name: string;
  type: string | null;
  display_name: string | null;
  /** What it's for, in the person's words. */
  description?: string | null;
};

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

/** What the person's history says about one payee (from another system's history and the
 * book's own, recent transactions weighing more): where its transactions went, and for how
 * much (as they moved those accounts: an expense is positive). */
export type PayeeReference = {
  /** As it was last written. */
  payee: string;
  /** How many transactions, and the last one's date. */
  seen: number;
  last: string;
  /** The most usual first: its share (by weight, recent counting more), how many, and its
   * amounts' middle, lowest and highest. */
  accounts: {
    account: string;
    share: number;
    seen: number;
    typical: string | null;
    low: string | null;
    high: string | null;
  }[];
};

/** `POST /api/ai/v1/books/:book/categorize`. */
export type CategorizeIn = {
  transactions: CategorizeTransaction[];
  /** The leaves it may choose from. */
  accounts: ChartAccount[];
  history: CategorizeHistory[];
  /** The reference's entries for payees like these transactions' (none: not used). */
  reference?: PayeeReference[];
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
  /** What answering cost (the ai service adds it). */
  cost?: AiCost;
};

/** `POST /api/ai/v1/books/:book/receipts/extract`'s answer: the facts, and what reading them
 * cost. */
export type ExtractOut = ReceiptFacts & { cost?: AiCost };

/** One call to a model, and what it cost, estimated from the usage it reported at the model's
 * list prices (USD). `usd` is null for a model whose prices aren't known. */
export type AiCall = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  usd: number | null;
};

/** What an operation's calls cost, together: their tokens, and the estimate (USD, null if any
 * model's prices aren't known). Every answer from the operations carries it as `cost`. */
export type AiCost = Omit<AiCall, "model" | "usd"> & {
  calls: number;
  models: string[];
  usd: number | null;
};

export const NO_COST: AiCost = {
  calls: 0,
  models: [],
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  usd: 0,
};

/** Two costs as one (an operation's calls, or several operations'). */
export function addCost(a: AiCost, b: AiCost | AiCall): AiCost {
  const calls = "calls" in b ? b.calls : 1;
  const models = "models" in b ? b.models : [b.model];
  return {
    calls: a.calls + calls,
    models: [...new Set([...a.models, ...models])],
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    usd: a.usd === null || b.usd === null ? null : a.usd + b.usd,
  };
}

/** Dollars as people read a small cost: "$0.0042", "$0.03", "$12.40"; unknown when null. */
export function formatUsd(usd: number | null): string {
  if (usd === null) return "an unknown amount";
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** `GET /api/ai/v1/books/:book/usage`: the book's AI spending in a month (UTC), by operation. */
export type AiUsage = {
  /** YYYY-MM. */
  month: string;
  usd: number | null;
  calls: number;
  operations: { operation: "extract" | "categorize"; count: number; usd: number | null }[];
};

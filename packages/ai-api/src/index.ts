/**
 * The ai service's API (M16), shared by the service, `app` and the PWA. The service owns
 * everything AI: each book's settings and its provider's credential, and reading receipts. It
 * reads; `app` stages what it read.
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

/** An account as the reader sees the chart. */
export type ChartAccount = { name: string; type: string | null; display_name: string | null };

/** `POST /api/ai/v1/books/:book/receipts/read`: what `app` sends. */
export type ReceiptReadIn = {
  /** The receipt: base64, and its type (an image, or a PDF). */
  file: { data: string; media_type: string; filename?: string | null };
  hints: ReceiptHints;
  /** The book's open accounts. */
  accounts: ChartAccount[];
  /** The book's today, and its currency. */
  today: string;
  currency: string;
};

/** A split the reader proposes, as stored on the category: positive is an expense. */
export type ReadSplit = { account: string; amount: string; memo: string | null };

/** What the reader made of a receipt: a proposed transaction, every part optional. `app` checks
 * it against the books before staging it. */
export type ReceiptReading = {
  /** The base account, decided from the hint and the receipt ("Visa 9499"). */
  account: string | null;
  /** As stored for the base account: negative for a purchase, positive for a refund. */
  total: string | null;
  currency: string | null;
  date: string | null;
  payee: string | null;
  narration: string | null;
  /** The fallback category for anything it can't place ("Expenses:Groceries"). */
  category: string | null;
  /** Categorized splits summing to minus the total (one, when not itemizing). */
  splits: ReadSplit[];
  /** Accounts it would open (only when the book lets it). */
  new_accounts: string[];
  /** Anything worth saying ("the tip is handwritten"). */
  note: string | null;
};

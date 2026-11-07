/** Shops' orders (Amazon orders, step 2), for the server and the PWA alike: what a shop's reader
 * (the `shops` service, or a script) hands the book, and what the book made of each. */

/** A line of a charge: an item (its price less its share of discounts), tax, shipping, or what
 * paid besides the card (a gift card, rewards points: from `account`). Positive for what was
 * bought; a charge's lines sum to what its card paid. */
export type OrderLine = {
  text: string;
  amount: string;
  /** Where it's from, when that's known (a gift card's account); else it's categorized. */
  account?: string | null;
  quantity?: number;
  url?: string | null;
};

/** A charge to a card, as the shop shows it: negative a purchase, positive a refund. */
export type OrderCharge = {
  /** The shop's ID for it (the same charge again changes nothing). */
  id: string;
  shop: string;
  date: string;
  amount: string;
  card: { last_four: string; brand?: string | null } | null;
  orders: { number: string; url?: string | null }[];
  lines: OrderLine[];
  /** Anything worth saying about its lines (they're a guess, its order wasn't read…). */
  note?: string | null;
};

/**
 * What the book made of a charge:
 * - `waiting`: no account in the book holds its card (or it was paid without one); `detail`
 *   says which. Tried again whenever its shop sends charges, and after each bank feed sync.
 * - `read`: itemized into its transaction (`transaction_id`): the bank's copy, or one made for it
 *   that the bank's copy is matched to when it comes in. In review.
 */
export type OrderState = "waiting" | "read";

export type StoredCharge = OrderCharge & {
  state: OrderState;
  detail: string | null;
  transaction_id: string | null;
  updated_at: string;
};

/** Whether a shop's order was read into the transaction (`order-read:`, the day it was). */
export const hasOrder = (meta: Record<string, unknown> | null | undefined) =>
  typeof meta?.["order-read"] === "string";

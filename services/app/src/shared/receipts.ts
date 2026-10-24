/** Receipts' marks on a transaction (M16), for the server and the PWA alike. */

/** Whether a receipt was read into the transaction: made from one (`source: "receipt"`), or read
 * into it later (`receipt-read:`, the day it was). */
export const hasReceipt = (meta: Record<string, unknown> | null | undefined) =>
  meta?.["source"] === "receipt" || typeof meta?.["receipt-read"] === "string";

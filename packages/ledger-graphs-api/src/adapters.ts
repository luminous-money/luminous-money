import type { Posting } from "./types.js";

/** A transaction as many ledgers' APIs give one: an ID, a date, and postings with amounts
 * (Beancount-shaped: `{ number, currency }`, null where only booking could say). */
export type TransactionLike = {
  id: string;
  date: string;
  flag?: string;
  budgeted?: boolean;
  payee?: string | null;
  narration?: string | null;
  postings: { account: string; amount?: { number: string; currency: string } | null }[];
};

/** The posting stream from transactions: one entry per posting with an amount. */
export function fromTransactions(transactions: TransactionLike[]): Posting[] {
  return transactions.flatMap((t) =>
    t.postings.flatMap((p) =>
      p.amount
        ? [
            {
              transaction: t.id,
              date: t.date,
              flag: t.flag,
              budgeted: t.budgeted,
              payee: t.payee ?? null,
              narration: t.narration ?? null,
              account: p.account,
              amount: p.amount.number,
              currency: p.amount.currency,
            },
          ]
        : []
    )
  );
}

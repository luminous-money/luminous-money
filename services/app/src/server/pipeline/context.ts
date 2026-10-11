/**
 * The context a batch is resolved in: the account's existing transactions from `from` to `to`.
 * Read from the account's ledger, newest first, until it's older than `from`. (M4's categorizer
 * will want a longer window, about 14 months: a parameter, not a new builder.)
 */
import type { LedgerPort } from "../ledger.js";
import type { Context, Existing } from "./types.js";

export async function buildContext(
  ledger: LedgerPort,
  book: string,
  account: string,
  from: string,
  to: string
): Promise<Context> {
  const existing: Existing[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await ledger.accountLedger(book, account, cursor);
    for (const row of page.rows) {
      if (row.date >= from && row.date <= to) {
        existing.push({
          id: row.id,
          date: row.date,
          flag: row.flag,
          payee: row.payee,
          narration: row.narration,
          amount: row.amount,
        });
      }
    }
    const oldest = page.rows.at(-1);
    if (!page.next_cursor || !oldest || oldest.date < from) break;
    cursor = page.next_cursor;
  }
  return { account, existing };
}

/**
 * The context categorizers work from, built once per batch: the book's chart of accounts and
 * every transaction from the 14 months before the batch's earliest one, on (from all accounts,
 * never sampled), in the shape of the external API's request.
 */
import { randomUUID } from "node:crypto";

import { CATEGORIZER_API_VERSION } from "../../shared/categorizer-api.js";
import type { LedgerPort } from "../ledger.js";
import type { Incoming, Request } from "./types.js";

export const CONTEXT_MONTHS = 14;

/** `date` (ISO) less `months` months, clamped to the month's end. */
export function monthsBefore(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export async function buildRequest(
  ledger: LedgerPort,
  book: { id: string; name: string },
  transactions: Incoming[]
): Promise<Request> {
  const earliest = transactions.map((t) => t.date).sort()[0]!;
  const from = monthsBefore(earliest, CONTEXT_MONTHS);
  const [accounts, history] = await Promise.all([
    ledger.accounts(book.id),
    ledger.compact(book.id, from),
  ]);
  return {
    api_version: CATEGORIZER_API_VERSION,
    request_id: randomUUID().replace(/-/g, ""),
    book,
    transactions,
    context: {
      from,
      accounts: accounts.map((a) => ({
        name: a.name,
        type: a.type ?? null,
        kind: a.kind,
        open: a.open ?? null,
        close: a.close ?? null,
        display_name: a.display_name ?? null,
        description: a.description ?? null,
      })),
      history: history.map((t) => ({
        id: t.id,
        date: t.date,
        flag: t.flag,
        payee: t.payee ?? null,
        narration: t.narration ?? null,
        postings: t.postings.map((p) => ({
          account: p.account,
          amount: p.amount ?? null,
          memo: p.memo ?? null,
        })),
      })),
    },
  };
}

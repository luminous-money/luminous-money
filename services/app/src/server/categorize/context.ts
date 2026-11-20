/**
 * The context categorizers work from, built once per batch: the book's chart of accounts and
 * every transaction from the 14 months before the batch's earliest one, on (from all accounts,
 * never sampled), in the shape of the external API's request; and the tags that history has
 * (what a categorizer may propose, besides `hsa-fsa-eligible`).
 */
import { randomUUID } from "node:crypto";

import { CATEGORIZER_API_VERSION, type ContextTag } from "../../shared/categorizer-api.js";
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

/** The tags `history` has: how many transactions have each, and its first and last dates. */
export function contextTags(history: Request["context"]["history"]): ContextTag[] {
  const found = new Map<string, ContextTag>();
  for (const t of history)
    for (const name of new Set(t.postings.flatMap((p) => p.tags ?? []))) {
      const tag = found.get(name);
      if (!tag) found.set(name, { name, count: 1, first: t.date, last: t.date });
      else {
        tag.count++;
        if (t.date < tag.first) tag.first = t.date;
        if (t.date > tag.last) tag.last = t.date;
      }
    }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
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
  const past: Request["context"]["history"] = history.map((t) => ({
    id: t.id,
    date: t.date,
    flag: t.flag,
    payee: t.payee ?? null,
    narration: t.narration ?? null,
    postings: t.postings.map((p) => ({
      account: p.account,
      amount: p.amount ?? null,
      memo: p.memo ?? null,
      ...(p.tags?.length ? { tags: p.tags } : {}),
    })),
  }));
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
      history: past,
      tags: contextTags(past),
    },
  };
}

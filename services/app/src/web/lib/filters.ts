/**
 * The journal's filters (`JournalFilter`) for lists held in memory, the review queue's: what the
 * ledger's `/journal` keeps, read the same way. Reconciliation isn't read here.
 */
import { splitHas } from "../../shared/tags.js";
import type { JournalFilter } from "./ledger.js";

type Filterable = {
  payee?: string | null;
  narration?: string | null;
  postings: { account: string; tags?: string[] | null; meta?: Record<string, unknown> | null }[];
};

/** The words searched for: whitespace apart, ignoring case. */
const wordsOf = (q: string | undefined) => (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/** Whether every word of `q` is in the payee, the narration or a split's memo (a receipt's
 * line), ignoring case. */
export function matchesSearch(t: Filterable, q: string | undefined): boolean {
  const words = wordsOf(q);
  if (!words.length) return true;
  const texts = [
    t.payee ?? "",
    t.narration ?? "",
    ...t.postings.map((p) => (typeof p.meta?.["memo"] === "string" ? p.meta["memo"] : "")),
  ].map((text) => text.toLowerCase());
  return words.every((word) => texts.some((text) => text.includes(word)));
}

/** Whether a split is in any of `accounts`, or under one (none: any transaction). */
export function touchesAny(t: Filterable, accounts: readonly string[] | undefined): boolean {
  if (!accounts?.length) return true;
  return t.postings.some((p) =>
    accounts.some((a) => p.account === a || p.account.startsWith(`${a}:`))
  );
}

/** Whether a transaction is kept by `filter`: a split with every tag, the search and the
 * accounts. */
export function kept(t: Filterable, filter: JournalFilter): boolean {
  return (
    splitHas(t.postings, filter.tags ?? []) &&
    matchesSearch(t, filter.q) &&
    touchesAny(t, filter.accounts)
  );
}

/** Whether a filter keeps fewer than everything. */
export const filtering = (filter: JournalFilter) =>
  filter.reconciled !== undefined ||
  !!filter.tags?.length ||
  wordsOf(filter.q).length > 0 ||
  !!filter.accounts?.length;

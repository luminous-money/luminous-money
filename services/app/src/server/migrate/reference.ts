/**
 * The reference: what a book's history says about each payee, for categorizing. It's derived,
 * never stored: from another system's imported history and the book's own confirmed
 * transactions, each time it's used, so it keeps up as history grows. Recent transactions weigh
 * more (`0.5 ^ (age in days / HALF_LIFE)`).
 *
 * From each transaction with a balance-sheet side (where an import comes from): its payee key
 * (`shared/payees.ts`), and its other postings' accounts and amounts. A transfer (only
 * balance-sheet postings) isn't a payee's category, so it's left out here (the history
 * categorizer still learns transfers, seen from each side). Only accounts that can take a
 * proposal count: open leaves, not uncategorized.
 *
 * Used by the AI categorizer (the entries for payees like a batch's) and to suggest rules.
 */
import type { PayeeReference } from "@luminous-money/ai-api";

import { isUncategorized } from "../../shared/accounts.js";
import { keySimilarity, payeeKey } from "../../shared/payees.js";
import type { RuleSuggestion } from "../../shared/migration.js";
import type { CategoryRule } from "../../shared/rules.js";
import type { History, Incoming } from "../categorize/types.js";

export const HALF_LIFE = 180;

/** A transaction as the reference reads it: what it was called, and where its money went. */
export type Seen = {
  date: string;
  description: string;
  postings: { account: string; amount: string | null }[];
};

/** One payee's entry: the AI's view, plus its key and weight. */
export type Entry = PayeeReference & { key: string; weight: number };

export type { RuleSuggestion };

/** The book's own confirmed history, as the reference reads it. */
export const seenInBook = (history: History): Seen[] =>
  history
    .filter((t) => t.flag === "*")
    .map((t) => ({
      date: t.date,
      description: t.narration || t.payee || "",
      postings: t.postings.map((p) => ({ account: p.account, amount: p.amount?.number ?? null })),
    }));

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 864e5;
const money = (n: number) => n.toFixed(2);
const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Every payee's entry, the weightiest first. `balanceSheet` says which accounts are a
 * transaction's own side; `usable`, which accounts a proposal can name.
 */
export function buildReference(
  seen: Seen[],
  {
    today,
    balanceSheet,
    usable,
  }: {
    today: string;
    balanceSheet: (account: string) => boolean;
    usable: (account: string) => boolean;
  }
): Entry[] {
  type Tally = { weight: number; seen: number; amounts: number[] };
  const payees = new Map<
    string,
    { payee: string; last: string; weight: number; seen: number; accounts: Map<string, Tally> }
  >();
  for (const t of seen) {
    const key = payeeKey(t.description);
    if (!key || !t.postings.some((p) => balanceSheet(p.account))) continue;
    const others = t.postings.filter((p) => !balanceSheet(p.account) && usable(p.account));
    if (!others.length) continue;
    const weight = 0.5 ** (Math.max(0, days(t.date, today)) / HALF_LIFE);
    const entry = payees.get(key) ?? {
      payee: t.description,
      last: "",
      weight: 0,
      seen: 0,
      accounts: new Map<string, Tally>(),
    };
    if (t.date >= entry.last) [entry.last, entry.payee] = [t.date, t.description];
    entry.weight += weight;
    entry.seen += 1;
    for (const p of others) {
      const tally = entry.accounts.get(p.account) ?? { weight: 0, seen: 0, amounts: [] };
      tally.weight += weight / others.length;
      tally.seen += 1;
      if (p.amount !== null) tally.amounts.push(Number(p.amount));
      entry.accounts.set(p.account, tally);
    }
    payees.set(key, entry);
  }
  return [...payees]
    .map(([key, e]) => ({
      key,
      payee: e.payee,
      weight: Number(e.weight.toFixed(4)),
      seen: e.seen,
      last: e.last,
      accounts: [...e.accounts]
        .map(([account, a]) => ({
          account,
          share: Number((a.weight / e.weight).toFixed(2)),
          seen: a.seen,
          typical: a.amounts.length ? money(median(a.amounts)) : null,
          low: a.amounts.length ? money(Math.min(...a.amounts)) : null,
          high: a.amounts.length ? money(Math.max(...a.amounts)) : null,
        }))
        .sort((a, b) => b.share - a.share || b.seen - a.seen),
    }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
}

/** How alike a payee's key is to a transaction's: shared words, and one's words all in the
 * other's ("kroger" in "kroger cincinnati") counting as close. */
function closeness(entry: string, key: string): number {
  const overlap = keySimilarity(entry, key);
  const a = entry.split(" ");
  const b = new Set(key.split(" "));
  return overlap > 0 && a.every((w) => b.has(w)) ? Math.max(overlap, 0.75) : overlap;
}

/** The entries for payees like these transactions' (the closest `each` per transaction, at
 * least `min` alike), at most `max` in all, closest first. */
export function entriesFor(
  reference: Entry[],
  descriptions: string[],
  { each = 3, min = 0.34, max = 40 } = {}
): Entry[] {
  const best = new Map<string, { entry: Entry; score: number }>();
  for (const description of descriptions) {
    const key = payeeKey(description);
    if (!key) continue;
    reference
      .map((entry) => ({ entry, score: closeness(entry.key, key) }))
      .filter((x) => x.score >= min)
      .sort((a, b) => b.score - a.score || b.entry.weight - a.entry.weight)
      .slice(0, each)
      .forEach((x) => {
        const had = best.get(x.entry.key);
        if (!had || had.score < x.score) best.set(x.entry.key, x);
      });
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || b.entry.weight - a.entry.weight)
    .slice(0, max)
    .map((x) => x.entry);
}

/**
 * Rules from the reference: a payee seen at least `least` times, at least `share` of them to one
 * account, that no rule already matches by its key (or contains it). Each matches by key, or by
 * containing the key if that catches more of what's `waiting` (a single word only if it's at
 * least 4 letters). The most waiting, then most seen, first.
 */
export function suggestRules(
  reference: Entry[],
  rules: CategoryRule[],
  waiting: Incoming[],
  { least = 3, share = 0.9 } = {}
): RuleSuggestion[] {
  const covered = new Set(
    rules.flatMap((r) => [r.conditions.key, r.conditions.contains?.toLowerCase()]).filter(Boolean)
  );
  const keys = waiting.map((t) => payeeKey(t.description));
  const texts = waiting.map((t) => t.description.toLowerCase());
  return reference
    .flatMap((e): RuleSuggestion[] => {
      const [top] = e.accounts;
      if (!top || e.seen < least || top.seen / e.seen < share || covered.has(e.key)) return [];
      if (e.key.length < 3 || isUncategorized(top.account)) return [];
      const byKey = keys.filter((k) => k === e.key).length;
      const containable = e.key.includes(" ") || e.key.length >= 4;
      const byText = containable ? texts.filter((t) => t.includes(e.key)).length : 0;
      return [
        {
          key: e.key,
          match: byText > byKey ? "contains" : "key",
          payee: e.payee,
          account: top.account,
          seen: e.seen,
          matched: top.seen,
          waiting: Math.max(byKey, byText),
        },
      ];
    })
    .sort((a, b) => b.waiting - a.waiting || b.seen - a.seen || a.key.localeCompare(b.key));
}

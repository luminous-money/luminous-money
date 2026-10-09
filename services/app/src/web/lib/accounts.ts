import type { Account } from "@fava-beans/ledger-client";

/** Accounts a transaction dated `date` (ISO) can post to: leaves, open on that date. */
export function postable(accounts: Account[], date: string): string[] {
  return accounts
    .filter((a) => a.kind === "leaf" && (!a.open || a.open <= date) && (!a.close || a.close > date))
    .map((a) => a.name);
}

/** Accounts a new account can go under: nodes that aren't closed. */
export function parentChoices(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.kind === "node" && !a.close);
}

export const TYPE_LABELS: Record<NonNullable<Account["type"]>, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

/** Roots to list first, given which way money moved on the anchor side. */
export function preferredRoots(outflow: boolean): string[] {
  return outflow
    ? ["Expenses", "Liabilities", "Assets", "Income", "Equity"]
    : ["Income", "Assets", "Liabilities", "Expenses", "Equity"];
}

/**
 * Account search for the picker. Every word of the query must appear in the name. Matches at the
 * start of a segment rank first (so "food rest" finds Expenses:Food:Restaurant), then preferred
 * roots, then shorter names.
 */
export function search(names: string[], query: string, prefer: string[] = []): string[] {
  const words = query
    .toLowerCase()
    .split(/[\s:]+/)
    .filter(Boolean);
  const rootRank = (name: string) => {
    const i = prefer.indexOf(name.split(":")[0]!);
    return i === -1 ? prefer.length : i;
  };
  const scored = names
    .map((name) => {
      const lower = name.toLowerCase();
      if (!words.every((w) => lower.includes(w))) return null;
      const segments = lower.split(":");
      const score = words.filter((w) => segments.some((s) => s.startsWith(w))).length;
      return { name, score };
    })
    .filter((x): x is { name: string; score: number } => x !== null);
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        rootRank(a.name) - rootRank(b.name) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name)
    )
    .map((x) => x.name);
}

/** The last two segments, for compact display ("Food:Restaurant"). */
export function shortName(account: string): string {
  return account.split(":").slice(-2).join(":");
}

/** One segment of an account name, as Beancount requires: a capital letter or digit, then
 * letters, digits and dashes. */
const SEGMENT = /^[\p{Lu}\p{Nd}][\p{L}\p{Nd}-]*$/u;

export function isSegment(text: string): boolean {
  return SEGMENT.test(text);
}

/** Turn whatever was typed into a valid segment: "coffee shops" becomes "Coffee-Shops". */
export function toSegment(text: string): string {
  return text
    .split(/[\s_]+/)
    .map((word) => word.replace(/[^\p{L}\p{Nd}-]/gu, ""))
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("-");
}

/**
 * Read a search as the start of a new account. A typed path whose front names a node, like
 * "Expenses:Utilities:Power" (or just "utilities:power"), suggests that node as the parent;
 * otherwise only the name is suggested, and the parent is left to choose.
 */
export function suggestNew(query: string, parents: string[]): { name: string; parent: string } {
  const segments = query.split(":").map((s) => s.trim());
  const last = segments.pop() ?? "";
  if (segments.length) {
    const path = segments.join(":").toLowerCase();
    const parent =
      parents.find((p) => p.toLowerCase() === path) ??
      parents.find((p) => p.toLowerCase().endsWith(`:${path}`));
    if (parent) return { name: toSegment(last), parent };
  }
  return { name: toSegment(query.replace(/:/g, " ")), parent: "" };
}

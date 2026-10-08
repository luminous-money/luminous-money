import type { Account } from "@fava-beans/ledger-client";

/** Accounts that are open on `date` (an ISO date string). */
export function openOn(accounts: Account[], date: string): string[] {
  return accounts.filter((a) => a.open <= date && (!a.close || a.close > date)).map((a) => a.name);
}

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

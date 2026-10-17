import { atDepth, flowSign, lastPart, under } from "./accounts.js";
import { addMonths, monthOf } from "./dates.js";
import { cents, units } from "./money.js";
import { DEFAULT_ROOTS, type Posting, type Roots } from "./types.js";

export type Slice = {
  account: string;
  label: string;
  amount: number;
  /** Of the total, 0 to 1. */
  share: number;
  /** Whether it has accounts under it to drill into. */
  more: boolean;
};

export type Breakdown = {
  currency: string;
  /** What's broken down: the root, or the category drilled into. */
  of: string;
  window: "average" | "month";
  /** The complete months averaged over (the window "average"). */
  months: number;
  total: number;
  slices: Slice[];
  /** The rest, together. */
  other: { amount: number; share: number; accounts: string[] } | null;
};

/**
 * Where the money goes (or comes from): the largest categories `depth` levels under `root`
 * (or, drilling in, the accounts just under `of`), each as a monthly average over the last
 * `months` complete months, or this month so far; the rest as Other.
 */
export function breakdown({
  postings,
  today,
  currency,
  root,
  of,
  depth = 1,
  slices = 6,
  window = "average",
  months = 6,
  roots = DEFAULT_ROOTS,
}: {
  postings: Posting[];
  today: string;
  currency: string;
  root?: string;
  of?: string;
  depth?: number;
  slices?: number;
  window?: "average" | "month";
  months?: number;
  roots?: Roots;
}): Breakdown {
  const base = of ?? root ?? roots.expenses;
  const levels = of ? 1 : depth;
  const current = monthOf(today);
  const inWindow =
    window === "month"
      ? (m: string) => m === current
      : (() => {
          const set = new Set(
            Array.from({ length: months }, (_, i) => addMonths(current, -months + i))
          );
          return (m: string) => set.has(m);
        })();
  const sums = new Map<string, number>();
  const deeper = new Set<string>();
  for (const posting of postings) {
    if (posting.currency !== currency || !under(posting.account, base)) continue;
    if (posting.date > today || !inWindow(monthOf(posting.date))) continue;
    const key = atDepth(posting.account, base, levels);
    sums.set(key, (sums.get(key) ?? 0) + cents(posting.amount) * flowSign(base, roots));
    if (posting.account !== key) deeper.add(key);
  }
  const divisor = window === "average" ? months : 1;
  const ranked = [...sums]
    .map(([account, sum]) => ({ account, sum: sum / divisor }))
    .filter((c) => c.sum > 0)
    .sort((a, b) => b.sum - a.sum);
  const total = ranked.reduce((n, c) => n + c.sum, 0);
  // Other only when it holds two or more: one left over is shown as itself.
  const shown = ranked.length === slices + 1 ? ranked : ranked.slice(0, slices);
  const rest = ranked.slice(shown.length);
  const share = (sum: number) => (total ? sum / total : 0);
  return {
    currency,
    of: base,
    window,
    months: window === "average" ? months : 0,
    total: units(total),
    slices: shown.map((c) => ({
      account: c.account,
      label: c.account === base ? `${lastPart(base)} (itself)` : lastPart(c.account),
      amount: units(c.sum),
      share: share(c.sum),
      more: deeper.has(c.account),
    })),
    other: rest.length
      ? {
          amount: units(rest.reduce((n, c) => n + c.sum, 0)),
          share: share(rest.reduce((n, c) => n + c.sum, 0)),
          accounts: rest.map((c) => c.account),
        }
      : null,
  };
}

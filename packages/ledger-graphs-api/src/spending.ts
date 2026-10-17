import { under } from "./accounts.js";
import { addMonths, dayOf, daysInMonth, monthOf } from "./dates.js";
import { cents, units } from "./money.js";
import { percentile, pick, random } from "./stats.js";
import { DEFAULT_ROOTS, type Posting, type Roots } from "./types.js";

export type SpendingThisMonth = {
  /** YYYY-MM. */
  month: string;
  currency: string;
  /** The month's length, and today's day of it. */
  days: number;
  today: number;
  /** The running total spent, day 1 to today (what's kept out of budgets left out). */
  actual: number[];
  spent: number;
  /** The month's budget, if there is one. */
  budget: number | null;
  /** What a month comes to by each day, at `percentile`, from simulated months (everything
   * counted); null without history. */
  projection: number[] | null;
  percentile: number;
  /** Where the projection says the month ends. */
  projected_end: number | null;
};

export type SpendingOptions = {
  postings: Posting[];
  /** YYYY-MM-DD: the caller's today. */
  today: string;
  currency: string;
  /** What counts as spending (each with what's under it): the expenses root by default. */
  accounts?: string[];
  budget?: number | null;
  /** Complete months before this one to draw from. */
  history?: number;
  runs?: number;
  percentile?: number;
  seed?: number;
  roots?: Roots;
};

/**
 * This month's spending by day against the budget and a simulated month. Each simulated month
 * draws every day from the same day of one of the last `history` complete months (one that has
 * it), so the rent on the 1st and the paydays stay where they fall; the projection is each
 * day's `percentile` of the running totals.
 */
export function spendingThisMonth({
  postings,
  today,
  currency,
  accounts,
  budget = null,
  history = 12,
  runs = 2000,
  percentile: p = 0.85,
  seed = 1,
  roots = DEFAULT_ROOTS,
}: SpendingOptions): SpendingThisMonth {
  const scope = accounts?.length ? accounts : [roots.expenses];
  const month = monthOf(today);
  const days = daysInMonth(month);
  const past = Array.from({ length: history }, (_, i) => addMonths(month, -history + i));
  const pastSet = new Set(past);
  const daily = new Map(past.map((m) => [m, new Array<number>(daysInMonth(m) + 1).fill(0)]));
  const now = new Array<number>(days + 1).fill(0);
  let seen = false;
  for (const posting of postings) {
    if (posting.currency !== currency || !scope.some((a) => under(posting.account, a))) continue;
    const m = monthOf(posting.date);
    const amount = cents(posting.amount);
    if (m === month && posting.date <= today && posting.budgeted !== false)
      now[dayOf(posting.date)]! += amount;
    if (pastSet.has(m)) {
      daily.get(m)![dayOf(posting.date)]! += amount;
      seen = true;
    }
  }

  const actual: number[] = [];
  let running = 0;
  for (let d = 1; d <= dayOf(today); d++) actual.push(units((running += now[d]!)));

  let projection: number[] | null = null;
  if (seen) {
    const next = random(seed);
    const having = Array.from({ length: days + 1 }, (_, d) =>
      past.filter((m) => daysInMonth(m) >= d)
    );
    const totals = Array.from({ length: days }, () => new Array<number>(runs));
    for (let r = 0; r < runs; r++) {
      let total = 0;
      for (let d = 1; d <= days; d++) {
        const from = having[d]!;
        if (from.length) total += daily.get(pick(from, next))![d]!;
        totals[d - 1]![r] = total;
      }
    }
    projection = totals.map((t) => units(percentile(t, p)));
  }
  return {
    month,
    currency,
    days,
    today: dayOf(today),
    actual,
    spent: actual.at(-1) ?? 0,
    budget,
    projection,
    percentile: p,
    projected_end: projection?.at(-1) ?? null,
  };
}

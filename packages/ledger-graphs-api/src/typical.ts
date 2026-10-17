import { flowSign, under } from "./accounts.js";
import { addDays, addMonths, daysInMonth, monthOf, weekOf, yearOf } from "./dates.js";
import { cents, units } from "./money.js";
import { median, percentile, pick, random } from "./stats.js";
import { DEFAULT_ROOTS, type Posting, type Roots } from "./types.js";

export type Typical = {
  /** The median of its complete periods. */
  median: number;
  /** What `percentile` of simulated periods stay under. */
  high: number;
  /** How many complete periods there were. */
  periods: number;
};

export type TypicalPeriods = {
  account: string;
  currency: string;
  percentile: number;
  week: Typical;
  month: Typical;
  year: Typical;
};

/**
 * What an account's week, month and year typically come to (its subtree's flow, read as the
 * account reads): the median of its last 52 weeks, 12 months and up to 5 calendar years (the
 * last 12 months while there's less), and what `percentile` of simulated ones stay under. A
 * simulated week draws each weekday from the same weekday of one of the 52; a month, each day
 * from the same day of one of the 12 (and its length from one of them); a year, each month from
 * the same month of one of the years.
 */
export function typicalPeriods({
  postings,
  account,
  today,
  currency,
  since,
  weekStart = 1,
  runs = 2000,
  percentile: p = 0.85,
  seed = 1,
  roots = DEFAULT_ROOTS,
}: {
  postings: Posting[];
  account: string;
  today: string;
  currency: string;
  /** The book's first day: years before it aren't counted. */
  since?: string;
  weekStart?: number;
  runs?: number;
  percentile?: number;
  seed?: number;
  roots?: Roots;
}): TypicalPeriods {
  const sign = flowSign(account, roots);
  const byDay = new Map<string, number>();
  for (const posting of postings) {
    if (posting.currency !== currency || !under(posting.account, account) || posting.date > today)
      continue;
    byDay.set(posting.date, (byDay.get(posting.date) ?? 0) + cents(posting.amount) * sign);
  }
  const on = (date: string) => byDay.get(date) ?? 0;
  const next = random(seed);
  const simulate = (draw: () => number) => units(percentile(Array.from({ length: runs }, draw), p));

  // Weeks: the 52 before this one.
  const thisWeek = weekOf(today, weekStart);
  const weeks = Array.from({ length: 52 }, (_, i) => addDays(thisWeek, -7 * (52 - i)));
  const weekTotals = weeks.map((w) => Array.from({ length: 7 }, (_, d) => on(addDays(w, d))));
  const week: Typical = {
    median: units(median(weekTotals.map((t) => t.reduce((a, b) => a + b, 0)))),
    high: simulate(() => {
      let total = 0;
      for (let d = 0; d < 7; d++) total += pick(weekTotals, next)[d]!;
      return total;
    }),
    periods: weeks.length,
  };

  // Months: the 12 before this one.
  const thisMonth = monthOf(today);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, i - 12));
  const monthDays = months.map((m) =>
    Array.from({ length: daysInMonth(m) }, (_, d) => on(`${m}-${String(d + 1).padStart(2, "0")}`))
  );
  const month: Typical = {
    median: units(median(monthDays.map((t) => t.reduce((a, b) => a + b, 0)))),
    high: simulate(() => {
      const length = pick(monthDays, next).length;
      let total = 0;
      for (let d = 0; d < length; d++)
        total += pick(
          monthDays.filter((m) => m.length > d),
          next
        )[d]!;
      return total;
    }),
    periods: months.length,
  };

  // Years: complete calendar years in the last 5 (from the book's first), else the last 12 months.
  const first = yearOf(today) - 5;
  const counted = since ? (since.endsWith("-01-01") ? yearOf(since) : yearOf(since) + 1) : first;
  const from = Math.max(first, counted);
  const years = Array.from({ length: yearOf(today) - from }, (_, i) => from + i);
  const yearMonths = years.length
    ? years.map((y) =>
        Array.from({ length: 12 }, (_, m) => {
          const ym = `${y}-${String(m + 1).padStart(2, "0")}`;
          let total = 0;
          for (let d = 1; d <= daysInMonth(ym); d++)
            total += on(`${ym}-${String(d).padStart(2, "0")}`);
          return total;
        })
      )
    : [monthDays.map((t) => t.reduce((a, b) => a + b, 0))];
  const year: Typical = {
    median: units(median(yearMonths.map((t) => t.reduce((a, b) => a + b, 0)))),
    high: simulate(() => {
      let total = 0;
      for (let m = 0; m < 12; m++) total += pick(yearMonths, next)[m]!;
      return total;
    }),
    periods: years.length || 1,
  };

  return { account, currency, percentile: p, week, month, year };
}

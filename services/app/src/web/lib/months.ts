import { formatMonth, today } from "./format.js";

/** Months as YYYY-MM. */

export const monthOf = (date: string) => date.slice(0, 7);

export const thisMonth = () => monthOf(today());

/** The month `n` months after `month` (before, `n` negative). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** A month as it reads: "Nov 2026". */
export const monthName = (month: string) => formatMonth(`${month}-01`);

/** A range of months: from `from` (or, "start", the first there is) through `through`. */
export type MonthSpan = { from: string; through: string };

/** A span as it reads: "Nov 2026" for one month, "Jun 2026 – Nov 2026", or, from the start,
 * "All time" (through this month) or "Start – Mar 2026". */
export function spanName({ from, through }: MonthSpan): string {
  if (from === "start")
    return through === thisMonth() ? "All time" : `Start – ${monthName(through)}`;
  if (from === through) return monthName(from);
  return `${monthName(from)} – ${monthName(through)}`;
}

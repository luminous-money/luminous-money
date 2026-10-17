/**
 * Budgets in the PWA (M11): the periods offered, where a new budget's periods start, and how
 * a budget reads. The ledger keeps budgets and measures them (its `budgets` module); the
 * periods themselves are counted there.
 */
import type { Budget, BudgetLine } from "./ledger.js";

export type Unit = Budget["unit"];
export type Period = { every: number; unit: Unit };

/** The periods offered by name; any other every-N is "Custom". */
export const PERIODS: (Period & { label: string })[] = [
  { label: "Weekly", every: 1, unit: "week" },
  { label: "Every 2 weeks", every: 2, unit: "week" },
  { label: "Monthly", every: 1, unit: "month" },
  { label: "Quarterly", every: 3, unit: "month" },
  { label: "Yearly", every: 1, unit: "year" },
];

export const UNITS: Unit[] = ["day", "week", "month", "year"];

const DAY_MS = 864e5;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);

/**
 * Where a new budget's periods start by default: the first day of the calendar period `today`
 * is in. This week's first day (`weekStart`: 0 Sunday to 6 Saturday), the 1st of the month, the
 * first of the quarter (for every 3 months), January 1; for days, today.
 */
export function defaultStart({ every, unit }: Period, today: string, weekStart: number): string {
  const [year, month] = today.split("-");
  if (unit === "day") return today;
  if (unit === "week") {
    const back = (new Date(parse(today)).getUTCDay() - weekStart + 7) % 7;
    return iso(parse(today) - back * DAY_MS);
  }
  if (unit === "year") return `${year}-01-01`;
  if (every % 3 === 0) {
    const first = Math.floor((Number(month) - 1) / 3) * 3 + 1;
    return `${year}-${String(first).padStart(2, "0")}-01`;
  }
  return `${year}-${month}-01`;
}

/** The period in words: "a month", "a quarter", "every 2 weeks". */
export function per({ every, unit }: Period): string {
  if (every === 1) return `a ${unit}`;
  if (unit === "month" && every === 3) return "a quarter";
  return `every ${every} ${unit}s`;
}

/** The current period in words: "this month", "this quarter", "this period". */
export function thisPeriod({ every, unit }: Period): string {
  if (every === 1) return `this ${unit}`;
  if (unit === "month" && every === 3) return "this quarter";
  return "this period";
}

/** Days left in a line's period, today included. */
export function daysLeft(line: Pick<BudgetLine, "period_end">, today: string): number {
  return Math.round((parse(line.period_end) - parse(today)) / DAY_MS);
}

export type Standing = "under" | "near" | "over" | "reached";

/**
 * How it's going: a limit is near past 90% and over past 100%; a goal is reached at 100%. The
 * share is for drawing only (how full the bar is), so floating point is fine here.
 */
export function standing(
  kind: BudgetLine["kind"],
  budget: string,
  spent: string
): { share: number; standing: Standing } {
  const b = Number(budget);
  const s = Number(spent);
  const share = b > 0 ? Math.max(s, 0) / b : s > 0 ? Infinity : 0;
  if (kind === "goal") return { share, standing: share >= 1 ? "reached" : "under" };
  return { share, standing: share > 1 ? "over" : share >= 0.9 ? "near" : "under" };
}

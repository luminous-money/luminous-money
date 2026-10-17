/** Dates as YYYY-MM-DD strings, in UTC, so no time zone moves them. Months are YYYY-MM. */

const DAY_MS = 864e5;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, days: number) => iso(parse(date) + days * DAY_MS);
export const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY_MS);
export const monthOf = (date: string) => date.slice(0, 7);
export const dayOf = (date: string) => Number(date.slice(8, 10));
export const yearOf = (date: string) => Number(date.slice(0, 4));

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const firstOf = (month: string) => `${month}-01`;
export const lastOf = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

/** The first day of the week `date` is in, weeks starting on `weekStart` (0 Sunday). */
export function weekOf(date: string, weekStart = 1): string {
  const back = (new Date(parse(date)).getUTCDay() - weekStart + 7) % 7;
  return addDays(date, -back);
}

/** Day of the week, 0 Sunday. */
export const weekday = (date: string) => new Date(parse(date)).getUTCDay();

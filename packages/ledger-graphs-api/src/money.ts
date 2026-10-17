/**
 * Money as integer cents while it's summed (no floating point creeps into totals), and as
 * numbers in the currency's units in datasets, rounded to cents.
 */

/** A decimal string as cents, rounded half away from zero past the second decimal. */
export function cents(decimal: string): number {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = decimal.replace(/^[-+]/, "").split(".");
  const padded = (fraction + "000").slice(0, 3);
  const value = Number(whole) * 100 + Number(padded.slice(0, 2)) + (Number(padded[2]) >= 5 ? 1 : 0);
  return negative ? -value : value;
}

/** Cents as the currency's units. */
export const units = (c: number) => Math.round(c) / 100;

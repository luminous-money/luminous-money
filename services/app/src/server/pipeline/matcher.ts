/**
 * The matcher: for each incoming row, the account's existing transactions that might be the same
 * event. A candidate has the same amount (or one within its tolerance, for a scheduled split
 * marked with one), within `windowDays` of the row's date. They're ranked by closeness in date,
 * an exact amount before a near one; ties are broken arbitrarily (by ID, so stably). The score
 * is 1 for the same day, falling linearly to just above 0 at the window's edge.
 */
import type { Candidate, Context, Incoming, Resolution, Resolver } from "./types.js";

export const DEFAULT_WINDOW_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Equal decimal strings, ignoring how many trailing zeros each has ("-4.5" and "-4.50"). */
export function sameNumber(a: string, b: string): boolean {
  const canonical = (n: string) => {
    let [whole = "0", fraction = ""] = n.replace(/^-/, "").split(".");
    whole = whole.replace(/^0+(?=\d)/, "");
    fraction = fraction.replace(/0+$/, "");
    const negative = n.startsWith("-") && (whole !== "0" || fraction !== "");
    return `${negative ? "-" : ""}${whole}.${fraction}`;
  };
  return canonical(a) === canonical(b);
}

/** A decimal string as an integer at `scale` decimal places. */
function scaled(n: string, scale: number): bigint {
  const negative = n.startsWith("-");
  const [whole = "0", fraction = ""] = n.replace(/^-/, "").split(".");
  const value = BigInt(whole + fraction.padEnd(scale, "0").slice(0, scale));
  return negative ? -value : value;
}

/** Whether `a` and `b` are at most `tolerance` apart (exactly equal without one). */
export function near(a: string, b: string, tolerance = "0"): boolean {
  const scale = Math.max(...[a, b, tolerance].map((n) => n.split(".")[1]?.length ?? 0));
  const difference = scaled(a, scale) - scaled(b, scale);
  return (difference < 0n ? -difference : difference) <= scaled(tolerance, scale);
}

export function matcher(windowDays = DEFAULT_WINDOW_DAYS): Resolver {
  return {
    name: "matcher",
    resolve(batch: Incoming[], context: Context): Resolution[] {
      return batch.map((row) => {
        const candidates: Candidate[] = context.existing
          .filter(
            (t) =>
              t.amount !== null &&
              t.amount.currency === row.amount.currency &&
              near(t.amount.number, row.amount.number, t.tolerance) &&
              Math.abs(daysBetween(row.date, t.date)) <= windowDays
          )
          .map((t) => {
            const days = daysBetween(row.date, t.date);
            return {
              transaction_id: t.id,
              date: t.date,
              flag: t.flag,
              payee: t.payee,
              narration: t.narration,
              amount: t.amount!.number,
              days,
              score: Number((1 - Math.abs(days) / (windowDays + 1)).toFixed(4)),
            };
          })
          .sort(
            (a, b) =>
              b.score - a.score ||
              Number(!sameNumber(a.amount, row.amount.number)) -
                Number(!sameNumber(b.amount, row.amount.number)) ||
              a.transaction_id.localeCompare(b.transaction_id)
          );
        return { line: row.line, resolver: "matcher", candidates, final: false };
      });
    },
  };
}

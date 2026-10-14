/**
 * Fetching prices, as a daily job: each morning (07:00 in the book's time zone, so the previous
 * trading day's close is in), the ledger fetches the latest price of every commodity still held
 * that names a source (beanprice). Once per local day per book, for books with a time zone and
 * a known owner (set when the book's time zone is), at startup too if it's past 07:00 and the
 * day's run hasn't happened. The last run's result is kept for the Commodities page.
 */
import type { AppDb } from "./db.js";
import { localMinutes, type DailyJob } from "./daily.js";
import type { LedgerPort } from "./ledger.js";

export const PRICES_AT = 7 * 60;

/** Fetch a book's prices now, and keep the result. */
export async function fetchPrices(db: AppDb, ledger: LedgerPort, book: string, on: string) {
  const result = await ledger.fetchPrices(book);
  db.recordPriceFetch(book, on, result);
  return result;
}

export function pricesJob(
  db: AppDb,
  ledgerFor: (userId: string) => LedgerPort,
  now: () => Date = () => new Date()
): DailyJob {
  return {
    name: "prices",
    at: PRICES_AT,
    zones: () => db.priceBooks().map((b) => b.time_zone),
    run: async () => {
      const done: string[] = [];
      for (const b of db.priceBooks()) {
        const at = now();
        const today = at.toLocaleDateString("en-CA", { timeZone: b.time_zone });
        if (localMinutes(at, b.time_zone) < PRICES_AT) continue;
        if ((db.lastPriceFetch(b.book_id)?.ran_on ?? "") >= today) continue;
        const result = await fetchPrices(db, ledgerFor(b.user_id), b.book_id, today).catch(
          (error: unknown) => {
            db.recordPriceFetch(b.book_id, today, { fetched: [], errors: { "*": String(error) } });
            return null;
          }
        );
        if (result) done.push(`${b.book_id}: ${result.fetched.length} fetched`);
      }
      return done.length ? done.join("; ") : undefined;
    },
  };
}

/**
 * The morning's shop sync (Amazon orders, step 3): each book that's read its Amazon before, once
 * a local day from 09:00 (after the bank feeds, 06:00 to 08:00, so their rows are in to match),
 * as whoever handed its charges over last. Not while Amazon wants a person (Notifications says
 * so); a sync that day already (by hand, too) is enough.
 */
import { localMinutes, type DailyJob } from "../daily.js";
import type { AppDb } from "../db.js";
import type { ShopsPort } from "../shops.js";
import type { OrdersStore } from "./store.js";

export const SHOPS_SYNC_AT = 9 * 60;

export function shopsJob(
  deps: { db: AppDb; orders: OrdersStore; shopsFor: (user: string) => ShopsPort },
  now: () => Date = () => new Date()
): DailyJob {
  const books = () => deps.orders.shopBooks("amazon");
  return {
    name: "shops",
    at: SHOPS_SYNC_AT,
    zones: () => [...new Set(books().map((b) => deps.db.timeZone(b.book) ?? undefined))],
    run: async () => {
      const done: string[] = [];
      for (const { book, user } of books()) {
        const zone = deps.db.timeZone(book) ?? undefined;
        const at = now();
        if (localMinutes(at, zone) < SHOPS_SYNC_AT) continue;
        const shops = deps.shopsFor(user);
        const connection = await shops.amazon(book);
        if (!connection?.has_password || connection.status === "login") continue;
        const day = (stamp: Date) => stamp.toLocaleDateString("en-CA", { timeZone: zone });
        if (connection.last_sync_at && day(new Date(connection.last_sync_at)) >= day(at)) continue;
        try {
          await shops.sync(book);
          done.push(`${book}: Amazon sync started`);
        } catch (error) {
          done.push(`${book}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return done.length ? done.join("; ") : undefined;
    },
  };
}

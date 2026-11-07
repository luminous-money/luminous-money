/** Shops' charges as the book keeps them (Amazon orders, step 2): see read.ts. */
import { now, transaction, type DatabaseSync } from "@luminous-money/db";

import type { OrderCharge, OrderState, StoredCharge } from "../../shared/orders.js";

type Row = {
  shop: string;
  id: string;
  user_id: string;
  data: string;
  state: OrderState;
  detail: string | null;
  transaction_id: string | null;
  updated_at: string;
};

const stored = (r: Row): StoredCharge & { user_id: string } => ({
  ...(JSON.parse(r.data) as OrderCharge),
  state: r.state,
  detail: r.detail,
  transaction_id: r.transaction_id,
  updated_at: r.updated_at,
  user_id: r.user_id,
});

export class OrdersStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Keep what a reader sent: new charges wait to be read; one still waiting takes what was
   * sent (its lines may be better now its order's been read); one already read or left is left
   * as it is. Returns how many were new. */
  receive(book: string, user: string, charges: OrderCharge[]): number {
    const stamp = now();
    let added = 0;
    transaction(this.db, () => {
      for (const c of charges) {
        const data = JSON.stringify(c);
        const found = this.db
          .prepare("SELECT state, data FROM shop_charge WHERE book_id = ? AND shop = ? AND id = ?")
          .get(book, c.shop, c.id) as { state: OrderState; data: string } | undefined;
        if (!found) {
          this.db
            .prepare(
              `INSERT INTO shop_charge (book_id, shop, id, user_id, date, amount, data, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(book, c.shop, c.id, user, c.date, c.amount, data, stamp, stamp);
          added++;
        } else if (found.state === "waiting" && found.data !== data)
          this.db
            .prepare(
              `UPDATE shop_charge SET user_id = ?, date = ?, amount = ?, data = ?, updated_at = ?
               WHERE book_id = ? AND shop = ? AND id = ?`
            )
            .run(user, c.date, c.amount, data, stamp, book, c.shop, c.id);
      }
    });
    return added;
  }

  /** A book's charges, newest first (one shop's, if named). */
  charges(book: string, shop?: string): (StoredCharge & { user_id: string })[] {
    const rows = (
      shop
        ? this.db
            .prepare(
              "SELECT * FROM shop_charge WHERE book_id = ? AND shop = ? ORDER BY date DESC, id"
            )
            .all(book, shop)
        : this.db
            .prepare("SELECT * FROM shop_charge WHERE book_id = ? ORDER BY date DESC, id")
            .all(book)
    ) as Row[];
    return rows.map(stored);
  }

  charge(book: string, shop: string, id: string): (StoredCharge & { user_id: string }) | null {
    const row = this.db
      .prepare("SELECT * FROM shop_charge WHERE book_id = ? AND shop = ? AND id = ?")
      .get(book, shop, id) as Row | undefined;
    return row ? stored(row) : null;
  }

  /** The charges still waiting, oldest first. */
  waiting(book: string): (StoredCharge & { user_id: string })[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM shop_charge WHERE book_id = ? AND state = 'waiting' ORDER BY date, id"
      )
      .all(book) as Row[];
    return rows.map(stored);
  }

  /** The books that have had a shop's charges, each with whoever sent them last (whom its
   * morning sync acts as). */
  shopBooks(shop: string): { book: string; user: string }[] {
    return this.db
      .prepare(
        `SELECT book_id AS book, user_id AS user FROM shop_charge s WHERE shop = ? AND updated_at =
           (SELECT MAX(updated_at) FROM shop_charge WHERE book_id = s.book_id AND shop = s.shop)
         GROUP BY book_id`
      )
      .all(shop) as { book: string; user: string }[];
  }

  /** The books with charges waiting. */
  booksWaiting(): string[] {
    return (
      this.db.prepare("SELECT DISTINCT book_id FROM shop_charge WHERE state = 'waiting'").all() as {
        book_id: string;
      }[]
    ).map((r) => r.book_id);
  }

  /** Whether a transaction already has a charge read into it. */
  readInto(book: string, transactionId: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM shop_charge WHERE book_id = ? AND transaction_id = ? AND state = 'read'"
      )
      .get(book, transactionId);
  }

  settle(
    book: string,
    shop: string,
    id: string,
    state: OrderState,
    detail: string | null,
    transactionId: string | null
  ): void {
    this.db
      .prepare(
        `UPDATE shop_charge SET state = ?, detail = ?, transaction_id = ?, updated_at = ?
         WHERE book_id = ? AND shop = ? AND id = ?`
      )
      .run(state, detail, transactionId, now(), book, shop, id);
  }
}

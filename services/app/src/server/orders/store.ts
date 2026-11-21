/** Shops' charges as the book keeps them (Amazon orders, step 2): see read.ts. */
import { now, transaction, type DatabaseSync } from "@luminous-money/db";

import type { OrderCharge, OrderLine, OrderState, StoredCharge } from "../../shared/orders.js";

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

/** A charge already read that came again with lines newly marked HSA or FSA eligible, or with
 * orders whose invoice is newly kept (HSA tracking): those lines, and those orders' numbers. */
export type Marked = {
  charge: StoredCharge & { user_id: string };
  lines: OrderLine[];
  invoices: string[];
};

/** The lines of `sent` marked HSA or FSA eligible that weren't in `kept` (by text and amount). */
function newlyMarked(kept: OrderCharge, sent: OrderCharge): OrderLine[] {
  const was = (l: OrderLine) =>
    kept.lines.some((k) => k.text === l.text && k.amount === l.amount && k.hsa_fsa_eligible);
  return sent.lines.filter((l) => l.hsa_fsa_eligible && !was(l));
}

/** The orders of `sent` whose invoice is kept that weren't so in `kept`. */
function newlyInvoiced(kept: OrderCharge, sent: OrderCharge): string[] {
  const had = new Set(kept.orders.filter((o) => o.invoice).map((o) => o.number));
  return sent.orders.filter((o) => o.invoice && !had.has(o.number)).map((o) => o.number);
}

export class OrdersStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Keep what a reader sent: new charges wait to be read; one still waiting takes what was
   * sent (its lines may be better now its order's been read); one already read is left as it is,
   * unless its lines come newly marked HSA or FSA eligible, or its order's invoice newly kept
   * (HSA tracking): it takes what was sent, and is returned with what's new, for its splits to be
   * tagged and the invoice attached (`refresh`). Sent as all of a shop's (`allOf`), any other of
   * its charges kept is forgotten: the shop no longer has it (a charge Amazon dated anew, kept
   * twice before that was caught); its transaction stays the book's. Returns how many were new,
   * those marked, and how many were forgotten. */
  receive(
    book: string,
    user: string,
    charges: OrderCharge[],
    allOf?: string
  ): { added: number; marked: Marked[]; forgotten: number } {
    const stamp = now();
    let added = 0;
    let forgotten = 0;
    const marked: Marked[] = [];
    transaction(this.db, () => {
      if (allOf) {
        const sent = new Set(charges.map((c) => c.id));
        const kept = this.db
          .prepare("SELECT id FROM shop_charge WHERE book_id = ? AND shop = ?")
          .all(book, allOf) as { id: string }[];
        for (const { id } of kept.filter((k) => !sent.has(k.id))) {
          this.db
            .prepare("DELETE FROM shop_charge WHERE book_id = ? AND shop = ? AND id = ?")
            .run(book, allOf, id);
          forgotten++;
        }
      }
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
          this.update(book, user, c, data, stamp);
        else if (found.state === "read" && found.data !== data) {
          const kept = JSON.parse(found.data) as OrderCharge;
          const lines = newlyMarked(kept, c);
          const invoices = newlyInvoiced(kept, c);
          if (!lines.length && !invoices.length) continue;
          this.update(book, user, c, data, stamp);
          marked.push({ charge: this.charge(book, c.shop, c.id)!, lines, invoices });
        }
      }
    });
    return { added, marked, forgotten };
  }

  private update(book: string, user: string, c: OrderCharge, data: string, stamp: string): void {
    this.db
      .prepare(
        `UPDATE shop_charge SET user_id = ?, date = ?, amount = ?, data = ?, updated_at = ?
         WHERE book_id = ? AND shop = ? AND id = ?`
      )
      .run(user, c.date, c.amount, data, stamp, book, c.shop, c.id);
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

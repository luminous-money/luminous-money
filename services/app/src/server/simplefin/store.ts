/**
 * What `app` keeps about bank feeds, in `app.sqlite`:
 *
 * - **Connections:** a user's SimpleFIN access URLs (sealed), with each one's daily sync minute,
 *   today's request count (the Bridge allows 24 a day; we stop at `DAILY_BUDGET`), and the last
 *   sync's errors.
 * - **Accounts:** the last snapshot of each account a connection covers (balances, holdings),
 *   and how far back its history has been fetched.
 * - **The mirror:** every posted transaction the bank has sent, as it sent it. Imports are made
 *   from the mirror, so fetching (rationed) and importing (free) are separate.
 * - **Links:** one bank account to one account in one book, from a start date.
 */
import { randomUUID } from "node:crypto";

import { now, transaction, type DatabaseSync } from "@luminous-money/db";

import type { SfAccount, SfError, SfHolding, SfTransaction } from "./client.js";

export const DAILY_BUDGET = 20;

export type Connection = {
  id: string;
  user_id: string;
  access_url: string; // sealed
  host: string;
  sync_minute: number;
  requests_on: string | null;
  requests: number;
  last_sync_at: string | null;
  errors: SfError[];
  created_at: string;
};

export type AccountSnapshot = {
  connection_id: string;
  account_id: string;
  name: string;
  institution: string;
  currency: string;
  balance: string;
  available_balance: string | null;
  balance_date: number;
  holdings: SfHolding[];
  history_from: string | null;
  history_complete: boolean;
  updated_at: string;
};

export type LinkKind = "cash" | "brokerage";

export type AttemptState = "fetching" | "waiting" | "ready" | "failed";

/** A link the user chose, while its history is fetched; confirmed later from its preview. */
export type Attempt = {
  id: string;
  user_id: string;
  connection_id: string;
  account_id: string;
  book_id: string;
  account: string;
  mode: string;
  from_date: string | null;
  state: AttemptState;
  preview: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type Link = {
  id: string;
  user_id: string;
  connection_id: string;
  account_id: string;
  book_id: string;
  account: string;
  kind: LinkKind;
  /** Bank transactions dated before this aren't imported (they're before the link's start). */
  starts_on: string;
  created_at: string;
};

const id = () => randomUUID().replace(/-/g, "");
const today = () => new Date().toISOString().slice(0, 10);

type ConnectionRow = Omit<Connection, "errors"> & { errors: string };
type AccountRow = Omit<AccountSnapshot, "holdings" | "history_complete"> & {
  holdings: string;
  history_complete: number;
};

export class SimplefinStore {
  constructor(private readonly db: DatabaseSync) {}

  // Connections

  addConnection(user: string, sealedUrl: string, host: string, syncMinute: number): Connection {
    const key = id();
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO simplefin_connection (id, user_id, access_url, host, sync_minute, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(key, user, sealedUrl, host, syncMinute, stamp, stamp);
    return this.connection(user, key)!;
  }

  private toConnection(r: ConnectionRow): Connection {
    return { ...r, errors: JSON.parse(r.errors) as SfError[] };
  }

  connection(user: string, connection: string): Connection | undefined {
    const r = this.db
      .prepare("SELECT * FROM simplefin_connection WHERE id = ? AND user_id = ?")
      .get(connection, user) as ConnectionRow | undefined;
    return r && this.toConnection(r);
  }

  connections(user: string): Connection[] {
    return (
      this.db
        .prepare("SELECT * FROM simplefin_connection WHERE user_id = ? ORDER BY created_at")
        .all(user) as ConnectionRow[]
    ).map((r) => this.toConnection(r));
  }

  /** Every connection that has a link: what the daily sync covers. */
  linkedConnections(): Connection[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM simplefin_connection
           WHERE id IN (SELECT connection_id FROM simplefin_link) ORDER BY created_at`
        )
        .all() as ConnectionRow[]
    ).map((r) => this.toConnection(r));
  }

  deleteConnection(user: string, connection: string): boolean {
    return (
      this.db
        .prepare("DELETE FROM simplefin_connection WHERE id = ? AND user_id = ?")
        .run(connection, user).changes > 0
    );
  }

  /** Forget everything of the user's (their account is being deleted). */
  forgetUser(user: string): void {
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM simplefin_attempt WHERE user_id = ?").run(user);
      this.db.prepare("DELETE FROM simplefin_link WHERE user_id = ?").run(user);
      this.db.prepare("DELETE FROM simplefin_connection WHERE user_id = ?").run(user);
    });
  }

  /** Requests left today (UTC) for the connection. */
  budgetLeft(connection: Connection): number {
    return DAILY_BUDGET - (connection.requests_on === today() ? connection.requests : 0);
  }

  /** Count a request against the connection's daily budget. False if there's none left. */
  spend(connectionId: string): boolean {
    return transaction(this.db, () => {
      const r = this.db
        .prepare("SELECT requests_on, requests FROM simplefin_connection WHERE id = ?")
        .get(connectionId) as { requests_on: string | null; requests: number } | undefined;
      if (!r) return false;
      const used = r.requests_on === today() ? r.requests : 0;
      if (used >= DAILY_BUDGET) return false;
      this.db
        .prepare(
          "UPDATE simplefin_connection SET requests_on = ?, requests = ?, updated_at = ? WHERE id = ?"
        )
        .run(today(), used + 1, now(), connectionId);
      return true;
    });
  }

  recordSync(connectionId: string, errors: SfError[]): void {
    const stamp = now();
    this.db
      .prepare(
        "UPDATE simplefin_connection SET last_sync_at = ?, errors = ?, updated_at = ? WHERE id = ?"
      )
      .run(stamp, JSON.stringify(errors), stamp, connectionId);
  }

  // Accounts and the mirror

  /** Save what a fetch returned: each account's snapshot, and its transactions in the mirror
   * (posted ones only: pending transactions aren't kept). */
  saveFetch(connectionId: string, accounts: SfAccount[]): void {
    const stamp = now();
    transaction(this.db, () => {
      const upsertAccount = this.db.prepare(
        `INSERT INTO simplefin_account (connection_id, account_id, name, institution, currency, balance,
           available_balance, balance_date, holdings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (connection_id, account_id) DO UPDATE SET name = excluded.name,
           institution = excluded.institution, currency = excluded.currency, balance = excluded.balance,
           available_balance = excluded.available_balance, balance_date = excluded.balance_date,
           holdings = excluded.holdings, updated_at = excluded.updated_at`
      );
      const upsertTransaction = this.db.prepare(
        `INSERT INTO simplefin_transaction (connection_id, account_id, id, posted, transacted_at, amount,
           description, payee, memo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (connection_id, account_id, id) DO UPDATE SET posted = excluded.posted,
           transacted_at = excluded.transacted_at, amount = excluded.amount,
           description = excluded.description, payee = excluded.payee, memo = excluded.memo,
           updated_at = excluded.updated_at`
      );
      for (const a of accounts) {
        upsertAccount.run(
          connectionId,
          a.id,
          a.name,
          a.institution,
          a.currency,
          a.balance,
          a.available_balance,
          a.balance_date,
          JSON.stringify(a.holdings),
          stamp,
          stamp
        );
        for (const t of a.transactions) {
          if (t.pending) continue;
          upsertTransaction.run(
            connectionId,
            a.id,
            t.id,
            t.posted,
            t.transacted_at,
            t.amount,
            t.description,
            t.payee,
            t.memo,
            stamp,
            stamp
          );
        }
      }
    });
  }

  private toAccount(r: AccountRow): AccountSnapshot {
    return {
      ...r,
      holdings: JSON.parse(r.holdings) as SfHolding[],
      history_complete: !!r.history_complete,
    };
  }

  accounts(connectionId: string): AccountSnapshot[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM simplefin_account WHERE connection_id = ? ORDER BY institution, name"
        )
        .all(connectionId) as AccountRow[]
    ).map((r) => this.toAccount(r));
  }

  account(connectionId: string, accountId: string): AccountSnapshot | undefined {
    const r = this.db
      .prepare("SELECT * FROM simplefin_account WHERE connection_id = ? AND account_id = ?")
      .get(connectionId, accountId) as AccountRow | undefined;
    return r && this.toAccount(r);
  }

  /** Record how far back an account's history has been fetched. */
  setHistory(connectionId: string, accountId: string, from: string, complete: boolean): void {
    this.db
      .prepare(
        `UPDATE simplefin_account SET history_from = ?, history_complete = ?, updated_at = ?
         WHERE connection_id = ? AND account_id = ?`
      )
      .run(from, complete ? 1 : 0, now(), connectionId, accountId);
  }

  /** The mirror's transactions for an account, oldest first. */
  transactions(connectionId: string, accountId: string): SfTransaction[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM simplefin_transaction WHERE connection_id = ? AND account_id = ?
           ORDER BY COALESCE(transacted_at, posted), posted, id`
        )
        .all(connectionId, accountId) as Omit<SfTransaction, "pending">[]
    ).map((t) => ({
      id: t.id,
      posted: t.posted,
      transacted_at: t.transacted_at,
      amount: t.amount,
      description: t.description,
      payee: t.payee,
      memo: t.memo,
      pending: false,
    }));
  }

  /** The newest posted time in the mirror for any of the connection's linked accounts. */
  newestPosted(connectionId: string): number | undefined {
    const r = this.db
      .prepare(
        `SELECT MAX(t.posted) AS posted FROM simplefin_transaction t JOIN simplefin_link l
           ON l.connection_id = t.connection_id AND l.account_id = t.account_id
         WHERE t.connection_id = ?`
      )
      .get(connectionId) as { posted: number | null };
    return r.posted ?? undefined;
  }

  // Link attempts

  /** Record a link attempt, replacing any earlier one for the same bank account. */
  addAttempt(
    a: Pick<
      Attempt,
      "user_id" | "connection_id" | "account_id" | "book_id" | "account" | "mode" | "from_date"
    >
  ): Attempt {
    const key = id();
    const stamp = now();
    transaction(this.db, () => {
      this.db
        .prepare("DELETE FROM simplefin_attempt WHERE connection_id = ? AND account_id = ?")
        .run(a.connection_id, a.account_id);
      this.db
        .prepare(
          `INSERT INTO simplefin_attempt (id, user_id, connection_id, account_id, book_id, account, mode, from_date, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fetching', ?, ?)`
        )
        .run(
          key,
          a.user_id,
          a.connection_id,
          a.account_id,
          a.book_id,
          a.account,
          a.mode,
          a.from_date,
          stamp,
          stamp
        );
    });
    return this.attempt(a.user_id, key)!;
  }

  private toAttempt(r: Omit<Attempt, "preview"> & { preview: string | null }): Attempt {
    return { ...r, preview: r.preview ? (JSON.parse(r.preview) as unknown) : null };
  }

  attempt(user: string, attempt: string): Attempt | undefined {
    const r = this.db
      .prepare("SELECT * FROM simplefin_attempt WHERE id = ? AND user_id = ?")
      .get(attempt, user) as (Omit<Attempt, "preview"> & { preview: string | null }) | undefined;
    return r && this.toAttempt(r);
  }

  attemptsIn(book: string): Attempt[] {
    return (
      this.db
        .prepare("SELECT * FROM simplefin_attempt WHERE book_id = ? ORDER BY created_at")
        .all(book) as (Omit<Attempt, "preview"> & { preview: string | null })[]
    ).map((r) => this.toAttempt(r));
  }

  /** Attempts still fetching (or waiting for tomorrow's requests). */
  unfinishedAttempts(): Attempt[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM simplefin_attempt WHERE state IN ('fetching', 'waiting') ORDER BY created_at"
        )
        .all() as (Omit<Attempt, "preview"> & { preview: string | null })[]
    ).map((r) => this.toAttempt(r));
  }

  setAttempt(
    id: string,
    state: AttemptState,
    details: { preview?: unknown; error?: string } = {}
  ): void {
    this.db
      .prepare(
        "UPDATE simplefin_attempt SET state = ?, preview = ?, error = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        state,
        details.preview === undefined ? null : JSON.stringify(details.preview),
        details.error ?? null,
        now(),
        id
      );
  }

  deleteAttempt(id: string): void {
    this.db.prepare("DELETE FROM simplefin_attempt WHERE id = ?").run(id);
  }

  // Links

  addLink(link: Omit<Link, "id" | "created_at">): Link {
    const key = id();
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO simplefin_link (id, user_id, connection_id, account_id, book_id, account, kind, starts_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        key,
        link.user_id,
        link.connection_id,
        link.account_id,
        link.book_id,
        link.account,
        link.kind,
        link.starts_on,
        stamp,
        stamp
      );
    return this.link(link.user_id, key)!;
  }

  link(user: string, link: string): Link | undefined {
    return this.db
      .prepare("SELECT * FROM simplefin_link WHERE id = ? AND user_id = ?")
      .get(link, user) as Link | undefined;
  }

  links(connectionId: string): Link[] {
    return this.db
      .prepare("SELECT * FROM simplefin_link WHERE connection_id = ? ORDER BY created_at")
      .all(connectionId) as Link[];
  }

  /** The link into a book's account, if it has one. */
  linkTo(book: string, account: string): Link | undefined {
    return this.db
      .prepare("SELECT * FROM simplefin_link WHERE book_id = ? AND account = ?")
      .get(book, account) as Link | undefined;
  }

  /** The book's linked accounts: account name → its link. */
  linksIn(book: string): Link[] {
    return this.db.prepare("SELECT * FROM simplefin_link WHERE book_id = ?").all(book) as Link[];
  }

  deleteLink(user: string, link: string): boolean {
    return (
      this.db.prepare("DELETE FROM simplefin_link WHERE id = ? AND user_id = ?").run(link, user)
        .changes > 0
    );
  }
}

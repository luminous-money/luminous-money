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
 * - **Shares:** a connection in a book (shared connections): all its accounts, new ones too, or
 *   those chosen. A book sees only what's shared with it.
 * - **Links:** one bank account to one account in one book, from a start date.
 */
import { randomUUID } from "node:crypto";

import { after, now, transaction, type DatabaseSync } from "@luminous-money/db";

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
  errors: SeenError[];
  created_at: string;
};

/** A sync's error as kept: since the first sync in a row that reported it (none for one kept
 * before this was), so the bell's notice of it lasts while it does. */
export type SeenError = SfError & { since?: string };

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
  /** When it was first seen. */
  created_at: string;
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
  /** A brokerage's dividend account, if chosen (else the default for its kind). */
  dividends: string | null;
  created_at: string;
  updated_at: string;
};

/** A connection shared with a book: all its accounts (`all`, new ones too), or `accounts`. */
export type Share = {
  connection_id: string;
  book_id: string;
  all: boolean;
  /** The bank's account IDs, when not all. */
  accounts: string[];
  created_at: string;
  updated_at: string;
};

/** Whether a share covers a bank account. */
export const covers = (share: Share | undefined, accountId: string) =>
  !!share && (share.all || share.accounts.includes(accountId));

/**
 * The connection's errors someone sees in a book: one naming an account, where that account is
 * shared; one about the connection as a whole (the Bridge's plain strings, which name banks in
 * words), where it's shared with all its accounts, and to its owner wherever it's shared.
 */
export function errorsIn(connection: Connection, share: Share | undefined, viewer: string) {
  return connection.errors.filter((e) =>
    e.account_id
      ? covers(share, e.account_id)
      : !!share && (share.all || connection.user_id === viewer)
  );
}

/** A share edit based on a version that has moved on. */
export class StaleShare extends Error {
  constructor() {
    super("what's shared with this book changed since you read it");
  }
}

/** A difference in a position's shares the bank shows and its activity doesn't explain yet. */
export type PositionWait = { commodity: string; units: string; since: string };

const id = () => randomUUID().replace(/-/g, "");
const today = () => new Date().toISOString().slice(0, 10);

type ConnectionRow = Omit<Connection, "errors"> & { errors: string };
type ShareRow = Omit<Share, "all" | "accounts"> & { all_accounts: number; accounts: string };
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
    return { ...r, errors: JSON.parse(r.errors) as SeenError[] };
  }

  connection(user: string, connection: string): Connection | undefined {
    const r = this.db
      .prepare("SELECT * FROM simplefin_connection WHERE id = ? AND user_id = ?")
      .get(connection, user) as ConnectionRow | undefined;
    return r && this.toConnection(r);
  }

  /** A connection by its ID, whoever's it is (a book it's shared with acting on it). */
  connectionById(connection: string): Connection | undefined {
    const r = this.db.prepare("SELECT * FROM simplefin_connection WHERE id = ?").get(connection) as
      ConnectionRow | undefined;
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

  /** Forget everything of the user's (their account is being deleted): their connections
   * (with every share, link and attempt on them), and the links and attempts they made. */
  forgetUser(user: string): void {
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM simplefin_attempt WHERE user_id = ?").run(user);
      this.db.prepare("DELETE FROM simplefin_link WHERE user_id = ?").run(user);
      this.db.prepare("DELETE FROM simplefin_connection WHERE user_id = ?").run(user);
    });
  }

  /**
   * A member has left a book: what they shared with it goes, with every link and attempt in it
   * on their connections (whoever made them); links they made on someone else's connection act
   * as that connection's owner from then on, and their attempts go.
   */
  leaveBook(user: string, book: string): void {
    const theirs = `SELECT id FROM simplefin_connection WHERE user_id = ?`;
    transaction(this.db, () => {
      this.db
        .prepare(`DELETE FROM simplefin_link WHERE book_id = ? AND connection_id IN (${theirs})`)
        .run(book, user);
      this.db
        .prepare(`DELETE FROM simplefin_attempt WHERE book_id = ? AND connection_id IN (${theirs})`)
        .run(book, user);
      this.db
        .prepare(`DELETE FROM simplefin_share WHERE book_id = ? AND connection_id IN (${theirs})`)
        .run(book, user);
      this.db
        .prepare("DELETE FROM simplefin_attempt WHERE book_id = ? AND user_id = ?")
        .run(book, user);
      this.db
        .prepare(
          `UPDATE simplefin_link SET user_id = (SELECT c.user_id FROM simplefin_connection c
             WHERE c.id = simplefin_link.connection_id), updated_at = ?
           WHERE book_id = ? AND user_id = ?`
        )
        .run(now(), book, user);
    });
  }

  // Shares

  private toShare(r: ShareRow): Share {
    return {
      connection_id: r.connection_id,
      book_id: r.book_id,
      all: r.all_accounts === 1,
      accounts: JSON.parse(r.accounts) as string[],
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  share(connectionId: string, book: string): Share | undefined {
    const r = this.db
      .prepare("SELECT * FROM simplefin_share WHERE connection_id = ? AND book_id = ?")
      .get(connectionId, book) as ShareRow | undefined;
    return r && this.toShare(r);
  }

  /** The books a connection is shared with. */
  sharesOf(connectionId: string): Share[] {
    return (
      this.db
        .prepare("SELECT * FROM simplefin_share WHERE connection_id = ? ORDER BY created_at")
        .all(connectionId) as ShareRow[]
    ).map((r) => this.toShare(r));
  }

  /** The connections shared with a book. */
  sharesIn(book: string): Share[] {
    return (
      this.db
        .prepare("SELECT * FROM simplefin_share WHERE book_id = ? ORDER BY created_at")
        .all(book) as ShareRow[]
    ).map((r) => this.toShare(r));
  }

  /** Share a connection with a book, or change what's shared, against the version read (null:
   * not shared yet). */
  putShare(
    connectionId: string,
    book: string,
    what: { all: boolean; accounts: string[] },
    expected: string | null
  ): Share {
    return transaction(this.db, () => {
      const current = this.share(connectionId, book);
      if ((current?.updated_at ?? null) !== expected) throw new StaleShare();
      const stamp = after(current?.updated_at);
      const accounts = JSON.stringify(what.all ? [] : [...new Set(what.accounts)].sort());
      this.db
        .prepare(
          `INSERT INTO simplefin_share (connection_id, book_id, all_accounts, accounts, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (connection_id, book_id) DO UPDATE SET all_accounts = excluded.all_accounts,
             accounts = excluded.accounts, updated_at = excluded.updated_at`
        )
        .run(connectionId, book, what.all ? 1 : 0, accounts, stamp, stamp);
      return this.share(connectionId, book)!;
    });
  }

  /** Stop sharing a connection with a book, against the version read. */
  deleteShare(connectionId: string, book: string, expected: string): void {
    transaction(this.db, () => {
      const current = this.share(connectionId, book);
      if (!current || current.updated_at !== expected) throw new StaleShare();
      this.db
        .prepare("DELETE FROM simplefin_share WHERE connection_id = ? AND book_id = ?")
        .run(connectionId, book);
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

  /** Keep a sync's errors, each one the last sync had too keeping its `since`. */
  recordSync(connectionId: string, errors: SfError[]): void {
    const stamp = now();
    const row = this.db
      .prepare("SELECT errors FROM simplefin_connection WHERE id = ?")
      .get(connectionId) as { errors: string } | undefined;
    const before = row ? (JSON.parse(row.errors) as SeenError[]) : [];
    const same = (a: SfError, b: SfError) =>
      a.code === b.code && a.message === b.message && a.account_id === b.account_id;
    const seen: SeenError[] = errors.map((e) => ({
      ...e,
      since: before.find((b) => same(b, e))?.since ?? stamp,
    }));
    this.db
      .prepare(
        "UPDATE simplefin_connection SET last_sync_at = ?, errors = ?, updated_at = ? WHERE id = ?"
      )
      .run(stamp, JSON.stringify(seen), stamp, connectionId);
  }

  // Accounts and the mirror

  /** Save what a fetch returned: each account's snapshot, and its transactions in the mirror
   * (posted ones only: pending transactions aren't kept). A balances-only fetch brings no
   * holdings, so it keeps the ones already saved. */
  saveFetch(connectionId: string, accounts: SfAccount[], { balancesOnly = false } = {}): void {
    const stamp = now();
    transaction(this.db, () => {
      const upsertAccount = this.db.prepare(
        `INSERT INTO simplefin_account (connection_id, account_id, name, institution, currency, balance,
           available_balance, balance_date, holdings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (connection_id, account_id) DO UPDATE SET name = excluded.name,
           institution = excluded.institution, currency = excluded.currency, balance = excluded.balance,
           available_balance = excluded.available_balance, balance_date = excluded.balance_date,
           holdings = CASE WHEN ? THEN simplefin_account.holdings ELSE excluded.holdings END,
           updated_at = excluded.updated_at`
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
          stamp,
          balancesOnly ? 1 : 0
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

  /** An attempt by its ID, whoever's it is (a book's writer acting on it). */
  attemptById(attempt: string): Attempt | undefined {
    const r = this.db.prepare("SELECT * FROM simplefin_attempt WHERE id = ?").get(attempt) as
      (Omit<Attempt, "preview"> & { preview: string | null }) | undefined;
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

  addLink(link: Omit<Link, "id" | "created_at" | "updated_at" | "dividends">): Link {
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

  /** Choose a brokerage link's dividend account (null: the default), against the version read. */
  setDividends(link: Link, dividends: string | null, expected: string): Link | undefined {
    const changed = this.db
      .prepare(
        "UPDATE simplefin_link SET dividends = ?, updated_at = ? WHERE id = ? AND updated_at = ?"
      )
      .run(dividends, now(), link.id, expected).changes;
    return changed ? this.link(link.user_id, link.id) : undefined;
  }

  /** A link by its ID, whoever's it is (a book's member acting on it). */
  linkById(link: string): Link | undefined {
    return this.db.prepare("SELECT * FROM simplefin_link WHERE id = ?").get(link) as
      Link | undefined;
  }

  /** The position differences a link is waiting on, by commodity. */
  waits(link: string): Map<string, PositionWait> {
    const rows = this.db
      .prepare("SELECT commodity, units, since FROM simplefin_position_wait WHERE link_id = ?")
      .all(link) as PositionWait[];
    return new Map(rows.map((r) => [r.commodity, r]));
  }

  setWait(link: string, wait: PositionWait | null, commodity: string): void {
    if (!wait) {
      this.db
        .prepare("DELETE FROM simplefin_position_wait WHERE link_id = ? AND commodity = ?")
        .run(link, commodity);
      return;
    }
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO simplefin_position_wait (link_id, commodity, units, since, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (link_id, commodity) DO UPDATE SET units = excluded.units,
           since = excluded.since, updated_at = excluded.updated_at`
      )
      .run(link, commodity, wait.units, wait.since, stamp, stamp);
  }

  deleteLink(link: string): boolean {
    return this.db.prepare("DELETE FROM simplefin_link WHERE id = ?").run(link).changes > 0;
  }
}

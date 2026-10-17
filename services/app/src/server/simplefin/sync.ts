/**
 * Syncing bank feeds: fetching (rationed by the Bridge's daily budget) fills the mirror, and
 * importing (free) turns the mirror's new transactions into import batches through the same
 * pipeline as CSV files.
 *
 * - **Daily:** each connection at its own minute between 06:00 and 08:00 in the time zone of
 *   its first linked book (the Bridge asks apps to spread out), plus "Sync now".
 * - **Windows:** from the newest transaction synced so far, less 5 days (the Bridge's advice), to
 *   now, at most 90 days a request. What the overlap sends again is a duplicate by fingerprint.
 * - **History:** `backfill` walks windows back until `QUIET_DAYS` of them in a row are empty.
 */
import type { Row } from "@fava-beans/csv-import";

import type { ImportResult } from "../../shared/imports.js";
import type { Categorizer } from "../categorize/types.js";
import type { DailyJob } from "../daily.js";
import { localMinutes } from "../daily.js";
import type { AppDb } from "../db.js";
import { importRows } from "../imports.js";
import { autoReconcile } from "../reconcile.js";
import { pairAfterImport, pairTransfers } from "../transfers.js";
import type { LedgerPort } from "../ledger.js";
import { fetchAccounts, type SfAccountSet, type SfTransaction } from "./client.js";
import type { Sealer } from "./crypto.js";
import { resumeAttempts } from "./attempts.js";
import { holdingChanges } from "./holdings.js";
import type { Connection, Link, SimplefinStore } from "./store.js";
import type { UrlPolicy } from "./urls.js";

export const DAY = 24 * 60 * 60;
/** Days per request: the Bridge now recommends 45 ("may be capped", 2026-10-16), though its
 * developer guide still says 90. */
export const WINDOW_DAYS = 45;
export const OVERLAP_DAYS = 5;
/** History ends after this long with nothing in it (a quiet savings account can go months). */
export const QUIET_DAYS = 180;

export type SimplefinDeps = {
  db: AppDb;
  store: SimplefinStore;
  sealer: Sealer;
  policy: UrlPolicy;
  ledgerFor: (userId: string) => LedgerPort;
  categorizers: Categorizer[];
  fetcher?: typeof fetch;
  /** Now, in Unix seconds (tests set it). */
  clock?: () => number;
};

export class OutOfRequests extends Error {
  constructor() {
    super("this connection has used today's SimpleFIN requests; it'll carry on tomorrow");
  }
}

const nowSec = (deps: SimplefinDeps) => deps.clock?.() ?? Math.floor(Date.now() / 1000);

/** One request to `/accounts`, counted against the connection's budget; saves what came back. */
export async function request(
  deps: SimplefinDeps,
  connection: Connection,
  query: { start?: number; end?: number; account?: string; balancesOnly?: boolean }
): Promise<SfAccountSet> {
  if (!deps.store.spend(connection.id)) throw new OutOfRequests();
  const set = await fetchAccounts(
    deps.sealer.open(connection.access_url),
    query,
    deps.policy,
    deps.fetcher
  );
  deps.store.saveFetch(connection.id, set.accounts);
  deps.store.recordSync(connection.id, set.errors);
  return set;
}

/** A Unix time as a date in `timeZone`. */
export function localDate(seconds: number, timeZone: string | undefined): string {
  return new Date(seconds * 1000).toLocaleDateString("en-CA", { timeZone });
}

/**
 * Fetch an account's history as far back as the bank gives: windows back from where the last
 * backfill stopped (or now), until `QUIET_DAYS` in a row are empty. Stops when the budget runs
 * out; call again (tomorrow) to go on. Returns whether it's complete.
 */
export async function backfill(
  deps: SimplefinDeps,
  connection: Connection,
  accountId: string
): Promise<boolean> {
  const snapshot = deps.store.account(connection.id, accountId);
  if (snapshot?.history_complete) return true;
  let end = snapshot?.history_from
    ? Date.parse(`${snapshot.history_from}T00:00:00Z`) / 1000
    : nowSec(deps);
  let empty = 0;
  for (;;) {
    const start = end - WINDOW_DAYS * DAY;
    let set: SfAccountSet;
    try {
      set = await request(deps, connection, { start, end, account: accountId });
    } catch (error) {
      if (error instanceof OutOfRequests) return false;
      throw error;
    }
    const found = set.accounts.find((a) => a.id === accountId);
    const posted = (found?.transactions ?? []).filter((t) => !t.pending).length;
    empty = posted ? 0 : empty + 1;
    const complete = empty * WINDOW_DAYS >= QUIET_DAYS || !found;
    deps.store.setHistory(connection.id, accountId, localDate(start, "UTC"), complete);
    if (complete) return true;
    end = start;
  }
}

/** The mirror's transactions as import rows, dated when they happened (else when they posted)
 * in the book's time zone, with the bank's raw text as the description. */
export function rowsOf(transactions: SfTransaction[], timeZone: string | undefined): Row[] {
  return transactions.map((t, i) => ({
    line: i + 1,
    date: localDate(t.transacted_at || t.posted, timeZone),
    amount: t.amount,
    description: (t.memo || t.description).trim(),
    payee: t.payee?.trim() || null,
    id: `sfin:${t.id}`,
    balance: null,
    error: null,
  }));
}

/** Where a link's transactions go: the account itself, or a brokerage's cash. */
export const cashAccountOf = (link: Pick<Link, "account" | "kind">) =>
  link.kind === "brokerage" ? `${link.account}:Cash` : link.account;

/** Import the mirror's transactions for a link that haven't come in yet. */
export async function importLink(deps: SimplefinDeps, link: Link): Promise<ImportResult | null> {
  const { db, store } = deps;
  const zone = db.timeZone(link.book_id);
  const snapshot = store.account(link.connection_id, link.account_id);
  const cash = cashAccountOf(link);
  const rows = rowsOf(store.transactions(link.connection_id, link.account_id), zone).filter(
    (r) => r.date! >= link.starts_on
  );
  const seen = db.importedBefore(
    link.book_id,
    cash,
    rows.map((r) => `id:${r.id}`)
  );
  const fresh = rows.filter((r) => !seen.has(`id:${r.id}`)).map((r, i) => ({ ...r, line: i + 1 }));
  const result = fresh.length
    ? await importRows({
        db,
        ledger: deps.ledgerFor(link.user_id),
        book: link.book_id,
        account: cash,
        userId: link.user_id,
        source: "simplefin",
        label: snapshot?.institution || "SimpleFIN",
        rows: fresh,
        categorizers: deps.categorizers,
      })
    : null;
  if (link.kind === "brokerage") await holdingChanges(deps, link);
  // Even with nothing new, what's in review may pair now (the other side came in earlier).
  const pairing = { db, ledger: deps.ledgerFor(link.user_id), book: link.book_id };
  return result ? pairAfterImport(pairing, result) : (await pairTransfers(pairing), null);
}

/** Sync a connection: fetch what's new for all its accounts, then import each link's. */
export async function syncConnection(
  deps: SimplefinDeps,
  connection: Connection
): Promise<ImportResult[]> {
  const now = nowSec(deps);
  const newest = deps.store.newestPosted(connection.id);
  let start = (newest ?? now - WINDOW_DAYS * DAY) - OVERLAP_DAYS * DAY;
  while (start < now) {
    const end = Math.min(start + WINDOW_DAYS * DAY, now);
    await request(deps, connection, { start, end });
    start = end;
  }
  const results: ImportResult[] = [];
  for (const link of deps.store.links(connection.id)) {
    const result = await importLink(deps, link);
    if (result) results.push(result);
  }
  // Then reconcile what agrees with the bank (M14), once everything's in.
  for (const link of deps.store.links(connection.id))
    await autoReconcile(deps.db, deps.store, deps.ledgerFor(link.user_id), link);
  return results;
}

/** The time zone a connection syncs by: its first linked book's. */
function zoneOf(deps: SimplefinDeps, connection: Connection): string | undefined {
  const link = deps.store.links(connection.id)[0];
  return link ? deps.db.timeZone(link.book_id) : undefined;
}

/** The daily sync, as a daily job: each linked connection at its own minute, once a local day. */
export function simplefinJob(deps: SimplefinDeps, now: () => Date = () => new Date()): DailyJob {
  const lastLocalDay = (c: Connection, zone: string | undefined) =>
    c.last_sync_at ? new Date(c.last_sync_at).toLocaleDateString("en-CA", { timeZone: zone }) : "";
  return {
    name: "bank feeds",
    at: 6 * 60,
    zones: () => [],
    times: () =>
      deps.store.linkedConnections().map((c) => ({ at: c.sync_minute, zone: zoneOf(deps, c) })),
    run: async () => {
      const done: string[] = [];
      // Link attempts that ran out of requests yesterday carry on (in the background).
      const resumed = resumeAttempts(deps);
      if (resumed) done.push(`${resumed} link attempt${resumed === 1 ? "" : "s"} resumed`);
      for (const connection of deps.store.linkedConnections()) {
        const zone = zoneOf(deps, connection);
        const at = now();
        const today = at.toLocaleDateString("en-CA", { timeZone: zone });
        if (localMinutes(at, zone) < connection.sync_minute) continue;
        if (lastLocalDay(connection, zone) >= today) continue;
        try {
          const results = await syncConnection(deps, connection);
          const staged = results.reduce((n, r) => n + r.batch.staged + r.batch.matched, 0);
          done.push(`${connection.host}: ${staged} new`);
        } catch (error) {
          done.push(
            `${connection.host}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      return done.length ? done.join("; ") : undefined;
    },
  };
}

/** A random minute between 06:00 and 08:00, for a new connection's daily sync. */
export const randomSyncMinute = () => 6 * 60 + Math.floor(Math.random() * 120);

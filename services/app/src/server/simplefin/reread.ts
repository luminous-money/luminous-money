/**
 * Reading a brokerage link again, from what's already fetched (the mirror and the last
 * snapshot: no SimpleFIN requests). The cleanup for a brokerage brought in before its rows were
 * read (the brokerage activity plan), and for one whose reading has improved since.
 *
 * - **Kept:** what touches an account outside the brokerage (a transfer from checking, matched
 *   or paired), and what the bank brought that reads as anything else (a deposit, a fee), with
 *   whatever you made of it.
 * - **Deleted:** everything else in the brokerage and under it: the opening balances, the
 *   positions' openings, sweeps, dividends, trades, transfers of assets, position changes, and
 *   transactions of yours no bank row brought.
 * - **Read again:** the cash opens as the bank's cash less what the rows did to it, the
 *   positions open as `readHistory` fits them, and the rows come in read (brokerage.ts).
 *
 * `planReread` works it out: its `preview` is what the user confirms, `apply` does it.
 */
import type { Row } from "@luminous-money/csv-import";
import type { TransactionIn } from "@luminous-money/ledger-client";

import { within } from "../../shared/divided.js";
import { STAGING } from "../ledger.js";
import { readerFor, type ActivityKind } from "./activity.js";
import {
  dividendsOf,
  fitLink,
  importBrokerage,
  openingCash,
  openPositions,
  OPENING_BALANCES,
  readRows,
  settle,
  type ReadRow,
} from "./brokerage.js";
import { cashOf, positions } from "./holdings.js";
import type { Link } from "./store.js";
import { cashAccountOf, rowsOf, type SimplefinDeps } from "./sync.js";

export class RereadProblem extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string
  ) {
    super(message);
  }
}

export type RereadPreview = {
  account: string;
  institution: string;
  /** The bank's rows from the link's start. */
  rows: number;
  /** How they read (the ones kept aren't read again). */
  read: Record<ActivityKind, number>;
  /** Transactions kept as they are. */
  kept: number;
  /** Transactions deleted, and of them, ones no bank row brought (made by hand). */
  deleted: number;
  deleted_yours: number;
  /** The cash's opening (its date and amount). */
  opening: { date: string; cash: string };
  /** Positions the bank holds today (each opens at what the history leaves of it). */
  positions: number;
  dividends: string;
  currency: string;
};

const dayBefore = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

/** The cash opening's transaction. */
export const cashOpening = (
  cash: string,
  date: string,
  amount: string,
  currency: string
): TransactionIn => ({
  date,
  flag: "*",
  payee: null,
  narration: "Opening balance",
  tags: [],
  links: [],
  meta: { source: "simplefin" },
  postings: [
    { account: cash, units: { number: amount, currency } },
    { account: OPENING_BALANCES, units: null },
  ],
});

/**
 * Bring a brokerage's history in, read: its positions opened as fitted to today's shares
 * (before `opensOn`'s end), then `rows` (the history less what's kept). `read` is the whole
 * history as read, which the fitting uses. The cash opening is the caller's.
 */
export async function readHistory(
  deps: SimplefinDeps,
  link: Link,
  rows: Row[],
  read: ReadRow[],
  opensOn: string
): Promise<void> {
  const snapshot = deps.store.account(link.connection_id, link.account_id)!;
  const reader = readerFor(snapshot.institution)!;
  const ledger = deps.ledgerFor(link.user_id);
  const keep = new Set(rows.map((r) => `id:${r.id}`));
  const brought = read.filter((r) => keep.has(r.fingerprint));
  const fitted = await fitLink(deps, link, brought);
  const openings = await openPositions(deps, link, brought, fitted, opensOn);
  if (openings.length) await ledger.createTransactions(link.book_id, openings, STAGING);
  await importBrokerage(deps, link, reader, rows, fitted);
  await settle(deps, link);
}

/** What reading a brokerage link again would do (`preview`), and doing it (`apply`). */
export async function planReread(
  deps: SimplefinDeps,
  link: Link
): Promise<{ preview: RereadPreview; apply: () => Promise<RereadPreview> }> {
  const { db, store } = deps;
  if (link.kind !== "brokerage") throw new RereadProblem(422, "only a brokerage is read again");
  const snapshot = store.account(link.connection_id, link.account_id);
  if (!snapshot) throw new RereadProblem(404, "the bank hasn't sent this account yet");
  const reader = readerFor(snapshot.institution);
  if (!reader)
    throw new RereadProblem(
      422,
      `there's no reader for ${snapshot.institution || "this institution"}'s activity yet`
    );
  const ledger = deps.ledgerFor(link.user_id);
  const book = link.book_id;
  const cash = cashAccountOf(link);
  const zone = db.timeZone(book);
  const rows = rowsOf(store.transactions(link.connection_id, link.account_id), zone)
    .filter((r) => r.date! >= link.starts_on)
    .sort((a, b) => a.date!.localeCompare(b.date!))
    .map((r, i) => ({ ...r, line: i + 1 }));
  const read = readRows(reader, rows, snapshot);
  const kindOf = new Map(read.map((r) => [r.fingerprint, r.activity.kind]));

  // What the brokerage holds now, and which bank row brought each.
  const ids = new Set<string>();
  for (let cursor: string | undefined, first = true; first || cursor; first = false) {
    const page = await ledger.accountLedger(book, link.account, cursor);
    for (const r of page.rows) ids.add(r.id);
    cursor = page.next_cursor ?? undefined;
  }
  const transactions = await Promise.all([...ids].map((id) => ledger.transaction(book, id)));
  const heldBy = new Map<string, string>();
  for (const h of db.holders(book, [...ids]))
    if (h.account === cash && h.fingerprint && h.transaction_id)
      heldBy.set(h.transaction_id, h.fingerprint);
  const outside = (account: string) =>
    /^(Assets|Liabilities):/.test(account) && !within(account, link.account);
  const kept = transactions.filter(
    (t) =>
      t.postings.some((p) => outside(p.account)) || kindOf.get(heldBy.get(t.id) ?? "") === "other"
  );
  const keptIds = new Set(kept.map((t) => t.id));
  const doomed = transactions.filter((t) => !keptIds.has(t.id));
  const keptRows = new Set(kept.flatMap((t) => (heldBy.has(t.id) ? [heldBy.get(t.id)!] : [])));
  const again = rows.filter((r) => !keptRows.has(`id:${r.id}`));

  const opensOn = dayBefore(link.starts_on);
  const opening = openingCash(cashOf(snapshot.balance, snapshot.holdings), read);
  const counts = Object.fromEntries(
    ["sweep", "dividend", "buy", "sell", "shares-in", "cash-in", "other"].map((k) => [k, 0])
  ) as Record<ActivityKind, number>;
  for (const r of read) if (!keptRows.has(r.fingerprint)) counts[r.activity.kind] += 1;
  const preview: RereadPreview = {
    account: link.account,
    institution: snapshot.institution,
    rows: rows.length,
    read: counts,
    kept: kept.length,
    deleted: doomed.length,
    deleted_yours: doomed.filter((t) => !heldBy.has(t.id) && t.narration !== "Opening balance")
      .length,
    opening: { date: opensOn, cash: opening },
    positions: positions(snapshot.holdings).size,
    dividends: dividendsOf(link, snapshot),
    currency: snapshot.currency,
  };

  return {
    preview,
    apply: async () => {
      await ledger.applyChanges(
        book,
        {
          create: [cashOpening(cash, opensOn, opening, snapshot.currency)],
          delete: doomed.map((t) => ({ id: t.id, updated_at: t.updated_at })),
        },
        STAGING
      );
      db.forgetRows(
        book,
        cash,
        again.map((r) => `id:${r.id}`)
      );
      for (const commodity of store.waits(link.id).keys()) store.setWait(link.id, null, commodity);
      await readHistory(deps, link, again, read, opensOn);
      return preview;
    },
  };
}

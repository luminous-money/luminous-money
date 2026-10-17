/**
 * Pairing transfers. A transfer between two of your accounts arrives twice: money out in one
 * account's import, and the same money in through another's, a day or so apart. Both land in
 * review, uncategorized. Pairing makes them the one transaction they are.
 *
 * - **A pair** is two unconfirmed, still-uncategorized transactions staged by imports, in
 *   different asset or liability accounts, one out and one in by the same amount, within
 *   `PAIR_WINDOW_DAYS` of each other. The closest dates pair first; each pairs once.
 * - **Pairing** writes the transfer (out of one, into the other, on the earlier date, still
 *   unconfirmed) and deletes the two in one atomic ledger write. The pair keeps the two as they
 *   were, and the import rows that held them now hold the transfer, so duplicates, matching and
 *   "Not at the bank" carry on as before.
 * - **Rejecting** restores the two (and points their rows back) in place of the transfer, and
 *   the pair is remembered, so they aren't paired again.
 * - **Confirming** the transfer is just confirming it; the pair is forgotten on the next pass.
 *
 * It runs after every import (a file, or a bank's sync), over the whole book's review.
 */
import type { Transaction, TransactionIn } from "@fava-beans/ledger-client";

import { negate } from "../shared/decimal.js";
import type { PairedTransfer } from "../shared/transfers.js";
import type { AppDb, HeldRow, PairedOriginal, TransferPair } from "./db.js";
import { UNCATEGORIZED } from "./imports.js";
import type { LedgerPort } from "./ledger.js";
import { sameNumber } from "./pipeline/matcher.js";

export const PAIR_WINDOW_DAYS = 7;

const DAY_MS = 864e5;
const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
const shortName = (account: string) => account.split(":").slice(-2).join(":");

/** The writable part of a transaction, to restore it as it was. */
function asInput(t: Transaction): TransactionIn {
  const { date, flag, payee, narration, tags, links, meta, postings } = t;
  return { date, flag, payee, narration, tags, links, meta, postings };
}

type Side = {
  transaction: Transaction;
  account: string;
  amount: { number: string; currency: string };
  rows: HeldRow[];
};

/** A transaction pairing could take: staged by an import into an asset or liability account,
 * still uncategorized on its other side. */
function sideOf(t: Transaction, rows: HeldRow[], types: Map<string, string | null>): Side | null {
  if (t.flag !== "!" || t.postings.length !== 2 || !rows.length) return null;
  if (rows.some((r) => r.outcome !== "staged" || r.match === "proposed")) return null;
  const anchor = t.postings.find((p) => p.account === rows[0]!.account);
  const other = t.postings.find((p) => p !== anchor);
  if (!anchor?.units || !other || anchor.cost || anchor.price) return null;
  if (other.account !== UNCATEGORIZED.out && other.account !== UNCATEGORIZED.in) return null;
  const type = types.get(anchor.account);
  if (type !== "asset" && type !== "liability") return null;
  return { transaction: t, account: anchor.account, amount: anchor.units, rows };
}

/** The transfer two sides make: out of one, into the other, on the earlier date. */
function transferOf(out: Side, into: Side): TransactionIn {
  const [first, second] = [out, into].sort((a, b) =>
    a.transaction.date.localeCompare(b.transaction.date)
  );
  return {
    date: first!.transaction.date,
    flag: "!",
    payee: out.transaction.payee ?? into.transaction.payee ?? null,
    narration: `Transfer from ${shortName(out.account)} to ${shortName(into.account)}`,
    tags: [],
    links: [],
    meta:
      second!.transaction.meta?.budget === false || first!.transaction.meta?.budget === false
        ? { budget: false }
        : {},
    postings: [
      { account: out.account, units: out.amount },
      { account: into.account, units: into.amount },
    ],
  };
}

const original = (side: Side): PairedOriginal => ({
  id: side.transaction.id,
  transaction: asInput(side.transaction),
  account: side.account,
  rows: side.rows.map((r) => ({ batch: r.batch_id, line: r.line })),
});

/**
 * Pair what's in the book's review that can be, in one ledger write. Returns each original's
 * ID with the transfer that replaced it.
 */
export async function pairTransfers({
  db,
  ledger,
  book,
}: {
  db: AppDb;
  ledger: LedgerPort;
  book: string;
}): Promise<Map<string, string>> {
  const unconfirmed = await ledger.unconfirmed(book);
  db.prunePairs(book, new Set(unconfirmed.map((t) => t.id)));
  const rejected = new Set(db.transferPairs(book, ["rejected"]).flatMap((p) => p.restored ?? []));
  const candidates = unconfirmed.filter((t) => !rejected.has(t.id));
  const held = new Map<string, HeldRow[]>();
  for (const row of db.holders(
    book,
    candidates.map((t) => t.id)
  ))
    held.set(row.transaction_id!, [...(held.get(row.transaction_id!) ?? []), row]);
  const types = new Map((await ledger.accounts(book)).map((a) => [a.name, a.type ?? null]));

  const sides = candidates.flatMap((t) => sideOf(t, held.get(t.id) ?? [], types) ?? []);
  const outs = sides.filter((s) => s.amount.number.startsWith("-"));
  const ins = sides.filter((s) => !s.amount.number.startsWith("-"));
  const options = outs
    .flatMap((out) =>
      ins
        .filter(
          (into) =>
            into.account !== out.account &&
            into.amount.currency === out.amount.currency &&
            sameNumber(into.amount.number, negate(out.amount.number)) &&
            daysApart(into.transaction.date, out.transaction.date) <= PAIR_WINDOW_DAYS
        )
        .map((into) => ({
          out,
          into,
          apart: daysApart(into.transaction.date, out.transaction.date),
        }))
    )
    .sort(
      (a, b) => a.apart - b.apart || a.out.transaction.date.localeCompare(b.out.transaction.date)
    );
  const used = new Set<string>();
  const pairs: { out: Side; into: Side }[] = [];
  for (const o of options) {
    if (used.has(o.out.transaction.id) || used.has(o.into.transaction.id)) continue;
    used.add(o.out.transaction.id).add(o.into.transaction.id);
    pairs.push(o);
  }
  if (!pairs.length) return new Map();

  const created = await ledger.applyChanges(book, {
    create: pairs.map((p) => transferOf(p.out, p.into)),
    delete: pairs.flatMap((p) =>
      [p.out, p.into].map((s) => ({ id: s.transaction.id, updated_at: s.transaction.updated_at }))
    ),
  });
  db.recordPairs(
    book,
    pairs.map((p, i) => ({
      transaction_id: created[i]!.id,
      originals: [original(p.out), original(p.into)],
    }))
  );
  return new Map(
    pairs.flatMap((p, i) => [
      [p.out.transaction.id, created[i]!.id],
      [p.into.transaction.id, created[i]!.id],
    ])
  );
}

/** Pair after an import, and show its rows holding what they hold now. */
export async function pairAfterImport<R extends { rows: { transaction_id: string | null }[] }>(
  deps: { db: AppDb; ledger: LedgerPort; book: string },
  result: R
): Promise<R> {
  const replaced = await pairTransfers(deps);
  if (!replaced.size) return result;
  return {
    ...result,
    rows: result.rows.map((r) =>
      r.transaction_id && replaced.has(r.transaction_id)
        ? { ...r, transaction_id: replaced.get(r.transaction_id)! }
        : r
    ),
  };
}

export class TransferProblem extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string
  ) {
    super(message);
  }
}

/** Reject a paired transfer: the two it was made of come back in its place (with new IDs, which
 * their rows now hold). Only while it's unconfirmed. */
export async function rejectTransfer({
  db,
  ledger,
  book,
  transactionId,
}: {
  db: AppDb;
  ledger: LedgerPort;
  book: string;
  transactionId: string;
}): Promise<string[]> {
  const pair = db.transferPair(book, transactionId);
  if (!pair) throw new TransferProblem(404, "that isn't a paired transfer");
  const transfer = await ledger.transaction(book, transactionId);
  if (transfer.flag !== "!") throw new TransferProblem(409, "it's confirmed: edit it instead");
  const restored = await ledger.applyChanges(book, {
    create: pair.originals.map((o) => o.transaction),
    delete: [{ id: transfer.id, updated_at: transfer.updated_at }],
  });
  const ids = restored.map((t) => t.id);
  db.rejectPair(pair, ids);
  return ids;
}

/** The book's paired transfers as review shows them. */
export function pairedTransfers(db: AppDb, book: string): PairedTransfer[] {
  return db.transferPairs(book).map((p: TransferPair) => ({
    transaction_id: p.transaction_id,
    originals: p.originals.map((o) => ({
      account: o.account,
      date: o.transaction.date,
      amount: o.transaction.postings.find((x) => x.account === o.account)?.units ?? null,
      description: o.transaction.narration,
      payee: o.transaction.payee ?? null,
    })),
  }));
}

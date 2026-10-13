/**
 * Reviewing matches: what's proposed, and changing or confirming a row's transaction.
 *
 * A row of an import holds one transaction: one already in the account that it matched, or a
 * new one staged from it. A transaction is held by at most one row of the account's imports.
 * `assign` changes which, in one operation:
 *
 * - **to another free candidate** ("Match with this instead")
 * - **to a candidate another row holds** ("Swap"): the two rows exchange transactions
 * - **to nothing** ("Not a match"): the row is staged as its own new transaction
 *
 * When a row moves off the transaction staged from it, that transaction is deleted; when a row
 * becomes new, one is staged from its date, amount, description and payee. The ledger changes
 * are one atomic write; then the rows are updated. Every row touched is left proposed, since it
 * changed, until it's confirmed in review.
 */
import type { TransactionIn } from "@fava-beans/ledger-client";

import type { ProposedMatch } from "../shared/imports.js";
import type { AppDb, HeldRow } from "./db.js";
import { ensureUncategorized, stagedTransaction, type Stageable } from "./imports.js";
import type { LedgerPort } from "./ledger.js";
import { sameNumber } from "./pipeline/matcher.js";

export type RowRef = { batch: string; line: number };

export class MatchProblem extends Error {
  constructor(
    readonly code: "not-found" | "not-proposed" | "not-a-candidate",
    message: string
  ) {
    super(message);
  }
}

const ref = (row: HeldRow): RowRef => ({ batch: row.batch_id, line: row.line });

const stageable = (row: HeldRow): Stageable => ({
  date: row.date!,
  amount: row.amount!,
  description: row.description,
  payee: row.payee,
  fingerprint: row.fingerprint!,
});

/** Rows with a proposed match, each candidate with the row holding it, if another does. */
export function proposedMatches(db: AppDb, book: string): ProposedMatch[] {
  return db.proposed(book).map((row) => ({
    batch_id: row.batch_id,
    account: row.account,
    filename: row.filename,
    line: row.line,
    date: row.date,
    amount: row.amount,
    description: row.description,
    payee: row.payee,
    outcome: row.outcome,
    transaction_id: row.transaction_id,
    candidates: row.candidates.map((c) => {
      const holder =
        c.transaction_id === row.transaction_id
          ? undefined
          : db.holder(book, row.account, c.transaction_id, ref(row));
      return {
        ...c,
        holder: holder
          ? {
              batch_id: holder.batch_id,
              line: holder.line,
              date: holder.date,
              description: holder.description,
            }
          : null,
      };
    }),
  }));
}

export async function assignRow({
  db,
  ledger,
  book,
  row: at,
  to,
}: {
  db: AppDb;
  ledger: LedgerPort;
  book: string;
  row: RowRef;
  /** A candidate's transaction ID, or null for a new transaction. */
  to: string | null;
}): Promise<void> {
  const row = db.row(book, at.batch, at.line);
  if (!row) throw new MatchProblem("not-found", "there's no such import row");
  if (row.match !== "proposed")
    throw new MatchProblem("not-proposed", "this row's match isn't up for review");
  if (to !== null && !row.candidates.some((c) => c.transaction_id === to))
    throw new MatchProblem(
      "not-a-candidate",
      "that transaction isn't one of this row's candidates"
    );
  if (to === row.transaction_id || (to === null && row.outcome === "staged")) return;

  const holder = to === null ? undefined : db.holder(book, row.account, to, at);
  const create: TransactionIn[] = [];
  const remove: { id: string; updated_at: string }[] = [];

  // The row's own staged transaction goes when it takes another.
  if (row.outcome === "staged") {
    const staged = await ledger.transaction(book, row.transaction_id!);
    remove.push({ id: staged.id, updated_at: staged.updated_at });
  }
  // Someone becomes new: the row (not a match), or a holder the row had no match to give.
  const fresh = to === null ? row : holder && row.outcome === "staged" ? holder : undefined;
  if (fresh) {
    const [summary] = await ledger.summary(book, [fresh.account]);
    await ensureUncategorized(ledger, book, [stageable(fresh)]);
    create.push(
      stagedTransaction(
        fresh.account,
        summary?.currencies?.[0] ?? "USD",
        fresh.batch_id,
        stageable(fresh)
      )
    );
  }
  const [created] =
    create.length || remove.length
      ? await ledger.applyChanges(book, { create, delete: remove })
      : [];

  const changes: Parameters<AppDb["setRows"]>[0] = [
    to === null
      ? { ...at, outcome: "staged", transaction_id: created!.id, match: "proposed" }
      : { ...at, outcome: "matched", transaction_id: to, match: "proposed" },
  ];
  if (holder) {
    changes.push(
      row.outcome === "matched"
        ? {
            ...ref(holder),
            outcome: "matched",
            transaction_id: row.transaction_id!,
            match: "proposed",
          }
        : { ...ref(holder), outcome: "staged", transaction_id: created!.id, match: "proposed" }
    );
  }
  db.setRows(changes);
}

/**
 * Confirm a row's match: its transaction is final, and it leaves review. A transaction matched
 * within a scheduled split's tolerance takes the bank's amount for that split (the blank split
 * absorbs the difference).
 */
export async function confirmRow(
  db: AppDb,
  ledger: LedgerPort,
  book: string,
  at: RowRef
): Promise<void> {
  const row = db.row(book, at.batch, at.line);
  if (!row) throw new MatchProblem("not-found", "there's no such import row");
  if (row.match !== "proposed")
    throw new MatchProblem("not-proposed", "this row's match isn't up for review");
  if (row.outcome === "matched" && row.amount) {
    const t = await ledger.transaction(book, row.transaction_id!);
    const split = t.postings.find((p) => p.account === row.account);
    if (split?.units && !sameNumber(split.units.number, row.amount)) {
      await ledger.patch(
        book,
        t.id,
        {
          postings: t.postings.map((p) =>
            p === split ? { ...p, units: { ...split.units!, number: row.amount! } } : p
          ),
        },
        t.updated_at
      );
    }
  }
  db.setRows([
    {
      ...at,
      outcome: row.outcome as "staged" | "matched",
      transaction_id: row.transaction_id!,
      match: "confirmed",
    },
  ]);
}

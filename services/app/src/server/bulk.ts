/**
 * Select mode's bulk edits (`shared/bulk.ts`): the whole selection read in one go, each one's
 * change worked out here, and all of them written in one atomic write (the ledger's
 * `transactions/changes`), against the versions the PWA read. One request and one write, where
 * a transaction at a time was two requests each through the gateway: tagging 46 took most of a
 * minute (Kael, 2026-11-22).
 */
import type { Transaction } from "@luminous-money/ledger-client";

import type { BulkEdit, BulkResult } from "../shared/bulk.js";
import { sameLines, shapesFor, UNALLOCATED, wholeLines } from "../shared/funds.js";
import { simple, withCounterpart, withOtherSide } from "../shared/split.js";
import { toTag, withoutTag, withTag } from "../shared/tags.js";
import type { AppDb } from "./db.js";
import { withBankAmount } from "./imports.js";
import type { LedgerPort, TransactionEdit } from "./ledger.js";

/** The most one request takes. */
export const BULK_LIMIT = 2000;

export class BulkProblem extends Error {
  constructor(
    readonly status: 409 | 422,
    message: string
  ) {
    super(message);
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** The tags in `v` as `toTag` makes them, or null unless it's a list of text. */
function tagsIn(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.every((t) => typeof t === "string")) return null;
  return [...new Set(v.map(toTag).filter((t): t is string => !!t))];
}

/** The request as a `BulkEdit`, or why it isn't one. */
export function bulkEditFrom(body: unknown): BulkEdit | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const picked = b["transactions"];
  if (
    !Array.isArray(picked) ||
    !picked.length ||
    !picked.every((t) => isText(t?.id) && isText(t?.updated_at))
  )
    return "send the transactions, each with its id and the updated_at read";
  if (picked.length > BULK_LIMIT) return `at most ${BULK_LIMIT} at once`;
  const transactions = (picked as { id: string; updated_at: string }[]).map(
    ({ id, updated_at }) => ({ id, updated_at })
  );
  switch (b["op"]) {
    case "confirm":
      return { op: "confirm", matches: b["matches"] === true, transactions };
    case "categorize":
      if (!isText(b["account"])) return "send the account to categorize as";
      if (b["own"] !== undefined && !isText(b["own"])) return "own is an account";
      return {
        op: "categorize",
        account: b["account"],
        ...(isText(b["own"]) ? { own: b["own"] } : {}),
        transactions,
      };
    case "tags": {
      const add = tagsIn(b["add"] ?? []);
      const remove = tagsIn(b["remove"] ?? []);
      if (!add || !remove) return "add and remove are lists of tags";
      if (add.some((t) => remove.includes(t))) return "a tag can't be both added and removed";
      return { op: "tags", add, remove, transactions };
    }
    case "fund":
      if (!isText(b["fund"])) return `send the fund, or ${UNALLOCATED} to clear them`;
      return { op: "fund", fund: b["fund"], transactions };
    default:
      return "op is confirm, categorize, tags or fund";
  }
}

/** Do `edit` to the selection: all of it, or (a version that's moved on) none of it. */
export async function bulkEdit(
  db: AppDb,
  ledger: LedgerPort,
  book: string,
  edit: BulkEdit
): Promise<BulkResult> {
  const read = new Map(edit.transactions.map((t) => [t.id, t.updated_at]));
  const current = await ledger.transactionsById(book, [...read.keys()]);
  const moved = read.size - current.filter((t) => t.updated_at === read.get(t.id)).length;
  if (moved)
    throw new BulkProblem(
      409,
      `${plural(moved, "transaction")} changed since they were read: nothing was changed`
    );

  const result: BulkResult = { changed: 0, unchanged: 0, skipped: 0, matches: 0 };
  const updates: TransactionEdit[] = [];
  const put = (t: Transaction, changes: Omit<TransactionEdit, "id" | "updated_at"> | null) => {
    if (changes === null) result.skipped++;
    else if (!Object.keys(changes).length) result.unchanged++;
    else {
      result.changed++;
      updates.push({ id: t.id, updated_at: t.updated_at, ...changes });
    }
  };
  // Postings as a change, or none when they're the same splits.
  const postings = (t: Transaction, next: Transaction["postings"]) =>
    next.every((p, i) => p === t.postings[i]) ? {} : { postings: next };
  const confirming: Parameters<AppDb["setRows"]>[0] = [];

  switch (edit.op) {
    case "confirm": {
      const short = new Set((await ledger.shortTransactions(book)).map((t) => t.id));
      const proposed = edit.matches ? db.proposed(book) : [];
      for (const t of current) {
        if (t.flag === "!" && short.has(t.id)) {
          put(t, null); // it needs a fund first
          continue;
        }
        let next = t.postings;
        for (const row of proposed.filter((r) => r.transaction_id === t.id)) {
          if (row.outcome === "matched" && row.amount)
            next = withBankAmount(next, row.account, row.amount) ?? next;
          confirming.push({
            batch: row.batch_id,
            line: row.line,
            outcome: row.outcome as "staged" | "matched",
            transaction_id: t.id,
            match: "confirmed",
          });
        }
        put(t, { ...(t.flag === "!" ? { flag: "*" } : {}), ...postings(t, next) });
      }
      break;
    }
    case "categorize":
      for (const t of current) {
        const moved = edit.own
          ? withOtherSide(t, edit.own, edit.account)
          : simple(t) && withCounterpart(t, edit.account);
        put(t, moved ? postings(t, moved.postings) : null);
      }
      break;
    case "tags":
      for (const t of current) {
        let next = t.postings;
        for (const tag of edit.remove) next = withoutTag(next, tag);
        for (const tag of edit.add) next = withTag(next, tag);
        put(t, postings(t, next));
      }
      break;
    case "fund": {
      const currency = edit.fund === UNALLOCATED ? "" : (await ledger.funds(book)).currency;
      for (const t of current) {
        const whole =
          edit.fund === UNALLOCATED ? [] : wholeLines(shapesFor(t.postings, currency), edit.fund);
        if (edit.fund !== UNALLOCATED && !whole.length) put(t, null);
        else put(t, sameLines(t.funds, whole) ? {} : { funds: whole });
      }
      break;
    }
  }

  if (updates.length) await ledger.applyChanges(book, { create: [], update: updates, delete: [] });
  if (confirming.length) db.setRows(confirming);
  result.matches = confirming.length;
  return result;
}

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Row } from "@luminous-money/csv-import";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDb } from "./db.js";
import { lastBalance } from "./imports.js";
import { finish, ReconcileProblem, reconcileView, saveDraft } from "./reconcile.js";
import { FakeLedger } from "./testing.js";

const CHECKING = "Assets:Bank:Checking";
let db: AppDb;
let ledger: FakeLedger;
const deps = () => ({ db, ledger, book: "b" });

const spend = (date: string, amount: string, other = "Expenses:Food") =>
  ledger.addTransaction({
    date,
    flag: "!",
    payee: null,
    narration: "",
    tags: [],
    links: [],
    meta: {},
    postings: [
      { account: CHECKING, units: { number: amount, currency: "USD" } },
      { account: other, units: null },
    ],
  });

beforeEach(() => {
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(CHECKING, { currencies: ["USD"] });
});

/** An import batch into the account holding `transactions`, with the file's last balance. */
function imported(transactions: string[], end?: { date: string; balance: string }) {
  db.saveImport(
    {
      id: `batch${transactions.join("")}`,
      book_id: "b",
      user_id: "u",
      account: CHECKING,
      source: "csv",
      filename: "f.csv",
      created_at: "2026-02-01T00:00:00.000000Z",
      rows: transactions.length,
      staged: transactions.length,
      matched: 0,
      duplicates: 0,
      skipped: 0,
      unreadable: 0,
      end_date: end?.date ?? null,
      end_balance: end?.balance ?? null,
    },
    transactions.map((id, i) => ({
      line: i + 1,
      date: "2026-01-05",
      amount: "-1.00",
      description: "",
      payee: null,
      outcome: "staged",
      error: null,
      transaction_id: id,
      candidates: [],
      match: null,
      fingerprint: `f${id}`,
    }))
  );
}

describe("the Reconcile screen", () => {
  it("prefills the last file's balance and ticks what was imported, and the opening balance", async () => {
    const opening = spend("2026-01-01", "100.00", "Equity:Opening-Balances");
    const fromFile = spend("2026-01-05", "-12.00");
    spend("2026-01-09", "-3.00"); // by hand: on the statement or not, you say
    imported([fromFile.id], { date: "2026-01-31", balance: "85.00" });

    const view = await reconcileView(deps(), CHECKING);

    expect(view.prefill).toEqual({
      statement_date: "2026-01-31",
      balance: "85.00",
      source: "file",
    });
    expect(view.through).toBe("2026-01-31");
    expect(view.ticked.sort()).toEqual([opening.id, fromFile.id].sort());
  });

  it("saves for later, by version, and finishing drops the draft", async () => {
    const a = spend("2026-01-05", "-12.00");
    const saved = saveDraft(
      db,
      "b",
      "u",
      { account: CHECKING, statement_date: "2026-01-31", balance: "-12.00", ticked: [a.id] },
      null
    );
    expect(() =>
      saveDraft(
        db,
        "b",
        "u",
        { account: CHECKING, statement_date: null, balance: null, ticked: [] },
        null
      )
    ).toThrow(ReconcileProblem);

    const view = await reconcileView(deps(), CHECKING);
    expect([view.draft?.updated_at, view.ticked, view.through]).toEqual([
      saved.updated_at,
      [a.id],
      "2026-01-31",
    ]);

    await finish(deps(), CHECKING, {
      statement_date: "2026-01-31",
      balance: "-12.00",
      transactions: [a.id],
    });
    expect(db.draft("b", CHECKING)).toBeUndefined();
    expect(ledger.transactions[0]!.flag).toBe("*"); // confirmed with it
  });
});

describe("a file's last balance", () => {
  const row = (date: string, amount: string, balance: string): Row => ({
    line: 0,
    date,
    amount,
    description: "",
    payee: null,
    id: null,
    balance,
    error: null,
  });

  it("is the newest row's, whichever way the file runs", () => {
    const oldestFirst = [row("2026-01-02", "-5.00", "95.00"), row("2026-01-03", "-5.00", "90.00")];
    expect(lastBalance(oldestFirst, false)).toEqual({ date: "2026-01-03", balance: "90.00" });
    expect(lastBalance([...oldestFirst].reverse(), false)).toEqual({
      date: "2026-01-03",
      balance: "90.00",
    });
    // One day: the running balance says which way.
    const sameDay = [row("2026-01-03", "-5.00", "95.00"), row("2026-01-03", "-5.00", "90.00")];
    expect(lastBalance(sameDay, false)?.balance).toBe("90.00");
  });

  it("shows a card's balance owed, or as stored: the running balance says which", () => {
    // A purchase (-20) raises what's owed from 100 to 120.
    const owed = [row("2026-01-02", "-20.00", "100.00"), row("2026-01-03", "-20.00", "120.00")];
    expect(lastBalance(owed, true)?.balance).toBe("-120.00");
    const stored = [row("2026-01-02", "-20.00", "-100.00"), row("2026-01-03", "-20.00", "-120.00")];
    expect(lastBalance(stored, true)?.balance).toBe("-120.00");
  });
});

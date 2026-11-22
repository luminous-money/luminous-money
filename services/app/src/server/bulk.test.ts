import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@luminous-money/csv-import";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BulkChange } from "../shared/bulk.js";
import { tagsOf } from "../shared/tags.js";
import { bulkEdit, bulkEditFrom, BulkProblem } from "./bulk.js";
import { AppDb } from "./db.js";
import { importFile } from "./imports.js";
import { proposedMatches } from "./matches.js";
import { FakeLedger } from "./testing.js";

const CHECKING = "Assets:Bank:Checking";
const HEADER = "Date,Description,Amount,Balance\n";

let db: AppDb;
let ledger: FakeLedger;

const spend = (narration: string, extra: { tags?: string[]; flag?: string; date?: string } = {}) =>
  ledger.addTransaction({
    date: extra.date ?? "2024-03-05",
    flag: extra.flag ?? "!",
    narration,
    postings: [
      { account: CHECKING, units: { number: "-5.00", currency: "USD" } },
      { account: "Expenses:Food", units: { number: "5.00", currency: "USD" }, tags: extra.tags },
    ],
  });

const picked = (...ids: string[]) =>
  ids.map((id) => {
    const t = ledger.transactions.find((x) => x.id === id)!;
    return { id, updated_at: t.updated_at };
  });

const run = (ids: string[], change: BulkChange) =>
  bulkEdit(db, ledger, "b", { ...change, transactions: picked(...ids) });

const tags = (id: string) => tagsOf(ledger.transactions.find((t) => t.id === id)!.postings);

beforeEach(() => {
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(CHECKING, { open: "2024-01-01", currencies: ["USD"] });
});

describe("bulk edits", () => {
  it("edit tags: adds and removes, leaving a tag in neither list as it was on each", async () => {
    const a = spend("A", { tags: ["trip", "work"] }).id;
    const b = spend("B", { tags: ["work"] }).id;
    const c = spend("C").id;
    const writes = vi.spyOn(ledger, "applyChanges");

    const result = await run([a, b, c], { op: "tags", add: ["italy"], remove: ["work"] });

    expect([tags(a), tags(b), tags(c)]).toEqual([["italy", "trip"], ["italy"], ["italy"]]);
    expect(result).toEqual({ changed: 3, unchanged: 0, skipped: 0, matches: 0 });
    expect(writes).toHaveBeenCalledTimes(1); // all of them in one write
  });

  it("counts the ones already that way, and writes nothing when they all are", async () => {
    const a = spend("A", { tags: ["trip"] }).id;
    const writes = vi.spyOn(ledger, "applyChanges");
    expect(await run([a], { op: "tags", add: ["trip"], remove: ["work"] })).toMatchObject({
      changed: 0,
      unchanged: 1,
    });
    expect(writes).not.toHaveBeenCalled();
  });

  it("refuses all of it when one has changed since it was read", async () => {
    const a = spend("A").id;
    const b = spend("B").id;
    const transactions = picked(a, b);
    ledger.transactions.find((t) => t.id === b)!.updated_at = "v9"; // edited elsewhere since

    await expect(
      bulkEdit(db, ledger, "b", { op: "tags", add: ["x"], remove: [], transactions })
    ).rejects.toThrow(
      new BulkProblem(409, "1 transaction changed since they were read: nothing was changed")
    );
    expect(tags(a)).toEqual([]);
  });

  it("confirms, skipping one that needs a fund, and confirms their proposed matches", async () => {
    db.replaceProfiles("b", CHECKING, [guessProfile(`${HEADER}03/05/2024,CAFE,-5.00,1\n`)!]);
    const matched = spend("Coffee").id;
    // Months away: nothing the bank's row could match.
    const plain = spend("Lunch", { date: "2024-01-05" }).id;
    const short = spend("Shares", { date: "2024-01-05" }).id;
    ledger.shortList = [{ id: short } as (typeof ledger.shortList)[number]];
    await importFile({
      db,
      ledger,
      book: "b",
      account: CHECKING,
      filename: "cafe.csv",
      text: `${HEADER}03/05/2024,CAFE,-5.00,1\n`,
      userId: "u",
    });
    expect((await proposedMatches(db, ledger, "b")).map((m) => m.transaction_id)).toEqual([
      matched,
    ]);

    const result = await run([matched, plain, short], { op: "confirm", matches: true });

    const flag = (id: string) => ledger.transactions.find((t) => t.id === id)!.flag;
    expect(result).toEqual({ changed: 2, unchanged: 0, skipped: 1, matches: 1 });
    expect([flag(matched), flag(plain), flag(short)]).toEqual(["*", "*", "!"]);
    expect(await proposedMatches(db, ledger, "b")).toEqual([]);
  });

  it("categorizes two-split ones, relative to the ledger's account when given", async () => {
    const a = spend("A").id;
    await run([a], { op: "categorize", account: "Expenses:Travel" });
    expect(ledger.transactions.find((t) => t.id === a)!.postings[1]!.account).toBe(
      "Expenses:Travel"
    );
    await run([a], { op: "categorize", account: "Assets:Savings", own: "Expenses:Travel" });
    expect(ledger.transactions.find((t) => t.id === a)!.postings.map((p) => p.account)).toEqual([
      "Assets:Savings",
      "Expenses:Travel",
    ]);
  });

  it("sets or clears a fund", async () => {
    const a = spend("A").id;
    expect(await run([a], { op: "fund", fund: "Unallocated" })).toMatchObject({ unchanged: 1 });
    await run([a], { op: "fund", fund: "Travel" });
    expect(ledger.transactions.find((t) => t.id === a)!.funds).toEqual([
      { fund: "Travel", amount: { number: "-5.00", currency: "USD" } },
    ]);
  });
});

describe("a bulk edit's request", () => {
  const transactions = [{ id: "t1", updated_at: "v1" }];

  it("normalizes tags, and refuses one both added and removed", () => {
    expect(bulkEditFrom({ op: "tags", add: ["#Trip to Italy"], transactions })).toEqual({
      op: "tags",
      add: ["trip-to-italy"],
      remove: [],
      transactions,
    });
    expect(bulkEditFrom({ op: "tags", add: ["a"], remove: ["#A"], transactions })).toBe(
      "a tag can't be both added and removed"
    );
  });

  it("needs a selection with versions, and an op", () => {
    expect(bulkEditFrom({ op: "confirm", transactions: [] })).toMatch(/send the transactions/);
    expect(bulkEditFrom({ op: "confirm", transactions: [{ id: "t1" }] })).toMatch(/updated_at/);
    expect(bulkEditFrom({ op: "delete", transactions })).toMatch(/op is/);
    expect(bulkEditFrom({ op: "categorize", transactions })).toMatch(/account/);
  });
});

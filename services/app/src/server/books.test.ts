import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@fava-beans/csv-import";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDb } from "./db.js";
import { createSchedule } from "./schedules.js";
import { FakeLedger } from "./testing.js";

const CHECKING = "Assets:Bank:Checking";

let db: AppDb;
let ledger: FakeLedger;

/** Something of everything `app` keeps per book. */
async function fill(book: string) {
  ledger.addBook(book);
  db.star("u", book, CHECKING);
  db.addProfile(book, CHECKING, guessProfile("Date,Amount\n2024-01-02,-1.00\n")!);
  db.setTimeZone(book, "America/Chicago", "u");
  db.recordPriceFetch(book, "2024-01-02", { fetched: [], errors: {} });
  await createSchedule({
    db,
    ledgerFor: () => ledger,
    user: "u",
    book,
    on: "2024-01-01",
    input: {
      name: "Rent",
      rule: {
        every: 1,
        unit: "month",
        days: [],
        start: "2024-01-01",
        until: null,
        weekend: "keep",
      },
      template: {
        payee: null,
        narration: "Rent",
        tags: [],
        links: [],
        meta: {},
        postings: [
          { account: CHECKING, units: { number: "-1.00", currency: "USD" } },
          { account: "Expenses:Rent", units: null },
        ],
      },
    },
  });
}

beforeEach(() => {
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addAccount(CHECKING);
  ledger.addAccount("Expenses:Rent", { type: "expense" });
});

describe("forgetting a deleted book", () => {
  it("removes everything kept about it, and nothing about other books", async () => {
    await fill("gone");
    await fill("kept");

    db.forgetBook("gone");

    for (const [book, present] of [
      ["gone", false],
      ["kept", true],
    ] as const) {
      expect(db.stars("u", book).length > 0).toBe(present);
      expect(db.profiles(book, CHECKING).length > 0).toBe(present);
      expect(db.timeZone(book) !== undefined).toBe(present);
      expect(db.lastPriceFetch(book) !== undefined).toBe(present);
      expect(db.activeSchedules().some((s) => s.book_id === book)).toBe(present);
    }
  });
});

describe("book settings", () => {
  it("start their weeks on Monday, and change only against the version read", () => {
    db.setTimeZone("b", "America/Chicago", "u");
    const read = db.settings("b")!;
    expect(read.week_start).toBe(1);

    const changed = db.patchSettings("b", read.updated_at, { week_start: 0 });

    expect(changed).toMatchObject({ time_zone: "America/Chicago", week_start: 0 });
    expect(db.settings("b")).toEqual(changed);
    expect(() => db.patchSettings("b", read.updated_at, { week_start: 6 })).toThrow(/changed/);
  });
});

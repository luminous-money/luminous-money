/** Divided accounts in `app` (M15): imports land in the main part, rules choose a part, and what
 * posted to an account follows it into its main part when it's divided. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@luminous-money/csv-import";
import { beforeEach, describe, expect, it } from "vitest";

import { rules } from "./categorize/rules.js";
import { AppDb } from "./db.js";
import { importFile } from "./imports.js";
import { FakeLedger } from "./testing.js";

const PNC = "Assets:Bank:PNC";
const GENERAL = `${PNC}:General`;
const PADDING = `${PNC}:Padding`;
const FILE = `Date,Description,Amount
03/05/2024,CORNER CAFE,-4.50
03/07/2024,ACME PAYROLL,2000.00
03/09/2024,INTEREST PAID,1.25
`;

let db: AppDb;
let ledger: FakeLedger;
const run = (text = FILE) =>
  importFile({
    db,
    ledger,
    book: "b",
    account: PNC,
    filename: "march.csv",
    text,
    userId: "u",
    categorizers: [rules((book) => db.rules(book))],
  });

beforeEach(async () => {
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(PNC, { open: "2024-01-01", as_of: "2024-01-01", currencies: ["USD"] });
  ledger.addAccount("Income:Interest", { type: "income" });
  db.replaceProfiles("b", PNC, [guessProfile(FILE)!]);
  await ledger.divide("b", PNC, { parts: [{ name: "Padding", amount: "0" }], date: "2024-02-01" });
});

describe("a divided account's imports", () => {
  it("land in its main part, the batch the whole's, so duplicates are still caught", async () => {
    const first = await run();

    expect(first.batch).toMatchObject({ account: PNC, staged: 3 });
    expect(ledger.transactions.map((t) => t.postings[0]!.account)).toEqual([
      GENERAL,
      GENERAL,
      GENERAL,
    ]);
    expect((await run()).batch.duplicates).toBe(3);
  });

  it("match what you entered from any of its parts", async () => {
    const mine = ledger.addTransaction({
      date: "2024-03-05",
      flag: "*",
      payee: "Corner Cafe",
      narration: "",
      tags: [],
      links: [],
      meta: {},
      postings: [
        { account: PADDING, units: { number: "-4.50", currency: "USD" } },
        { account: "Expenses:Food", units: null },
      ],
    });

    const result = await run();

    expect(result.rows[0]).toMatchObject({ outcome: "matched", transaction_id: mine.id });
  });

  it("go to the part a rule says", async () => {
    db.addRule("b", {
      name: "Interest",
      conditions: { account: PNC, key: null, contains: "interest", min: null, max: null },
      account: "Income:Interest",
      payee: "PNC",
      part: PADDING,
      auto_confirm: false,
    });

    await run();

    const interest = ledger.transactions.find((t) => t.narration === "INTEREST PAID")!;
    expect(interest.postings.map((p) => p.account)).toEqual([PADDING, "Income:Interest"]);
  });
});

describe("dividing an account", () => {
  it("moves what posted to it into its main part: schedules and rules' categories", () => {
    const whole = "Assets:Bank:Savings";
    db.addRule("b", {
      name: "Sweep",
      conditions: { account: null, key: null, contains: "sweep", min: null, max: null },
      account: whole,
      payee: null,
      auto_confirm: false,
    });
    db.addSchedule({
      user_id: "u",
      book_id: "b",
      name: "Save",
      rule: { every: 1, unit: "month", start: "2024-01-01" } as never,
      template: {
        flag: "*",
        payee: null,
        narration: "Save",
        postings: [{ account: whole, units: null }],
      } as never,
      paused: false,
      auto_confirm: false,
    });

    db.divideAccount("b", whole, `${whole}:General`);

    expect(db.rules("b")[0]!.account).toBe(`${whole}:General`);
    expect(db.schedules("b")[0]!.template.postings[0]!.account).toBe(`${whole}:General`);
  });
});

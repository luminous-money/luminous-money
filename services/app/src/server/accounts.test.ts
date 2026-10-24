import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@luminous-money/csv-import";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDb } from "./db.js";
import { importFile } from "./imports.js";
import { FakeLedger } from "./testing.js";

let db: AppDb;

beforeEach(() => {
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  db.star("u", "b", "Expenses:Food:Coffee");
  db.star("u", "b", "Assets:Bank:Checking");
  db.addProfile("b", "Assets:Bank:Checking", guessProfile("Date,Amount\n2024-01-02,-1.00\n")!);
  db.addRule("b", {
    name: "Coffee",
    conditions: {
      account: "Assets:Bank:Checking",
      key: null,
      contains: "CAFE",
      min: null,
      max: null,
    },
    account: "Expenses:Food:Coffee",
    payee: null,
    auto_confirm: false,
  } as never);
});

const rule = () => db.rules("b")[0]!;

describe("what app keeps by account name", () => {
  it("follows a rename, everything under the account included", () => {
    db.renameAccount("b", "Expenses:Food", "Expenses:Eating");

    expect(db.stars("u", "b")).toContain("Expenses:Eating:Coffee");
    expect(rule().account).toBe("Expenses:Eating:Coffee");
    expect(rule().conditions).toMatchObject({ account: "Assets:Bank:Checking" });

    db.renameAccount("b", "Assets:Bank:Checking", "Assets:Bank:Everyday");
    expect(db.profiles("b", "Assets:Bank:Everyday")).toHaveLength(1);
    expect(rule().conditions).toMatchObject({ account: "Assets:Bank:Everyday" });
  });

  it("follows a merge: references move to the substitute, stars on the deleted go", () => {
    db.mergeAccounts("b", ["Expenses:Food:Coffee"], "Expenses:Fun");

    expect(db.stars("u", "b")).toEqual(["Assets:Bank:Checking"]);
    expect(rule().account).toBe("Expenses:Fun");

    db.mergeAccounts("b", ["Assets:Bank:Checking"], "Assets:Bank:Savings");
    expect(db.profiles("b", "Assets:Bank:Savings")).toHaveLength(1); // the substitute had none
  });
});

describe("deleting accounts with their transactions", () => {
  const FILE =
    "Date,Description,Amount,Balance\n03/05/2024,CORNER CAFE,-4.50,1\n03/06/2024,RENT,-900.00,1\n";

  it("forgets everything about them, and what went with their transactions in other accounts", async () => {
    const ledger = new FakeLedger();
    ledger.addBook("b");
    for (const a of ["Assets:Bank:Checking", "Assets:Bank:Savings", "Expenses:Food:Coffee"])
      ledger.addAccount(a);
    db.replaceProfiles("b", "Assets:Bank:Savings", [guessProfile(FILE)!]);
    const savings = await importFile({
      db,
      ledger,
      book: "b",
      account: "Assets:Bank:Savings",
      filename: "f.csv",
      text: FILE,
      userId: "u",
      categorizers: [],
    });
    const [cafe, rent] = savings.rows.map((r) => r.transaction_id!);
    db.addSchedule({
      user_id: "u",
      book_id: "b",
      name: "Coffee",
      rule: {} as never,
      template: { postings: [{ account: "Expenses:Food:Coffee", units: null }] } as never,
      paused: false,
      auto_confirm: false,
    });

    // Coffee goes, and the café's transaction from savings with it.
    db.purgeAccounts("b", ["Expenses:Food:Coffee", "Assets:Bank:Checking"], [cafe!]);

    expect(db.stars("u", "b")).toEqual([]);
    expect(db.rules("b")).toEqual([]); // it landed in Coffee, and matched Checking
    expect(db.profiles("b", "Assets:Bank:Checking")).toEqual([]);
    expect(db.schedules("b")).toEqual([]);
    // Savings keeps its import, without the row whose transaction went: re-importing brings it back.
    expect(db.rows(savings.batch.id).map((r) => r.transaction_id)).toEqual([rent]);
  });
});

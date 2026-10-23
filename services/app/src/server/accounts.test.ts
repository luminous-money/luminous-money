import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@luminous-money/csv-import";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDb } from "./db.js";

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

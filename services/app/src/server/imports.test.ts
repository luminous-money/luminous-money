import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@fava-beans/csv-import";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDb } from "./db.js";
import { fingerprints, ImportProblem, importFile, UNCATEGORIZED } from "./imports.js";
import { FakeLedger } from "./testing.js";

const ACCOUNT = "Assets:Bank:PNC-Checking";
const FILE = `Date,Description,Amount,Balance
03/01/2024,OPENING DAY COFFEE,-3.00,997.00
03/05/2024,CORNER CAFE,-4.50,992.50
03/05/2024,CORNER CAFE,-4.50,988.00
03/07/2024,ACME PAYROLL,2000.00,2988.00
03/08/2024,NOT A DATE,oops,2988.00
`;

let db: AppDb;
let ledger: FakeLedger;
const run = (text = FILE) =>
  importFile({ db, ledger, book: "b", account: ACCOUNT, filename: "march.csv", text, userId: "u" });

beforeEach(() => {
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(ACCOUNT, { money: "bank", open: "2024-03-01", currencies: ["USD"] } as never);
  db.saveProfile("b", ACCOUNT, guessProfile(FILE)!);
});

describe("importing a file", () => {
  it("stages each new row as a pending, uncategorized transaction", async () => {
    const result = await run();

    expect(result.batch).toMatchObject({
      rows: 5,
      staged: 3,
      duplicates: 0,
      skipped: 1,
      unreadable: 1,
    });
    expect(result.rows.map((r) => r.outcome)).toEqual([
      "before-opening",
      "staged",
      "staged",
      "staged",
      "unreadable",
    ]);
    const staged = ledger.transactions;
    expect(
      staged.map((t) => [
        t.flag,
        t.date,
        t.narration,
        t.postings[0]!.units?.number,
        t.postings[1]!.account,
      ])
    ).toEqual([
      ["!", "2024-03-05", "CORNER CAFE", "-4.50", UNCATEGORIZED.out],
      ["!", "2024-03-05", "CORNER CAFE", "-4.50", UNCATEGORIZED.out],
      ["!", "2024-03-07", "ACME PAYROLL", "2000.00", UNCATEGORIZED.in],
    ]);
    expect(staged[0]!.meta).toMatchObject({ source: "csv", "import-batch": result.batch.id });
    expect(ledger.created.sort()).toEqual([UNCATEGORIZED.in, UNCATEGORIZED.out].sort());
  });

  it("skips rows an earlier import already staged, even identical ones, but not new ones", async () => {
    await run();
    const again = await run(`${FILE}03/09/2024,BAKERY,-6.00,2982.00\n`);

    expect(again.batch).toMatchObject({ staged: 1, duplicates: 3 });
    expect(again.rows.at(-1)).toMatchObject({ description: "BAKERY", outcome: "staged" });
    expect(ledger.created).toHaveLength(2); // the uncategorized accounts, once
  });

  it("ranks existing transactions that might be the same event, acting on none", async () => {
    const manual = ledger.addTransaction({
      date: "2024-03-06",
      flag: "*",
      narration: "Coffee (entered by hand)",
      postings: [
        { account: ACCOUNT, units: { number: "-4.5", currency: "USD" } },
        { account: "Expenses:Food" },
      ],
    });

    const result = await run();

    const coffee = result.rows.find((r) => r.line === 3)!;
    expect(coffee.candidates).toEqual([
      expect.objectContaining({
        transaction_id: manual.id,
        days: 1,
        narration: "Coffee (entered by hand)",
      }),
    ]);
    expect(coffee.outcome).toBe("staged");
    expect(result.rows.find((r) => r.description === "ACME PAYROLL")!.candidates).toEqual([]);
  });

  it("records the batch, its rows and the account's last import", async () => {
    const result = await run();

    expect(db.batch("b", result.batch.id)).toMatchObject({ staged: 3, filename: "march.csv" });
    expect(db.rows(result.batch.id)).toEqual(result.rows);
    expect(db.lastImports("b")).toEqual({ [ACCOUNT]: result.batch.created_at });
  });
});

describe("what has to be fixed first", () => {
  it.each([
    [
      "no-such-book",
      () =>
        importFile({
          db,
          ledger,
          book: "nope",
          account: ACCOUNT,
          filename: "f",
          text: FILE,
          userId: "u",
        }),
    ],
    [
      "not-a-money-account",
      () =>
        importFile({
          db,
          ledger,
          book: "b",
          account: "Expenses:Food",
          filename: "f",
          text: FILE,
          userId: "u",
        }),
    ],
    ["wrong-layout", () => run("When,What,How much\n2024-03-01,x,1\n")],
    [
      "no-profile",
      () => {
        ledger.addAccount("Assets:Bank:Other", { money: "bank" } as never);
        return importFile({
          db,
          ledger,
          book: "b",
          account: "Assets:Bank:Other",
          filename: "f",
          text: FILE,
          userId: "u",
        });
      },
    ],
  ])("%s", async (code, attempt) => {
    await expect(attempt()).rejects.toThrow(ImportProblem);
    await expect(attempt()).rejects.toMatchObject({ code });
  });
});

it("fingerprints identical rows apart, and prefer the bank's ID", () => {
  const row = {
    line: 1,
    date: "2024-03-05",
    amount: "-4.50",
    description: "CAFE",
    payee: null,
    id: null,
    balance: null,
    error: null,
  };

  const [a, b, c, d] = fingerprints([
    row,
    { ...row, line: 2 },
    { ...row, id: "TX-9" },
    { ...row, error: "bad" },
  ]);

  expect(a).not.toBe(b);
  expect(a!.split(":")[0]).toBe(b!.split(":")[0]);
  expect(c).toBe("id:TX-9");
  expect(d).toBeNull();
});

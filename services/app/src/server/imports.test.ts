import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@fava-beans/csv-import";
import { migrate, open } from "@fava-beans/db";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDb, MIGRATIONS } from "./db.js";
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
  ledger.addAccount(ACCOUNT, { open: "2024-03-01", as_of: "2024-03-01", currencies: ["USD"] });
  db.replaceProfiles("b", ACCOUNT, [guessProfile(FILE)!]);
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

  it("skips rows up to the opening balance's date, wherever it's been moved", async () => {
    ledger.accountList[0]!.as_of = "2024-02-29"; // the opening balance, moved back a day

    const result = await run();

    expect(result.rows[0]).toMatchObject({ description: "OPENING DAY COFFEE", outcome: "staged" });
    expect(result.batch).toMatchObject({ staged: 4, skipped: 0 });
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

it("imports into any leaf, with no cutoff when it has no opening balance", async () => {
  ledger.accountList[0]!.as_of = undefined;
  ledger.accountList[0]!.type = "liability";

  const result = await run();

  expect(result.batch).toMatchObject({ staged: 4, skipped: 0 });
});

it("keeps stars per user and book", () => {
  db.star("u", "b", ACCOUNT);
  db.star("u", "b", "Liabilities:Card");
  db.star("u", "b", ACCOUNT); // again: no change
  db.star("other", "b", "Assets:Cash");
  db.unstar("u", "b", "Liabilities:Card");

  expect(db.stars("u", "b")).toEqual([ACCOUNT]);
  expect(db.stars("other", "b")).toEqual(["Assets:Cash"]);
  expect(db.stars("u", "elsewhere")).toEqual([]);
});

describe("several file formats for one account", () => {
  const OTHER = `Posted,Payee,Debit,Credit
2024-03-10,BAKERY,6.00,
2024-03-11,REFUND,,2.00
`;

  it("reads a file with whichever of the account's profiles it fits", async () => {
    db.addProfile("b", ACCOUNT, guessProfile(OTHER)!);

    const first = await run();
    const second = await run(OTHER);

    expect(first.batch.staged).toBe(3);
    expect(second.rows.map((r) => [r.description, r.amount, r.outcome])).toEqual([
      ["BAKERY", "-6.00", "staged"],
      ["REFUND", "2.00", "staged"],
    ]);
  });

  it("replacing the profiles leaves only the new ones", async () => {
    db.replaceProfiles("b", ACCOUNT, [guessProfile(OTHER)!]);

    expect(db.profiles("b", ACCOUNT)).toHaveLength(1);
    await expect(run()).rejects.toMatchObject({ code: "wrong-layout" });
    expect((await run(OTHER)).batch.staged).toBe(2);
  });

  it("keeps a profile saved before profiles became a list (migration 2)", () => {
    const path = join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite");
    const old = open(path);
    migrate(old, MIGRATIONS.slice(0, 1));
    old
      .prepare(
        "INSERT INTO csv_profile (book_id, account, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run("b", ACCOUNT, JSON.stringify(guessProfile(FILE)), "t", "t");
    old.close();

    expect(new AppDb(path).profiles("b", ACCOUNT)).toEqual([guessProfile(FILE)]);
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
      "not-importable",
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
        ledger.addAccount("Assets:Bank:Other");
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

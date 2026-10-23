import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@luminous-money/csv-import";
import { migrate, open } from "@luminous-money/db";
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
  it("stages each new row as an unconfirmed, uncategorized transaction", async () => {
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

  it("a row that's the same as a transaction in the account claims it, proposed for review", async () => {
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

    const [first, second] = result.rows.filter((r) => r.description === "CORNER CAFE");
    expect(first).toMatchObject({
      outcome: "matched",
      transaction_id: manual.id,
      match: "proposed",
    });
    expect(first!.candidates).toEqual([
      expect.objectContaining({
        transaction_id: manual.id,
        days: 1,
        narration: "Coffee (entered by hand)",
      }),
    ]);
    // The second identical coffee can't have it too: staged, with the candidate still linked.
    expect(second).toMatchObject({ outcome: "staged", match: "proposed" });
    expect(second!.candidates.map((c) => c.transaction_id)).toEqual([manual.id]);
    expect(result.rows.find((r) => r.description === "ACME PAYROLL")).toMatchObject({
      candidates: [],
      match: null,
    });
    expect(result.batch).toMatchObject({ staged: 2, matched: 1 });
    expect(ledger.transactions).toHaveLength(3); // the manual one, and two staged
    expect(manual.flag).toBe("*"); // a match changes nothing in the books
  });

  it("pairs by proximity: the coffee example (an accepted miss, fixed by swapping in review)", async () => {
    const coffee = (date: string) =>
      ledger.addTransaction({
        date,
        flag: "*",
        narration: "Coffee",
        postings: [
          { account: ACCOUNT, units: { number: "-5.00", currency: "USD" } },
          { account: "Expenses:Food" },
        ],
      });
    const fifth = coffee("2024-03-05");
    const seventh = coffee("2024-03-07");

    const result = await run(
      "Date,Description,Amount,Balance\n03/07/2024,CAFE,-5.00,1\n03/08/2024,CAFE,-5.00,1\n"
    );

    const [r7, r8] = result.rows;
    expect([r7!.transaction_id, r8!.transaction_id]).toEqual([seventh.id, fifth.id]);
    expect(r7!.candidates.map((c) => c.transaction_id)).toEqual([seventh.id, fifth.id]);
    expect(r8!.candidates.map((c) => c.transaction_id)).toEqual([seventh.id, fifth.id]);
    expect(result.batch).toMatchObject({ matched: 2, staged: 0 });
  });

  it("never matches what this account's imports hold, but does match what another account's do", async () => {
    await run(); // stages the coffees and the payroll
    const card = ledger.addTransaction({
      date: "2024-03-08",
      flag: "!",
      narration: "PAYMENT TO CARD",
      postings: [
        { account: "Assets:Bank:Checking", units: { number: "-6.00", currency: "USD" } },
        { account: ACCOUNT, units: { number: "6.00", currency: "USD" } },
      ],
    });
    ledger.accountList.push({ ...ledger.accountList[0]!, name: "Assets:Bank:Checking" });
    db.replaceProfiles("b", "Assets:Bank:Checking", [guessProfile(FILE)!]);
    await importFile({
      db,
      ledger,
      book: "b",
      account: "Assets:Bank:Checking",
      filename: "checking.csv",
      text: "Date,Description,Amount,Balance\n03/08/2024,PAYMENT TO CARD,-6.00,1\n",
      userId: "u",
    }); // checking's import holds the payment now (it matched it)

    const later = await run(
      "Date,Description,Amount,Balance\n03/06/2024,CORNER CAFE AGAIN,-4.50,1\n03/09/2024,PAYMENT THANK YOU,6.00,1\n"
    );

    expect(later.rows.map((r) => [r.description, r.outcome])).toEqual([
      ["CORNER CAFE AGAIN", "staged"], // not one of the coffees this account's import staged
      ["PAYMENT THANK YOU", "matched"],
    ]);
    expect(later.rows[1]!.transaction_id).toBe(card.id);
  });

  it("re-importing a file whose rows matched changes nothing", async () => {
    ledger.addTransaction({
      date: "2024-03-07",
      flag: "*",
      narration: "Payroll",
      postings: [
        { account: ACCOUNT, units: { number: "2000.00", currency: "USD" } },
        { account: "Income:Salary" },
      ],
    });
    await run();

    const again = await run();

    expect(again.batch).toMatchObject({ staged: 0, matched: 0, duplicates: 3 });
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

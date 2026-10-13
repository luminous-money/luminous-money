import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@fava-beans/csv-import";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDb } from "./db.js";
import { importFile } from "./imports.js";
import { assignRow, confirmRow, MatchProblem, proposedMatches } from "./matches.js";
import { FakeLedger } from "./testing.js";

const ACCOUNT = "Assets:Bank:Checking";
const HEADER = "Date,Description,Amount,Balance\n";

let db: AppDb;
let ledger: FakeLedger;
let fifth: string;
let seventh: string;

const coffee = (date: string) =>
  ledger.addTransaction({
    date,
    flag: "*",
    narration: "Coffee",
    postings: [
      { account: ACCOUNT, units: { number: "-5.00", currency: "USD" } },
      { account: "Expenses:Food" },
    ],
  }).id;

const run = (rows: string) =>
  importFile({
    db,
    ledger,
    book: "b",
    account: ACCOUNT,
    filename: "cafe.csv",
    text: HEADER + rows,
    userId: "u",
  });

/** Each proposed row's description (with its line) and the transaction it holds. */
const holding = () =>
  Object.fromEntries(proposedMatches(db, "b").map((m) => [m.line, m.transaction_id]));

beforeEach(() => {
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(ACCOUNT, { open: "2024-01-01", currencies: ["USD"] });
  db.replaceProfiles("b", ACCOUNT, [guessProfile(`${HEADER}03/07/2024,CAFE,-5.00,1\n`)!]);
  fifth = coffee("2024-03-05");
  seventh = coffee("2024-03-07");
});

describe("the coffee example", () => {
  // Entered by hand on the 5th and 7th; the CSV has them on the 7th and 8th.
  let batch: string;
  beforeEach(async () => {
    batch = (await run("03/07/2024,CAFE,-5.00,1\n03/08/2024,CAFE,-5.00,1\n")).batch.id;
  });

  it("proposes both rows, each candidate showing which row holds it", () => {
    const [r7, r8] = proposedMatches(db, "b");

    expect([r7!.transaction_id, r8!.transaction_id]).toEqual([seventh, fifth]);
    expect(r7!.candidates.map((c) => [c.transaction_id, c.holder?.line ?? null])).toEqual([
      [seventh, null], // its own
      [fifth, 3], // held by the 8th's row (line 3)
    ]);
  });

  it("swaps two rows' transactions in one operation, changing nothing in the books", async () => {
    const before = ledger.transactions.length;

    await assignRow({ db, ledger, book: "b", row: { batch, line: 2 }, to: fifth });

    expect(holding()).toEqual({ 2: fifth, 3: seventh });
    expect(ledger.transactions).toHaveLength(before);
  });

  it("not a match stages the row as its own transaction; matching again deletes it", async () => {
    await assignRow({ db, ledger, book: "b", row: { batch, line: 3 }, to: null });

    const staged = db.row("b", batch, 3)!;
    expect(staged.outcome).toBe("staged");
    const made = ledger.transactions.find((t) => t.id === staged.transaction_id)!;
    expect(made).toMatchObject({ flag: "!", date: "2024-03-08", narration: "CAFE" });
    expect(made.meta).toMatchObject({ "import-batch": batch, "import-id": staged.fingerprint });

    await assignRow({ db, ledger, book: "b", row: { batch, line: 3 }, to: fifth });

    expect(db.row("b", batch, 3)).toMatchObject({ outcome: "matched", transaction_id: fifth });
    expect(ledger.transactions.some((t) => t.id === made.id)).toBe(false);
  });

  it("confirming leaves review; a confirmed row can't be reassigned", async () => {
    await confirmRow(db, ledger, "b", { batch, line: 2 });

    expect(Object.keys(holding())).toEqual(["3"]);
    await expect(
      assignRow({ db, ledger, book: "b", row: { batch, line: 2 }, to: fifth })
    ).rejects.toMatchObject({ code: "not-proposed" });
  });

  it("refuses a transaction that isn't one of the row's candidates", async () => {
    await expect(
      assignRow({ db, ledger, book: "b", row: { batch, line: 2 }, to: "nope" })
    ).rejects.toThrow(MatchProblem);
  });
});

it("a staged row swapping with a matched one: the other becomes new", async () => {
  // Three coffees in the CSV, two entered by hand: the third row is staged.
  const { batch } = await run(
    "03/05/2024,CAFE,-5.00,1\n03/07/2024,CAFE,-5.00,1\n03/09/2024,CAFE,-5.00,1\n"
  );
  const third = db.row("b", batch.id, 4)!;
  expect(third.outcome).toBe("staged");

  await assignRow({ db, ledger, book: "b", row: { batch: batch.id, line: 4 }, to: seventh });

  expect(db.row("b", batch.id, 4)).toMatchObject({ outcome: "matched", transaction_id: seventh });
  const second = db.row("b", batch.id, 3)!;
  expect(second.outcome).toBe("staged");
  expect(ledger.transactions.find((t) => t.id === second.transaction_id)).toMatchObject({
    date: "2024-03-07",
    flag: "!",
  });
  expect(ledger.transactions.some((t) => t.id === third.transaction_id)).toBe(false);
});

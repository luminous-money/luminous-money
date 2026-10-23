import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Row } from "@luminous-money/csv-import";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDb } from "./db.js";
import { importRows } from "./imports.js";
import { FakeLedger } from "./testing.js";
import { pairedTransfers, pairTransfers, rejectTransfer } from "./transfers.js";

const FIDELITY = "Assets:Fidelity:Cash";
const PNC = "Assets:Bank:PNC-Checking";
const CARD = "Liabilities:Chase:Card";

let db: AppDb;
let ledger: FakeLedger;

const row = (line: number, date: string, amount: string, description: string): Row => ({
  line,
  date,
  amount,
  description,
  payee: null,
  id: null,
  balance: null,
  error: null,
});

const bring = (account: string, rows: Row[]) =>
  importRows({
    db,
    ledger,
    book: "b",
    account,
    userId: "u",
    source: "simplefin",
    label: "bank",
    rows,
  });
const pair = () => pairTransfers({ db, ledger, book: "b" });

beforeEach(() => {
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addBook("b");
  for (const account of [FIDELITY, PNC]) ledger.addAccount(account, { currencies: ["USD"] });
  ledger.addAccount(CARD, { type: "liability", currencies: ["USD"] });
  ledger.addAccount("Expenses:Uncategorized", { type: "expense" });
  ledger.addAccount("Income:Uncategorized", { type: "income" });
});

describe("pairing transfers", () => {
  it("makes money out of one account and the same into another, days apart, one transfer", async () => {
    await bring(FIDELITY, [row(1, "2026-10-10", "-14000.00", "TRANSFER TO PNC")]);
    await bring(PNC, [
      row(1, "2026-10-12", "14000.00", "TRANSFER FROM FIDELITY"),
      row(2, "2026-10-12", "-14000.00", "ROOFER"), // the same amount, but out of the same side
    ]);

    const replaced = await pair();

    expect(replaced.size).toBe(2);
    const unconfirmed = await ledger.unconfirmed();
    const transfer = unconfirmed.find((t) => t.narration.startsWith("Transfer"))!;
    expect(transfer).toMatchObject({
      date: "2026-10-10",
      flag: "!",
      postings: [
        { account: FIDELITY, units: { number: "-14000.00", currency: "USD" } },
        { account: PNC, units: { number: "14000.00", currency: "USD" } },
      ],
    });
    expect(unconfirmed.map((t) => t.narration).sort()).toEqual(["ROOFER", transfer.narration]);
    // The rows that held the two now hold it, so the bank's rows still count as imported.
    expect(
      db
        .holders("b", [transfer.id])
        .map((r) => r.account)
        .sort()
    ).toEqual([PNC, FIDELITY].sort());
    expect(pairedTransfers(db, "b")[0]!.originals.map((o) => o.description)).toEqual([
      "TRANSFER TO PNC",
      "TRANSFER FROM FIDELITY",
    ]);
  });

  it("pairs a card payment, but not what's too far apart, categorized, or in one account", async () => {
    await bring(PNC, [
      row(1, "2026-10-01", "-500.00", "CHASE PAYMENT"),
      row(2, "2026-10-01", "-80.00", "TO SAVINGS"),
      row(3, "2026-10-01", "80.00", "BACK FROM SAVINGS"),
    ]);
    await bring(CARD, [row(1, "2026-10-03", "500.00", "PAYMENT THANK YOU")]);
    await bring(FIDELITY, [row(1, "2026-10-20", "80.00", "LATE")]); // 19 days after
    const categorized = (await ledger.unconfirmed()).find((t) => t.narration === "TO SAVINGS")!;
    categorized.postings[1]!.account = "Expenses:Fun";

    const replaced = await pair();

    expect(replaced.size).toBe(2);
    const narrations = (await ledger.unconfirmed()).map((t) => t.narration).sort();
    expect(narrations).toEqual([
      "BACK FROM SAVINGS",
      "LATE",
      "TO SAVINGS",
      "Transfer from Bank:PNC-Checking to Chase:Card",
    ]);
  });

  it("restores the two on reject, and doesn't pair them again", async () => {
    await bring(FIDELITY, [row(1, "2026-10-10", "-14000.00", "TRANSFER TO PNC")]);
    await bring(PNC, [row(1, "2026-10-11", "14000.00", "TRANSFER FROM FIDELITY")]);
    await pair();
    const transfer = (await ledger.unconfirmed())[0]!;

    const restored = await rejectTransfer({ db, ledger, book: "b", transactionId: transfer.id });

    const back = await ledger.unconfirmed();
    expect(back.map((t) => t.narration).sort()).toEqual([
      "TRANSFER FROM FIDELITY",
      "TRANSFER TO PNC",
    ]);
    expect(back.map((t) => t.meta?.["import-batch"]).every(Boolean)).toBe(true); // as they were
    expect(db.holders("b", restored).length).toBe(2);
    expect(db.holders("b", [transfer.id])).toEqual([]);
    expect((await pair()).size).toBe(0);
    expect(pairedTransfers(db, "b")).toEqual([]);
  });

  it("forgets a pair once its transfer is confirmed, and won't reject it then", async () => {
    await bring(FIDELITY, [row(1, "2026-10-10", "-100.00", "OUT")]);
    await bring(PNC, [row(1, "2026-10-10", "100.00", "IN")]);
    await pair();
    const transfer = (await ledger.unconfirmed())[0]!;
    transfer.flag = "*";

    await expect(
      rejectTransfer({ db, ledger, book: "b", transactionId: transfer.id })
    ).rejects.toThrow(/confirmed/);
    await pair();
    expect(pairedTransfers(db, "b")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import type { AiSettings, ReceiptReading } from "@fava-beans/ai-api";

import type { AiPort } from "./ai.js";
import { captureReceipt, ReceiptProblem, receiptTransaction } from "./receipts.js";
import { FakeLedger } from "./testing.js";

const CARD = "Liabilities:Amazon-Visa-9499";
const PHOTO = { name: "jewel.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 1, 2]) };

function setUp() {
  const ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(CARD, { type: "liability", currencies: ["USD"] });
  ledger.addAccount("Assets:Bank:Checking", { currencies: ["USD"] });
  ledger.addAccount("Expenses:Groceries", { type: "expense" });
  ledger.addAccount("Expenses:Household", { type: "expense" });
  return ledger;
}

const reading = (r: Partial<ReceiptReading> = {}): ReceiptReading => ({
  account: CARD,
  total: "-30.00",
  currency: "USD",
  date: "2026-10-17",
  payee: "Jewel",
  narration: "Groceries and soap",
  category: "Expenses:Groceries",
  splits: [
    { account: "Expenses:Groceries", amount: "24.00", memo: "Food" },
    { account: "Expenses:Household", amount: "6.00", memo: "Soap" },
  ],
  new_accounts: [],
  note: null,
  ...r,
});

const ai = (read: AiPort["read"], settings: Partial<AiSettings> = {}): AiPort => ({
  settings: async () => ({ ready: true, create_accounts: false, ...settings }) as AiSettings,
  read,
  forgetBook: async () => undefined,
});

describe("capturing a receipt", () => {
  it("stages what the AI read, itemized, unconfirmed, with the receipt attached", async () => {
    const ledger = setUp();

    const captured = await captureReceipt({
      ledger,
      ai: ai(async () => ({ reading: reading() })),
      book: "b",
      file: PHOTO,
      hints: { account: "Assets:Bank:Checking" }, // a hint: the receipt said the Visa
      today: "2026-10-18",
    });

    const t = await ledger.transaction("b", captured.transaction_id);
    expect([t.flag, t.payee, t.meta?.source]).toEqual(["!", "Jewel", "receipt"]);
    expect(t.postings.map((p) => [p.account, p.units?.number])).toEqual([
      [CARD, "-30.00"],
      ["Expenses:Groceries", "24.00"],
      ["Expenses:Household", "6.00"],
    ]);
    expect(ledger.attachments).toEqual([
      { transaction: captured.transaction_id, name: "jewel.jpg", type: "image/jpeg", size: 4 },
    ]);
  });

  it("still makes something when it can't be read", async () => {
    const ledger = setUp();

    const captured = await captureReceipt({
      ledger,
      ai: ai(async () => ({ failed: "Claude declined to read it" })),
      book: "b",
      file: PHOTO,
      hints: { total: "-8.50", payee: "Cafe" },
      today: "2026-10-18",
    });

    expect(captured).toMatchObject({
      read: false,
      note: "It couldn't be read: Claude declined to read it",
    });
    const t = await ledger.transaction("b", captured.transaction_id);
    // No base account known: uncategorized, as the notes ask.
    expect(t.postings.map((p) => [p.account, p.units?.number])).toEqual([
      ["Expenses:Uncategorized", "-8.50"],
      ["Expenses:Uncategorized", "8.50"],
    ]);
    expect(ledger.attachments).toHaveLength(1);
  });

  it("refuses what isn't a receipt", async () => {
    await expect(
      captureReceipt({
        ledger: setUp(),
        book: "b",
        file: { name: "notes.txt", type: "text/plain", bytes: new Uint8Array([1]) },
        hints: {},
        today: "2026-10-18",
      })
    ).rejects.toThrow(ReceiptProblem);
  });
});

describe("checking a reading against the books", () => {
  const accounts = () => setUp().accountList;
  const settings = { createAccounts: false, today: "2026-10-18", currency: "USD" };

  it("falls back to the category when the splits don't add up", () => {
    const { transaction } = receiptTransaction(
      reading({ splits: [{ account: "Expenses:Groceries", amount: "20.00", memo: null }] }),
      {},
      accounts(),
      settings
    );
    expect(transaction.postings.map((p) => [p.account, p.units?.number])).toEqual([
      [CARD, "-30.00"],
      ["Expenses:Groceries", "30.00"],
    ]);
  });

  it("opens the accounts it proposed only when the book lets it", () => {
    const proposed = reading({
      new_accounts: ["Expenses:Groceries:Produce"],
      splits: [{ account: "Expenses:Groceries:Produce", amount: "30.00", memo: null }],
    });
    expect(receiptTransaction(proposed, {}, accounts(), settings).open).toEqual([]);
    const allowed = receiptTransaction(proposed, {}, accounts(), {
      ...settings,
      createAccounts: true,
    });
    expect(allowed.open).toEqual(["Expenses:Groceries:Produce"]);
  });
});

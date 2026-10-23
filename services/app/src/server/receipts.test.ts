import { describe, expect, it } from "vitest";

import type { AiSettings, CategorizeIn, CategorizeOut, ReceiptFacts } from "@luminous-money/ai-api";

import type { AiPort, Answer } from "./ai.js";
import type { Categorizer } from "./categorize/types.js";
import { captureReceipt, paidWith, ReceiptProblem, receiptTransaction } from "./receipts.js";
import { FakeLedger } from "./testing.js";

const CARD = "Liabilities:Fidelity-Visa";
const PHOTO = { name: "jewel.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 1, 2]) };

function setUp() {
  const ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(CARD, {
    type: "liability",
    currencies: ["USD"],
    // One account, two cards (two people's).
    cards: [
      { brand: "visa", last_four: "9499" },
      { brand: "visa", last_four: "0417" },
    ],
  });
  ledger.addAccount("Assets:Bank:Checking", { currencies: ["USD"] });
  ledger.addAccount("Expenses:Groceries", { type: "expense" });
  ledger.addAccount("Expenses:Household", { type: "expense" });
  return ledger;
}

const facts = (f: Partial<ReceiptFacts> = {}): ReceiptFacts => ({
  payee: "Jewel-Osco",
  date: "2026-01-24",
  currency: null,
  total: "23.50",
  total_evidence: "TOTAL 23.50",
  refund: false,
  payment: { method: "card", brand: "visa", last_four: "0417" },
  lines: [
    { text: "EGGS HPPY 18", description: "Happy Egg Co. eggs, 18 count", amount: "9.99" },
    { text: "MILK FRD ORG GAL", description: null, amount: "9.99" },
    { text: "TAX", description: null, amount: "3.52" },
  ],
  difference: null,
  note: null,
  ...f,
});

/** The ai service, answering as told, and remembering what it was asked to categorize. */
function ai(
  extract: () => Answer<ReceiptFacts>,
  categorize: (input: CategorizeIn) => CategorizeOut = () => ({ proposals: [], new_accounts: [] }),
  settings: Partial<AiSettings> = {}
) {
  const asked: CategorizeIn[] = [];
  const port: AiPort = {
    settings: async () => ({ ready: true, create_accounts: false, ...settings }) as AiSettings,
    extract: async () => extract(),
    categorize: async (_book, input) => (asked.push(input), { ok: categorize(input) }),
    forgetBook: async () => undefined,
  };
  return { port, asked };
}

const accountsOf = (postings: { account: string; units?: { number: string } | null }[]) =>
  postings.map((p) => [p.account, p.units?.number]);

describe("capturing a receipt", () => {
  it("stages what was read, itemized, paid with the card it names, its splits placed and flagged", async () => {
    const ledger = setUp();
    const { port, asked } = ai(
      () => ({ ok: facts() }),
      (input) => ({
        proposals: [
          {
            id: input.transactions[0]!.id,
            splits: [
              { index: 1, account: "Expenses:Groceries" },
              { index: 2, account: "Expenses:Groceries" },
            ],
            fallback: "Expenses:Groceries",
            confidence: 0.8,
            reason: "Jewel-Osco is a grocery store",
          },
        ],
        new_accounts: [],
      })
    );

    const captured = await captureReceipt({
      ledger,
      ai: port,
      book: "b",
      file: PHOTO,
      // A hint, but the card on the receipt says which account paid.
      hints: { account: "Assets:Bank:Checking", itemize: true },
      today: "2026-10-18",
    });

    const t = await ledger.transaction("b", captured.transaction_id);
    expect([t.flag, t.payee, t.date, t.meta?.source]).toEqual([
      "!",
      "Jewel-Osco",
      "2026-01-24",
      "receipt",
    ]);
    expect(t.postings.map((p) => [p.account, p.units?.number, p.flag ?? null])).toEqual([
      [CARD, "-23.50", null],
      ["Expenses:Groceries", "9.99", "!"],
      ["Expenses:Groceries", "9.99", "!"],
      ["Expenses:Groceries", "3.52", "!"], // the tax, by the fallback
    ]);
    expect(t.postings[1]!.meta).toEqual({ memo: "EGGS HPPY 18" });
    // The AI was asked about its splits, the lines in plain words where it could.
    expect(asked[0]!.transactions[0]!.splits.map((s) => s.memo)).toEqual([
      "EGGS HPPY 18: Happy Egg Co. eggs, 18 count",
      "MILK FRD ORG GAL",
      "TAX",
    ]);
    expect(ledger.attachments).toEqual([
      { transaction: captured.transaction_id, name: "jewel.jpg", type: "image/jpeg", size: 4 },
    ]);
  });

  it("not itemized, it's one split, which the rules may settle without the AI", async () => {
    const ledger = setUp();
    const { port, asked } = ai(() => ({ ok: facts() }));
    const jewel: Categorizer = {
      name: "rules",
      categorize: async (r) => ({
        proposals: r.transactions.map((t) => ({
          id: t.id,
          postings: [{ account: "Expenses:Groceries" }],
          confidence: 1,
          reason: 'Rule "Jewel"',
          auto_confirm: true,
        })),
      }),
    };

    const captured = await captureReceipt({
      ledger,
      ai: port,
      categorizers: [jewel],
      book: "b",
      file: PHOTO,
      hints: { itemize: false },
      today: "2026-10-18",
    });

    const t = await ledger.transaction("b", captured.transaction_id);
    expect(accountsOf(t.postings)).toEqual([
      [CARD, "-23.50"],
      ["Expenses:Groceries", "23.50"],
    ]);
    expect(t.flag).toBe("!"); // a receipt never confirms itself
    expect(asked).toHaveLength(0);
  });

  it("still makes something when it can't be read, waiting for the account it was paid from", async () => {
    const ledger = setUp();
    const { port } = ai(() => ({ failed: "Claude declined" }));

    const captured = await captureReceipt({
      ledger,
      ai: port,
      book: "b",
      file: PHOTO,
      hints: { total: "-8.50", payee: "Cafe" },
      today: "2026-10-18",
    });

    expect(captured).toMatchObject({ read: false, note: "It couldn't be read: Claude declined." });
    const t = await ledger.transaction("b", captured.transaction_id);
    expect(accountsOf(t.postings)).toEqual([
      ["Assets:Unknown", "-8.50"],
      ["Expenses:Uncategorized", "8.50"],
    ]);
    expect(ledger.created).toEqual(expect.arrayContaining(["Assets:Unknown"]));
    expect(ledger.attachments).toHaveLength(1);
  });

  it("opens the accounts the AI proposed only when the book lets it", async () => {
    const produce = "Expenses:Food:Produce"; // (not under a leaf: Groceries is one)
    const answer = (input: CategorizeIn): CategorizeOut => ({
      proposals: [
        {
          id: input.transactions[0]!.id,
          splits: [{ index: 1, account: produce }],
          fallback: null,
          confidence: 0.7,
          reason: "",
        },
      ],
      new_accounts: [produce],
    });
    for (const create_accounts of [false, true]) {
      const ledger = setUp();
      const { port } = ai(() => ({ ok: facts() }), answer, { create_accounts });
      const captured = await captureReceipt({
        ledger,
        ai: port,
        book: "b",
        file: PHOTO,
        hints: { itemize: true },
        today: "2026-10-18",
      });
      const t = await ledger.transaction("b", captured.transaction_id);
      expect([t.postings[1]!.account, ledger.created.includes(produce)]).toEqual(
        create_accounts ? [produce, true] : ["Expenses:Uncategorized", false]
      );
    }
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

describe("building a receipt's transaction", () => {
  const accounts = () => setUp().accountList;
  const options = { itemize: true, today: "2026-10-18", currency: "USD" };

  it("takes the total typed over the receipt's, and leaves a split for what the lines don't cover", () => {
    const { transaction, notes } = receiptTransaction(
      facts(),
      { total: "-25.00" },
      accounts(),
      options
    );
    expect(accountsOf(transaction.postings)).toEqual([
      [CARD, "-25.00"],
      ["Expenses:Uncategorized", "9.99"],
      ["Expenses:Uncategorized", "9.99"],
      ["Expenses:Uncategorized", "3.52"],
      ["Expenses:Uncategorized", "1.50"],
    ]);
    expect(notes).toEqual([
      "The receipt says 23.50; the total you gave was used.",
      "The lines don't add up to the total: 1.50 is left over.",
    ]);
  });

  it("signs a refund as money back", () => {
    const { transaction } = receiptTransaction(
      facts({
        refund: true,
        lines: [{ text: "RETURN SOAP", description: null, amount: "23.50" }],
      }),
      {},
      accounts(),
      options
    );
    expect(accountsOf(transaction.postings)).toEqual([
      [CARD, "23.50"],
      ["Income:Uncategorized", "-23.50"],
    ]);
  });

  it("knows a card by its last four, and its brand when both say one", () => {
    const all = accounts();
    expect(paidWith(all, { method: "card", brand: null, last_four: "9499" })).toBe(CARD);
    expect(paidWith(all, { method: "card", brand: "amex", last_four: "9499" })).toBeNull();
    expect(paidWith(all, { method: "card", brand: "visa", last_four: "1111" })).toBeNull();
  });
});

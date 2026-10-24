import { describe, expect, it } from "vitest";

import type { AiSettings, CategorizeIn, CategorizeOut, ReceiptFacts } from "@luminous-money/ai-api";

import type { AiPort, Answer } from "./ai.js";
import type { Categorizer } from "./categorize/types.js";
import {
  captureReceipt,
  paidWith,
  readReceipt,
  ReceiptProblem,
  receiptTransaction,
} from "./receipts.js";
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

  it("says so when the AI read it but couldn't categorize it", async () => {
    const ledger = setUp();
    const { port } = ai(() => ({ ok: facts() }));
    port.categorize = async () => ({ failed: "the Anthropic account has no credit left" });

    const captured = await captureReceipt({
      ledger,
      ai: port,
      book: "b",
      file: PHOTO,
      hints: { itemize: false },
      today: "2026-10-18",
    });

    expect(captured.note).toContain(
      "The AI couldn't categorize it: the Anthropic account has no credit left."
    );
    const t = await ledger.transaction("b", captured.transaction_id);
    expect(t.postings[1]!.account).toBe("Expenses:Uncategorized"); // still made, for review
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

/** A card purchase already here, as an import stages it (or as it was confirmed). */
function bankCopy(
  ledger: FakeLedger,
  { date = "2026-01-22", amount = "-23.50", flag = "!", other = "Expenses:Uncategorized" } = {}
) {
  return ledger.addTransaction({
    date,
    flag,
    payee: "JEWEL OSCO 3456",
    narration: "",
    meta: { source: "csv" },
    postings: [
      { account: CARD, units: { number: amount, currency: "USD" }, meta: { reconciled: "s1" } },
      { account: other, flag: flag === "!" ? "!" : null },
    ],
  } as never);
}

const groceries = (input: CategorizeIn): CategorizeOut => ({
  proposals: [
    {
      id: input.transactions[0]!.id,
      splits: [],
      fallback: "Expenses:Groceries",
      confidence: 0.8,
      reason: "a grocery store",
    },
  ],
  new_accounts: [],
});

describe("a receipt for a transaction already here", () => {
  it("is read into the bank's copy, within five days, keeping its paying side", async () => {
    const ledger = setUp();
    const bank = bankCopy(ledger);
    bankCopy(ledger, { date: "2026-01-12" }); // too long before
    const { port } = ai(() => ({ ok: facts() }), groceries);

    const captured = await captureReceipt({
      ledger,
      ai: port,
      book: "b",
      file: PHOTO,
      hints: { itemize: true },
      today: "2026-10-18",
    });

    expect(captured).toMatchObject({ transaction_id: bank.id, matched: true, read: true });
    expect(ledger.transactions).toHaveLength(2); // nothing new
    const t = await ledger.transaction("b", bank.id);
    expect([t.flag, t.date, t.payee, t.meta?.["receipt-read"]]).toEqual([
      "!",
      "2026-01-22", // the bank's date
      "JEWEL OSCO 3456", // and its payee
      "2026-10-18",
    ]);
    expect(t.postings[0]!.meta).toEqual({ reconciled: "s1" });
    expect(accountsOf(t.postings)).toEqual([
      [CARD, "-23.50"],
      ["Expenses:Groceries", "9.99"],
      ["Expenses:Groceries", "9.99"],
      ["Expenses:Groceries", "3.52"],
    ]);
    expect(t.meta?.["receipt-note"]).toBe(
      "It was read into the transaction already here from 2026-01-22."
    );
    expect(ledger.attachments.map((a) => a.transaction)).toEqual([bank.id]);
  });

  it("sends a confirmed one back to review, keeping its category if it isn't itemized", async () => {
    const ledger = setUp();
    const bank = bankCopy(ledger, { flag: "*", other: "Expenses:Household" });
    const { port, asked } = ai(() => ({ ok: facts() }), groceries);

    await captureReceipt({
      ledger,
      ai: port,
      book: "b",
      file: PHOTO,
      hints: { itemize: false },
      today: "2026-10-18",
    });

    const t = await ledger.transaction("b", bank.id);
    expect(t.flag).toBe("!");
    expect(accountsOf(t.postings)).toEqual([
      [CARD, "-23.50"],
      ["Expenses:Household", undefined],
    ]);
    expect(asked).toEqual([]); // nothing to categorize
    expect(t.meta?.["receipt-note"]).toContain("which is back in review");
  });

  it("makes a new one when it isn't clear which is the bank's copy", async () => {
    const cases: ((ledger: FakeLedger) => void)[] = [
      // Two as close.
      (l) => (bankCopy(l, { date: "2026-01-23" }), bankCopy(l, { date: "2026-01-25" })),
      // Another amount.
      (l) => void bankCopy(l, { amount: "-23.51" }),
      // A transfer, not a purchase.
      (l) => void bankCopy(l, { other: "Assets:Bank:Checking" }),
      // One a receipt was read into already.
      (l) => void (bankCopy(l).meta!["receipt-read"] = "2026-10-01"),
    ];
    for (const arrange of cases) {
      const ledger = setUp();
      arrange(ledger);
      const before = ledger.transactions.length;
      const captured = await captureReceipt({
        ledger,
        ai: ai(() => ({ ok: facts() })).port,
        book: "b",
        file: PHOTO,
        hints: {},
        today: "2026-10-18",
      });
      expect(captured.matched).toBe(false);
      expect(ledger.transactions).toHaveLength(before + 1);
    }
  });
});

describe("reading a receipt into a transaction", () => {
  it("keeps its amount as the total, its splits the lines and what they don't cover", async () => {
    const ledger = setUp();
    // Paid with a tip the receipt doesn't show, and confirmed.
    const t0 = bankCopy(ledger, { amount: "-27.00", flag: "*", other: "Expenses:Groceries" });
    const { port } = ai(() => ({ ok: facts() }), groceries, { itemize: true });

    const captured = await readReceipt({
      ledger,
      ai: port,
      book: "b",
      transaction: t0.id,
      file: PHOTO,
      today: "2026-10-18",
    });

    expect(captured).toMatchObject({ transaction_id: t0.id, matched: true });
    const t = await ledger.transaction("b", t0.id);
    expect(t.flag).toBe("!");
    expect(accountsOf(t.postings)).toEqual([
      [CARD, "-27.00"],
      ["Expenses:Groceries", "9.99"],
      ["Expenses:Groceries", "9.99"],
      ["Expenses:Groceries", "3.52"],
      ["Expenses:Groceries", "3.50"],
    ]);
    expect(t.meta?.["receipt-note"]).toBe(
      "The receipt says 23.50; the transaction's amount was kept. The lines don't add up to the total: 3.50 is left over."
    );
    expect(ledger.attachments.map((a) => a.transaction)).toEqual([t0.id]);
  });

  it("reads one it holds already without attaching it again", async () => {
    const ledger = setUp();
    const t0 = bankCopy(ledger);
    const held = await ledger.attach("b", t0.id, PHOTO);
    await readReceipt({
      ledger,
      ai: ai(() => ({ ok: facts() }), groceries).port,
      book: "b",
      transaction: t0.id,
      itemize: true,
      file: await ledger.attachmentFile("b", held.id),
      attached: true,
      today: "2026-10-18",
    });
    expect(ledger.attachments).toHaveLength(1);
    expect((await ledger.transaction("b", t0.id)).postings).toHaveLength(4);
  });

  it("refuses a transaction no account paid", async () => {
    const ledger = setUp();
    const t0 = ledger.addTransaction({
      date: "2026-01-22",
      flag: "*",
      narration: "Moved",
      postings: [
        { account: "Expenses:Groceries", units: { number: "5", currency: "USD" } },
        { account: "Expenses:Household" },
      ],
    } as never);
    await expect(
      readReceipt({ ledger, book: "b", transaction: t0.id, file: PHOTO, today: "2026-10-18" })
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

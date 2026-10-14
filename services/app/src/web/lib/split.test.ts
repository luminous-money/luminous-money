import type { Posting, Transaction } from "@fava-beans/ledger-client";
import { describe, expect, it } from "vitest";

import { checkBalance, simple, toInput, withCounterpart, withOtherSide } from "./split.js";

const usd = (number: string) => ({ number, currency: "USD" });
const posting = (account: string, units?: string, rest: Partial<Posting> = {}): Posting => ({
  account,
  units: units === undefined ? null : usd(units),
  ...rest,
});

const card: Transaction = {
  id: "t1",
  created_at: "2026-09-18T00:00:00.000000Z",
  updated_at: "2026-09-18T00:00:00.000000Z",
  date: "2026-09-18",
  flag: "!",
  payee: "Kin Soy",
  narration: "Eating out",
  tags: [],
  links: [],
  meta: { source: "demo-import" },
  postings: [posting("Liabilities:US:Chase:Slate", "-14.93"), posting("Expenses:Uncategorized")],
};

describe("the happy path", () => {
  it("anchors on the bank or card side, wherever it is", () => {
    const flipped = { ...card, postings: [...card.postings].reverse() };

    expect(simple(card)).toMatchObject({ counterpartIndex: 1, amount: "-14.93", currency: "USD" });
    expect(simple(flipped)).toMatchObject({ counterpartIndex: 0, amount: "-14.93" });
  });

  it("derives the amount when the anchor's is the elided one", () => {
    const t = {
      ...card,
      postings: [posting("Assets:Bank", undefined), posting("Expenses:Food", "4.50")],
    };

    expect(simple(t)?.amount).toBe("-4.50");
  });

  it("anchors on the first side when both or neither are balance-sheet accounts", () => {
    const transfer = {
      ...card,
      postings: [posting("Assets:Savings", "100"), posting("Assets:Checking", "-100")],
    };

    expect(simple(transfer)?.anchor.account).toBe("Assets:Savings");
  });

  it("isn't the happy path with more postings, lots or prices", () => {
    const split = { ...card, postings: [...card.postings, posting("Expenses:Tips", "2")] };
    const lot = {
      ...card,
      postings: [
        posting("Assets:Brokerage", "1", { cost: { number: "200", currency: "USD" } }),
        posting("Assets:Cash"),
      ],
    };

    expect(simple(split)).toBeNull();
    expect(simple(lot)).toBeNull();
  });

  it("recategorizes only the counterpart, keeping amounts and everything else", () => {
    const moved = withCounterpart(toInput(card), "Expenses:Food:Restaurant");

    expect(moved.postings.map((p) => p.account)).toEqual([
      "Liabilities:US:Chase:Slate",
      "Expenses:Food:Restaurant",
    ]);
    expect(moved.postings[0]?.units).toEqual(usd("-14.93"));
    expect(moved.meta).toEqual(card.meta);
    expect("id" in moved).toBe(false);
    expect("updated_at" in moved).toBe(false);
  });
});

describe("balance checks while editing", () => {
  it("accepts one blank amount and shows what it will be", () => {
    expect(
      checkBalance([
        posting("Assets:Bank", "-30"),
        posting("Expenses:Food", "12.50"),
        posting("Expenses:Home"),
      ])
    ).toEqual({
      state: "balanced",
      auto: [usd("17.50")],
    });
  });

  it("accepts fully specified postings that sum to zero, per currency", () => {
    expect(
      checkBalance([posting("Assets:Bank", "-30"), posting("Expenses:Food", "30.00")])
    ).toEqual({
      state: "balanced",
      auto: [],
    });
  });

  it("reports how far off unbalanced postings are", () => {
    expect(checkBalance([posting("Assets:Bank", "-30"), posting("Expenses:Food", "29")])).toEqual({
      state: "invalid",
      message: "Off by -1 USD",
    });
  });

  it("rejects two blanks and missing accounts", () => {
    expect(
      checkBalance([posting("Assets:Bank", "-30"), posting("A:B"), posting("C:D")]).state
    ).toBe("invalid");
    expect(checkBalance([posting("", "1"), posting("Assets:Bank")]).state).toBe("invalid");
  });

  it("leaves lots and prices to the ledger", () => {
    const lot = posting("Assets:Brokerage", "1", { cost: { number: "200", currency: "USD" } });

    expect(checkBalance([lot, posting("Assets:Cash", "-200")])).toEqual({ state: "deferred" });
  });
});

it("sets the other side relative to the account being viewed", () => {
  const transfer = {
    date: "2024-03-01",
    flag: "!",
    narration: "",
    tags: [],
    links: [],
    meta: {},
    postings: [
      { account: "Assets:Bank:Checking", units: { number: "-500", currency: "USD" } },
      { account: "Liabilities:Card", units: null },
    ],
  };

  expect(
    withOtherSide(transfer, "Liabilities:Card", "Assets:Bank:Savings")!.postings[0]!.account
  ).toBe("Assets:Bank:Savings");
  expect(withOtherSide(transfer, "Assets:Bank", "Expenses:Fees")!.postings[1]!.account).toBe(
    "Expenses:Fees"
  );
  expect(withOtherSide(transfer, "Expenses:Food", "Expenses:Fees")).toBeNull();
});

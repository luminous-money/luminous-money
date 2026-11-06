import type { Account } from "@luminous-money/ledger-client";
import { describe, expect, it } from "vitest";

import {
  defaultAccounts,
  defaultPaying,
  emptyDraft,
  historyOf,
  loanName,
  nextPayment,
  requestOf,
  stepProblem,
  stepsOf,
  tableOf,
  type Context,
  type LoanDraft,
} from "./loan-setup.js";

const account = (name: string, extra: Partial<Account> = {}) =>
  ({ name, kind: "leaf", implicit: false, close: null, ...extra }) as Account;
const node = (name: string) => account(name, { kind: "node" });

const CHECKING = "Assets:Bank:Checking";
const chart = [
  node("Assets"),
  node("Assets:Bank"),
  account(CHECKING, { updated_at: "v1" }),
  account("Assets:Bank:Savings"),
  node("Liabilities"),
  node("Expenses"),
  node("Equity"),
  node("Income"),
];

// A made-up home: $300,000 at 6.5% for 30 years, first payment 2024-09-01.
const home = (over: Partial<LoanDraft> = {}): LoanDraft => ({
  ...emptyDraft(),
  kind: "home",
  purpose: "123 Main St",
  amount: "300,000",
  rate: "6.5",
  first: "2024-09-01",
  ...over,
});

const TODAY = "2026-11-06";
const ctx = (over: Partial<Context> = {}): Context => ({
  chart,
  today: TODAY,
  currency: "USD",
  paying: CHECKING,
  owesAlready: false,
  ...over,
});

describe("names", () => {
  it("names a loan's accounts from what it's for, by kind", () => {
    expect(defaultAccounts("home", "123 Main St")).toMatchObject({
      liability: "Liabilities:Loans:Mortgages:123-Main-St",
      interest: "Expenses:Financing:Interest:123-Main-St",
      asset: "Assets:Property:123-Main-St",
      escrow: "Assets:Escrow:123-Main-St",
      pmi: "Expenses:Insurance:PMI:123-Main-St",
    });
    expect(defaultAccounts("car", "2023 Chevy Spark")).toMatchObject({
      liability: "Liabilities:Loans:Auto:2023-Chevy-Spark",
      asset: "Assets:Vehicles:2023-Chevy-Spark",
    });
    expect(defaultAccounts("other", "Tuition").asset).toBe("");
    expect(loanName(home())).toBe("123 Main St mortgage");
    expect(loanName(home({ kind: "car", purpose: "2023 Chevy Spark" }))).toBe(
      "2023 Chevy Spark loan"
    );
  });

  it("pays from a starred bank-linked account, then a linked one, then one under Assets:Bank", () => {
    const linked = new Set(["Assets:Bank:Savings", CHECKING]);
    expect(defaultPaying(chart, ["Assets:Bank:Savings"], linked)).toBe("Assets:Bank:Savings");
    expect(defaultPaying(chart, [], linked)).toBe(CHECKING);
    expect(defaultPaying(chart, ["Assets:Bank:Savings"], new Set())).toBe("Assets:Bank:Savings");
    expect(defaultPaying(chart, [], new Set())).toBe(CHECKING);
    expect(defaultPaying([node("Assets")], [], new Set())).toBe("");
  });
});

describe("the steps", () => {
  it("asks about history only when a payment's already due", () => {
    expect(stepsOf(home(), TODAY)).toContain("history");
    expect(stepsOf(home({ first: "2027-01-01" }), TODAY)).not.toContain("history");
    expect(stepsOf(emptyDraft(), TODAY)).toContain("history");
  });

  it("each step says what it still needs", () => {
    expect(stepProblem("for", { ...home(), kind: null }, ctx())).toMatch(/kind/);
    expect(stepProblem("for", home({ purpose: " " }), ctx())).toMatch(/for/);
    expect(stepProblem("terms", home({ rate: "" }), ctx())).toMatch(/Fill in/);
    expect(stepProblem("terms", home({ borrowed: "2024-10-01" }), ctx())).toMatch(/on or before/);
    expect(stepProblem("terms", home({ price: "lots" }), ctx())).toMatch(/cost/);
    expect(stepProblem("terms", home(), ctx())).toBeNull();
    expect(
      stepProblem(
        "extras",
        home({ escrow: { amount: "450", held: "", heldOn: "", tax: null, insurance: null } }),
        ctx()
      )
    ).toBeNull();
    expect(
      stepProblem(
        "extras",
        home({
          others: [{ name: "Escrow", amount: "1", account: "" }],
          escrow: { amount: "450", held: "", heldOn: "", tax: null, insurance: null },
        }),
        ctx()
      )
    ).toMatch(/its own name/);
    expect(stepProblem("payment", home({ paying: "" }), ctx())).toMatch(/pays/);
    expect(stepProblem("confirm", home(), ctx())).toBeNull();
  });

  it("refuses a new account the chart can't take", () => {
    const leafy = [...chart, account("Expenses:Financing")];
    expect(stepProblem("confirm", home(), ctx({ chart: leafy }))).toMatch(
      /Expenses:Financing holds transactions/
    );
  });
});

describe("what Confirm sends", () => {
  const draft = home({
    price: "375000",
    borrowed: "2024-07-19",
    escrow: {
      amount: "450.00",
      held: "2,310.55",
      heldOn: "",
      tax: { amount: "2550", every: 6, next: "2027-03-01" },
      insurance: null,
    },
    pmi: "125.00",
    lender: "Big Bank Mortgage",
  });

  it("the loan, every payment from the start, and the accounts to open, what it bought at its cost", () => {
    const sent = requestOf(draft, ctx());
    expect(sent).toMatchObject({
      name: "123 Main St mortgage",
      payee: "Big Bank Mortgage",
      accounts: {
        liability: "Liabilities:Loans:Mortgages:123-Main-St",
        paying: CHECKING,
        interest: "Expenses:Financing:Interest:123-Main-St",
        asset: "Assets:Property:123-Main-St",
      },
      history: { kind: "start", on: "2024-07-19", against: "Equity:Opening-Balances" },
      others: [
        {
          name: "Escrow",
          account: "Assets:Escrow:123-Main-St",
          amount: "450.00",
          from: "2024-09-01",
        },
        { name: "PMI", account: "Expenses:Insurance:PMI:123-Main-St", amount: "125.00" },
      ],
    });
    expect(sent.setup?.open).toEqual([
      { name: "Liabilities:Loans:Mortgages:123-Main-St" },
      { name: "Expenses:Financing:Interest:123-Main-St" },
      { name: "Assets:Escrow:123-Main-St" },
      { name: "Expenses:Insurance:PMI:123-Main-St" },
      { name: "Expenses:Taxes:Property:123-Main-St" },
      {
        name: "Assets:Property:123-Main-St",
        opening: { amount: "375000", date: "2024-07-19" },
        revalue_every: 350,
      },
    ]);
    expect(sent.setup?.escrow_balance).toEqual({
      account: "Assets:Escrow:123-Main-St",
      amount: "2310.55",
      on: TODAY,
    });
    expect(sent.setup?.bills).toMatchObject([
      {
        name: "123 Main St property tax",
        rule: { every: 6, unit: "month", start: "2027-03-01" },
        template: {
          postings: [
            { account: "Assets:Escrow:123-Main-St", units: { number: "-2550" } },
            { account: "Expenses:Taxes:Property:123-Main-St", units: { number: "2550" } },
          ],
        },
      },
    ]);
    expect(sent.setup?.outflows).toEqual([]);
  });

  it("spending, opted into, counts principal and escrow; existing accounts aren't opened", () => {
    const sent = requestOf(
      { ...draft, spending: true, accounts: { interest: "Expenses:Interest" } },
      ctx({ chart: [...chart, account("Expenses:Interest")] })
    );
    expect(sent.setup?.outflows).toEqual([
      {
        account: "Liabilities:Loans:Mortgages:123-Main-St",
        as: "Expenses:Financing:Principal:123-Main-St",
      },
      { account: "Assets:Escrow:123-Main-St", as: "Expenses:Financing:Escrow:123-Main-St" },
    ]);
    const opened = sent.setup?.open?.map((a) => a.name);
    expect(opened).not.toContain("Expenses:Interest");
    expect(opened).toContain("Expenses:Financing:Escrow:123-Main-St");
  });

  it("from what's owed now, or nothing when its account already says so", () => {
    const { table } = tableOf(home());
    expect(historyOf(home({ history: "now" }), table!, TODAY, false)).toEqual({
      kind: "today",
      on: TODAY,
      owed: table!.rows.filter((r) => r.date <= TODAY).at(-1)!.balance,
      against: "Equity:Opening-Balances",
    });
    expect(
      historyOf(home({ history: "now", owed: "290,000.00" }), table!, TODAY, false)
    ).toMatchObject({ owed: "290000.00" });
    expect(historyOf(home(), table!, TODAY, true)).toEqual({ kind: "books" });
    expect(
      nextPayment(home(), table!, historyOf(home(), table!, TODAY, false), TODAY)?.nominal
    ).toBe("2026-12-01");
  });
});

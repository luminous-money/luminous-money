import type { Account } from "@luminous-money/ledger-client";
import { describe, expect, it } from "vitest";

import { batchOrder, planChart } from "./chart.js";

const TYPES = {
  Assets: "asset",
  Liabilities: "liability",
  Equity: "equity",
  Income: "income",
  Expenses: "expense",
} as const;

const account = (name: string, rest: Partial<Account> = {}): Account => ({
  name,
  type: TYPES[name.split(":")[0] as keyof typeof TYPES],
  kind: "leaf",
  implicit: false,
  open: "2020-01-01",
  close: null,
  currencies: [],
  divided: false,
  ...rest,
});

const BOOK = [
  ...Object.keys(TYPES).map((r) => account(r, { kind: "node", implicit: true, open: null })),
  account("Assets:Bank", { kind: "node", implicit: true, open: null }),
  account("Assets:Bank:Checking"),
  account("Expenses:Travel"),
  account("Expenses:Old", { kind: "node", close: "2021-01-01" }),
];

const plan = (text: string) => planChart(text, BOOK, "USD");

describe("importing a chart of accounts", () => {
  it("reads the columns it knows, normalizing names, and says which it doesn't", () => {
    const result = plan(
      [
        "Full Name,Display_Name,Description,Opening Balance,As of,Color",
        'expenses:dining out,Eating out,"  Restaurants and\n takeout ",,,red',
        'liabilities:cards:chase visa,,,"$1,250.00",01/31/2026,blue',
      ].join("\n")
    );

    expect(result.error).toBeNull();
    expect(result.ignored).toEqual(["Color"]);
    expect(result.problems).toEqual([]);
    expect(result.add.map((p) => p.account)).toEqual([
      {
        name: "Expenses:Dining-Out",
        kind: "leaf",
        open: null,
        opening_balance: null,
        booking: null,
        revalue_every: null,
        display_name: "Eating out",
        description: "Restaurants and takeout",
      },
      {
        name: "Liabilities:Cards:Chase-Visa",
        kind: "leaf",
        open: null,
        // What's owed, as a statement says it, is stored negative on a liability.
        opening_balance: { amount: "-1250.00", currency: "USD", date: "2026-01-31" },
        booking: null,
        revalue_every: null,
        display_name: null,
        description: null,
      },
    ]);
    expect(result.add[1]!.balance).toBe("1250.00");
  });

  it("makes a row a node when another goes under it, and leaves the book's accounts alone", () => {
    const result = plan(
      "Account\nExpenses:Pets\nExpenses:Pets:Food\nAssets:Bank:Checking\nassets:bank\n\n"
    );

    expect(result.add.map((p) => [p.account.name, p.account.kind])).toEqual([
      ["Expenses:Pets", "node"],
      ["Expenses:Pets:Food", "leaf"],
    ]);
    expect(result.existing.map((e) => [e.line, e.name])).toEqual([
      [4, "Assets:Bank:Checking"],
      [5, "Assets:Bank"],
    ]);
  });

  it("reads a list of names with no header", () => {
    const result = plan("Expenses:Groceries\nIncome:Salary\n");
    expect(result.add.map((p) => p.account.name)).toEqual(["Expenses:Groceries", "Income:Salary"]);
  });

  it("says why a row can't be added, and adds the rest", () => {
    const result = plan(
      [
        "Account,Opening balance,As of,Currency,Booking,Revalue every,Opened",
        "Stuff:Things,,,,,,",
        "Expenses:Travel:Hotels,,,,,,",
        "Expenses:Old:Gym,,,,,,",
        "Assets:Cash,ten,2026-01-01,,,,",
        "Assets:Wallet,5.00,,,,,",
        "Assets:Euros,5.00,2026-01-01,us dollars,,,",
        "Assets:House,,,,AVERAGE,,",
        "Assets:Car,,,,,often,",
        "Assets:Boat,,,,,,someday",
        "Assets:Brokerage,100,2026-01-01,,,,",
        "Assets:Brokerage:VTI,,,,,,",
        "expenses:groceries,,,,,,",
        "Expenses:Groceries,,,,,,",
        ",,,,,,",
        ",5,,,,,",
        "Assets:Fine,1.00,2026-01-01,,FIFO,350,2025-12-01",
      ].join("\n")
    );

    expect(result.problems.map((p) => [p.line, p.problem])).toEqual([
      [2, "Start with one of Assets, Liabilities, Equity, Income, Expenses"],
      [3, "Expenses:Travel holds transactions, so it can't have sub-accounts"],
      [4, "Expenses:Old is archived"],
      [5, '"ten" isn\'t an amount'],
      [6, "An opening balance needs its date (an As of column)"],
      [7, '"US DOLLARS" isn\'t a currency'],
      [8, "Booking is one of FIFO, LIFO, HIFO, STRICT, NONE"],
      [9, 'Revalue every is a number of days, not "often"'],
      [10, '"someday" isn\'t a date'],
      [11, "Assets:Brokerage has accounts under it, so it can't have an opening balance"],
      [14, "Expenses:Groceries is also on line 13"],
      [16, "No account name"],
    ]);
    expect(result.add.map((p) => p.account.name)).toEqual([
      "Assets:Brokerage:VTI",
      "Expenses:Groceries",
      "Assets:Fine",
    ]);
    expect(result.add[2]!.account).toMatchObject({
      open: "2025-12-01",
      booking: "FIFO",
      revalue_every: 350,
      opening_balance: { amount: "1.00", currency: "USD", date: "2026-01-01" },
    });
  });

  it("needs an Account column", () => {
    expect(plan("Name of thing,Amount\nGroceries,5").error).toMatch(/needs an Account column/);
    expect(plan("").error).toBe("The file is empty.");
  });

  it("reads GnuCash's account tree export as it comes", () => {
    const tree = [
      '"Type","Full Account Name","Account Name","Account Code","Description","Account Color","Notes","Symbol","Namespace","Hidden","Tax Info","Placeholder"',
      '"ASSET","Assets","Assets","","","","","USD","CURRENCY","F","F","T"',
      '"ASSET","Assets:Current Assets","Current Assets","","","","","USD","CURRENCY","F","F","T"',
      '"BANK","Assets:Current Assets:Checking Account","Checking Account","","Everyday","","","USD","CURRENCY","F","F","F"',
      '"BANK","Assets:Current Assets:Old Savings","Old Savings","","","","","USD","CURRENCY","T","F","F"',
      '"CREDIT","Credit Cards:Visa","Visa","","","","The travel card","USD","CURRENCY","F","F","F"',
      '"EXPENSE","Expenses:Auto","Auto","","","","","USD","CURRENCY","F","F","T"',
      '"EXPENSE","Expenses:Dining","Dining","","","","","USD","CURRENCY","F","F","F"',
      '"BANK","Imbalance-USD","Imbalance-USD","","","","","USD","CURRENCY","F","F","F"',
      '"TRADING","Trading:CURRENCY:USD","USD","","","","","USD","CURRENCY","F","F","F"',
    ].join("\n");

    const result = plan(tree);

    expect(result.problems).toEqual([]);
    expect(result.add.map((p) => [p.account.name, p.account.kind, p.account.description])).toEqual([
      ["Assets:Current-Assets", "node", null],
      ["Assets:Current-Assets:Checking-Account", "leaf", "Everyday"],
      ["Liabilities:Credit-Cards:Visa", "leaf", "The travel card"],
      ["Expenses:Auto", "node", null],
      ["Expenses:Dining", "leaf", null],
    ]);
    expect(result.existing.map((e) => e.name)).toEqual(["Assets"]);
    expect(result.left.map((l) => [l.name, l.why])).toEqual([
      ["Assets:Current-Assets:Old-Savings", "Hidden"],
      [null, "GnuCash's own, for what it couldn't balance"],
      [null, "A trading account: not used here"],
    ]);
    expect(result.mapping).toMatchObject({
      "Assets:Current Assets:Checking Account": "Assets:Current-Assets:Checking-Account",
      "Credit Cards:Visa": "Liabilities:Credit-Cards:Visa",
      "Assets:Current Assets:Old Savings": "Assets:Current-Assets:Old-Savings",
    });
    expect(planChart(tree, BOOK, "USD", { includeHidden: true }).add).toHaveLength(6);
  });

  it("treats a row as an account the book has, or leaves it out, as chosen", () => {
    const result = planChart(
      "Account\nAssets:Old Bank:Checking\nAssets:Old Bank:Savings\nExpenses:Pets\n",
      BOOK,
      "USD",
      {
        choices: {
          "Assets:Old-Bank:Checking": { same_as: "Assets:Bank:Checking" },
          "Assets:Old-Bank:Savings": "leave",
          "Expenses:Pets": { same_as: "Expenses:Old" },
        },
      }
    );

    expect(result.add).toEqual([]);
    expect(result.existing).toEqual([
      {
        line: 2,
        written: "Assets:Old Bank:Checking",
        name: "Assets:Old-Bank:Checking",
        as: "Assets:Bank:Checking",
      },
    ]);
    expect(result.left.map((l) => [l.line, l.why])).toEqual([[3, "Left out"]]);
    expect(result.problems.map((p) => p.problem)).toEqual([
      "Expenses:Old isn't an open account here",
    ]);
    expect(result.mapping["Assets:Old Bank:Checking"]).toBe("Assets:Bank:Checking");
  });

  it("opens what has no balance first, by name, so nodes come before what's under them", () => {
    const result = plan(
      [
        "Account,Opening balance,As of",
        "Assets:Savings,10,2026-01-01",
        "Equity:Opening-Balances,,",
        "Expenses:Kids:Toys,,",
        "Expenses:Kids,,",
      ].join("\n")
    );

    expect(batchOrder(result.add).map((a) => a.name)).toEqual([
      "Equity:Opening-Balances",
      "Expenses:Kids",
      "Expenses:Kids:Toys",
      "Assets:Savings",
    ]);
  });
});

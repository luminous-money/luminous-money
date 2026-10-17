import { expect, it } from "vitest";

import { accountsLabel, movement } from "./journal.js";

const usd = (number: string) => ({ number, currency: "USD" });

it("says where a transaction's money came from and went, and how much", () => {
  expect(
    movement([
      { account: "Assets:Bank:Checking", amount: usd("-82.10") },
      { account: "Expenses:Food:Groceries", amount: usd("82.10") },
    ])
  ).toEqual({
    from: ["Assets:Bank:Checking"],
    to: ["Expenses:Food:Groceries"],
    amount: usd("82.10"),
  });

  const paycheck = movement([
    { account: "Income:Salary", amount: usd("-5000.00") },
    { account: "Expenses:Taxes:Federal", amount: usd("700.00") },
    { account: "Assets:Bank:Checking", amount: null }, // elided: the rest
  ]);
  expect(paycheck.from).toEqual(["Income:Salary"]);
  expect(paycheck.to).toEqual(["Expenses:Taxes:Federal", "Assets:Bank:Checking"]);
  expect(accountsLabel(paycheck.to)).toBe("2 accounts");
  expect(accountsLabel(["Assets:Bank:Checking"])).toBe("Bank:Checking");
});

it("shows a buy by its cash, not its shares or its fee", () => {
  const buy = movement([
    { account: "Assets:Broker:Cash", amount: usd("-2405.00") },
    { account: "Assets:Broker:VEA", amount: { number: "24", currency: "VEA" } },
    { account: "Expenses:Financial:Fees", amount: usd("5.00") },
  ]);
  expect(buy.amount).toEqual(usd("2405.00"));
  expect(buy.to).toEqual(["Assets:Broker:VEA", "Expenses:Financial:Fees"]);
});

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
  expect(paycheck.amount).toEqual(usd("4300.00")); // what reached the bank
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

it("shows a charge as what left the card, whatever else is negative", () => {
  // A discount on one line: the item's own account nets to what it cost.
  const coupon = movement([
    { account: "Liabilities:Card", amount: usd("-30.00") },
    { account: "Expenses:Food:Groceries", amount: usd("20.00") },
    { account: "Expenses:Food:Groceries", amount: usd("-5.00") },
    { account: "Expenses:Household", amount: usd("15.00") },
  ]);
  expect(coupon.amount).toEqual(usd("30.00"));
  expect(coupon.from).toEqual(["Liabilities:Card"]);
  expect(coupon.to).toEqual(["Expenses:Food:Groceries", "Expenses:Household"]);

  // Gift cards bought for less than they're worth: the difference is income.
  const giftCards = movement([
    { account: "Liabilities:Card", amount: usd("-90.00") },
    { account: "Assets:Gift-Cards:Cafe", amount: usd("50.00") },
    { account: "Assets:Gift-Cards:Cafe", amount: usd("50.00") },
    { account: "Expenses:Food:Groceries", amount: usd("10.00") },
    { account: "Income:Discounts", amount: usd("-20.00") },
  ]);
  expect(giftCards.amount).toEqual(usd("90.00"));
  expect(giftCards.from).toEqual(["Liabilities:Card", "Income:Discounts"]);
  expect(accountsLabel(giftCards.to)).toBe("2 accounts");
});

it("shows a refund by what came back, and a move between categories by its size", () => {
  expect(
    movement([
      { account: "Liabilities:Card", amount: usd("12.00") },
      { account: "Expenses:Food:Groceries", amount: usd("-12.00") },
    ]).amount
  ).toEqual(usd("12.00"));
  expect(
    movement([
      { account: "Expenses:Food:Groceries", amount: usd("-8.00") },
      { account: "Expenses:Household", amount: usd("8.00") },
    ]).amount
  ).toEqual(usd("8.00"));
});

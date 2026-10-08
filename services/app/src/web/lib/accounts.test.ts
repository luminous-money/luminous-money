import type { Account } from "@fava-beans/ledger-client";
import { describe, expect, it } from "vitest";

import { openOn, preferredRoots, search, shortName } from "./accounts.js";

const NAMES = [
  "Assets:US:BofA:Checking",
  "Expenses:Food:Groceries",
  "Expenses:Food:Restaurant",
  "Expenses:Home:Rent",
  "Income:US:Salary",
  "Liabilities:US:Chase:Slate",
];

describe("account search", () => {
  it("matches every word, segment starts first", () => {
    expect(search(NAMES, "food rest")).toEqual(["Expenses:Food:Restaurant"]);
    expect(search(NAMES, "res")[0]).toBe("Expenses:Food:Restaurant");
  });

  it("lists preferred roots first when nothing is typed", () => {
    expect(search(NAMES, "", preferredRoots(true))[0]).toMatch(/^Expenses:/);
    expect(search(NAMES, "", preferredRoots(false))[0]).toMatch(/^Income:/);
  });

  it("treats colons like spaces", () => {
    expect(search(NAMES, "food:groc")).toEqual(["Expenses:Food:Groceries"]);
  });
});

describe("open accounts", () => {
  const accounts: Account[] = [
    { name: "Assets:Old", open: "2020-01-01", close: "2024-01-01", currencies: [] },
    { name: "Assets:New", open: "2025-01-01", close: null, currencies: [] },
    { name: "Assets:Always", open: "2000-01-01", close: null, currencies: [] },
  ];

  it("are open on or after their open date and before their close date", () => {
    expect(openOn(accounts, "2024-06-01")).toEqual(["Assets:Always"]);
    expect(openOn(accounts, "2025-01-01")).toEqual(["Assets:New", "Assets:Always"]);
  });
});

it("short names keep the last two segments", () => {
  expect(shortName("Expenses:Food:Restaurant")).toBe("Food:Restaurant");
  expect(shortName("Assets:Cash")).toBe("Assets:Cash");
});

import type { Account } from "@fava-beans/ledger-client";
import { describe, expect, it } from "vitest";

import {
  isSegment,
  parentChoices,
  postable,
  preferredRoots,
  search,
  shortName,
  suggestNew,
  toSegment,
} from "./accounts.js";

const NAMES = [
  "Assets:US:BofA:Checking",
  "Expenses:Food:Groceries",
  "Expenses:Food:Restaurant",
  "Expenses:Home:Rent",
  "Income:US:Salary",
  "Liabilities:US:Chase:Slate",
];

const account = (name: string, rest: Partial<Account> = {}): Account => ({
  name,
  type: "expense",
  kind: "leaf",
  implicit: false,
  open: "2020-01-01",
  close: null,
  currencies: [],
  ...rest,
});

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

describe("which accounts are offered", () => {
  const accounts = [
    account("Expenses:Old", { open: "2020-01-01", close: "2024-01-01" }),
    account("Expenses:New", { open: "2025-01-01" }),
    account("Expenses:Always", { open: "2000-01-01" }),
    account("Expenses:Food", { kind: "node", implicit: true, open: null }),
    account("Expenses:Shut", { kind: "node", close: "2021-01-01" }),
  ];

  it("posts only to leaves open on the date", () => {
    expect(postable(accounts, "2024-06-01")).toEqual(["Expenses:Always"]);
    expect(postable(accounts, "2025-01-01")).toEqual(["Expenses:New", "Expenses:Always"]);
  });

  it("puts new accounts only under open nodes", () => {
    expect(parentChoices(accounts).map((a) => a.name)).toEqual(["Expenses:Food"]);
  });
});

describe("naming a new account", () => {
  it("makes a valid segment from what was typed", () => {
    expect(toSegment("coffee shops")).toBe("Coffee-Shops");
    expect(toSegment("  café  ")).toBe("Café");
    expect(toSegment("Kids' toys!")).toBe("Kids-Toys");
    expect(toSegment("401k match")).toBe("401k-Match");
  });

  it("knows a valid segment", () => {
    expect(isSegment("Coffee-Shops")).toBe(true);
    expect(isSegment("9Lives")).toBe(true);
    expect(isSegment("coffee")).toBe(false);
    expect(isSegment("Coffee Shops")).toBe(false);
    expect(isSegment("")).toBe(false);
  });

  it("suggests a parent only when the typed path names a node", () => {
    const parents = ["Expenses", "Expenses:Utilities", "Assets"];
    expect(suggestNew("utilities:power", parents)).toEqual({
      name: "Power",
      parent: "Expenses:Utilities",
    });
    expect(suggestNew("Expenses:Utilities:", parents)).toEqual({
      name: "",
      parent: "Expenses:Utilities",
    });
    expect(suggestNew("coffee shops", parents)).toEqual({ name: "Coffee-Shops", parent: "" });
    expect(suggestNew("nowhere:thing", parents)).toEqual({ name: "Nowhere-Thing", parent: "" });
  });
});

it("short names keep the last two segments", () => {
  expect(shortName("Expenses:Food:Restaurant")).toBe("Food:Restaurant");
  expect(shortName("Assets:Cash")).toBe("Assets:Cash");
});

import type { Account } from "@luminous-money/ledger-client";
import { describe, expect, it } from "vitest";

import {
  displayName,
  checkNewAccount,
  completeWith,
  completions,
  typed,
  isSegment,
  normalizeName,
  postable,
  preferredRoots,
  search,
  shortName,
  shown,
  suggestName,
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
  divided: false,
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
});

describe("naming a new account", () => {
  it("makes a valid, title-cased segment from what was typed", () => {
    expect(toSegment("coffee shops")).toBe("Coffee-Shops");
    expect(toSegment("gifts and giving")).toBe("Gifts-and-Giving");
    expect(toSegment("Gifts And Giving")).toBe("Gifts-and-Giving");
    expect(toSegment("the end of an era")).toBe("The-End-of-an-Era");
    expect(toSegment("  café  ")).toBe("Café");
    expect(toSegment("Kids' toys!")).toBe("Kids-Toys");
    expect(toSegment("401k match")).toBe("401k-Match");
    expect(toSegment("PNC checking")).toBe("PNC-Checking");
    expect(toSegment("late-night_snacks")).toBe("Late-Night-Snacks");
  });

  it("normalizes a full name written by hand", () => {
    const roots = ["Assets", "Liabilities", "Equity", "Income", "Expenses"];
    expect(normalizeName("expenses:dining out", roots)).toEqual({ name: "Expenses:Dining-Out" });
    expect(normalizeName(" Assets : Bank : PNC checking ", roots)).toEqual({
      name: "Assets:Bank:PNC-Checking",
    });
    expect(normalizeName("Expense:Food:", roots)).toEqual({ name: "Expenses:Food" });
    expect(normalizeName("liability:cards:visa", roots)).toEqual({
      name: "Liabilities:Cards:Visa",
    });
    expect(normalizeName("Stuff:Things", roots)).toEqual({
      problem: "Start with one of Assets, Liabilities, Equity, Income, Expenses",
    });
    expect(normalizeName("Income", roots)).toEqual({ problem: "Name an account under Income" });
    expect(normalizeName("Expenses:!!!:Food", roots)).toEqual({
      problem: '"!!!" has no letters or digits to make a name from',
    });
    expect(normalizeName("Expenses::Food", roots)).toEqual({
      problem: "A part of the name is empty",
    });
  });

  it("knows a valid segment", () => {
    expect(isSegment("Coffee-Shops")).toBe(true);
    expect(isSegment("9Lives")).toBe(true);
    expect(isSegment("coffee")).toBe(false);
    expect(isSegment("Coffee Shops")).toBe(false);
    expect(isSegment("")).toBe(false);
  });
});

describe("a new account's full name", () => {
  const roots = ["Assets", "Liabilities", "Equity", "Income", "Expenses"].map((name) =>
    account(name, { kind: "node", implicit: true, open: null })
  );
  const accounts = [
    ...roots,
    account("Expenses:Food", { kind: "node", implicit: true, open: null }),
    account("Expenses:Food:Groceries"),
    account("Expenses:Utilities", { kind: "node" }),
    account("Expenses:Old", { kind: "node", close: "2021-01-01" }),
  ];

  it("starts from the search, under the preferred root", () => {
    expect(suggestName("Groceries", accounts, "Expenses")).toBe("Expenses:Groceries");
    expect(suggestName("coffee shops", accounts, "Expenses")).toBe("Expenses:Coffee-Shops");
    expect(suggestName("salary", accounts, "Income")).toBe("Income:Salary");
    expect(suggestName("", accounts, "Expenses")).toBe("Expenses:");
  });

  it("keeps the colons of a typed path", () => {
    expect(suggestName("Gifts and Giving:Friends", accounts, "Expenses")).toBe(
      "Expenses:Gifts-and-Giving:Friends"
    );
    expect(suggestName("home:garden tools", accounts, "Expenses")).toBe(
      "Expenses:Home:Garden-Tools"
    );
  });

  it("keeps a typed root, and goes under a typed node", () => {
    expect(suggestName("assets:cash wallet", accounts, "Expenses")).toBe("Assets:Cash-Wallet");
    expect(suggestName("utilities:power", accounts, "Expenses")).toBe("Expenses:Utilities:Power");
    expect(suggestName("Expenses:Utilities:", accounts, "Expenses")).toBe("Expenses:Utilities:");
  });

  it("is checked against the ledger's rules", () => {
    const check = (name: string) => checkNewAccount(name, accounts);

    expect(check("Expenses:Utilities:Power")).toEqual({ ok: true, type: "expense", creates: [] });
    expect(check("Expenses:Home:Garden:Tools")).toEqual({
      ok: true,
      type: "expense",
      creates: ["Expenses:Home", "Expenses:Home:Garden"],
    });
    expect(check("Expenses:Food")).toMatchObject({
      ok: false,
      message: expect.stringContaining("can't hold transactions"),
    });
    expect(check("Expenses:Food:Groceries")).toMatchObject({
      ok: false,
      message: expect.stringContaining("already exists"),
    });
    expect(check("Expenses:Food:Groceries:Organic")).toMatchObject({
      ok: false,
      message: expect.stringContaining("holds transactions"),
    });
    expect(check("Expenses:Old:Thing")).toMatchObject({
      ok: false,
      message: expect.stringContaining("is closed"),
    });
    expect(check("Stuff:Things")).toMatchObject({
      ok: false,
      message: expect.stringContaining("Start with one of"),
    });
    expect(check("Expenses")).toMatchObject({
      ok: false,
      message: "Name an account under Expenses",
    });
    expect(check("Expenses:Utilities:")).toMatchObject({
      ok: false,
      message: "Name an account under Expenses",
    });
    expect(check("Expenses:coffee")).toMatchObject({
      ok: false,
      message: expect.stringContaining('"coffee" isn\'t valid'),
    });
  });
});

describe("typing a new account's name", () => {
  const nodes = [
    "Assets",
    "Liabilities",
    "Equity",
    "Income",
    "Expenses",
    "Expenses:Food",
    "Expenses:Food:Dining",
    "Expenses:Fun",
  ].map((name) => account(name, { kind: "node" }));
  const tree = [
    ...nodes,
    account("Expenses:Food:Groceries"),
    account("Expenses:Gone", { kind: "node", close: "2021-01-01" }),
  ];

  it("turns spaces into dashes and title-cases each part, keeping the length", () => {
    expect(typed("expenses:coffee shops")).toBe("Expenses:Coffee-Shops");
    expect(typed("Expenses:Food:Late night")).toBe("Expenses:Food:Late-Night");
    expect(typed("expenses:food:x y").length).toBe("expenses:food:x y".length);
    expect(typed("PNC checking")).toBe("PNC-Checking");
  });

  it("keeps a joining word lowercase once another word follows it", () => {
    expect(typed("expenses:gifts and")).toBe("Expenses:Gifts-And");
    expect(typed("expenses:gifts and ")).toBe("Expenses:Gifts-and-");
    expect(typed("expenses:gifts and giving")).toBe("Expenses:Gifts-and-Giving");
    expect(typed("expenses:the end")).toBe("Expenses:The-End");
    expect(typed("expenses:-of course")).toBe("Expenses:-Of-Course");
    expect(typed("expenses:ßa")).toBe("Expenses:ßa");
  });

  it("suggests open node accounts that continue what's typed, ignoring case", () => {
    expect(completions("exp", tree)).toEqual([
      "Expenses",
      "Expenses:Fun",
      "Expenses:Food",
      "Expenses:Food:Dining",
    ]);
    expect(completions("Expenses:Fo", tree)).toEqual(["Expenses:Food", "Expenses:Food:Dining"]);
    expect(completions("Expenses:Food:", tree)).toEqual(["Expenses:Food:Dining"]); // not the leaf
    expect(completions("Expenses:G", tree)).toEqual([]); // closed
  });

  it("fills one portion at a time: through the next colon, or to the end", () => {
    expect(completeWith("exp", "Expenses:Food:Dining")).toBe("Expenses:");
    expect(completeWith("exp", "Expenses")).toBe("Expenses");
    expect(completeWith("Expenses", "Expenses:Food:Dining")).toBe("Expenses:Food:");
    expect(completeWith("Expenses:", "Expenses:Food:Dining")).toBe("Expenses:Food:");
    expect(completeWith("Expenses:Food:", "Expenses:Food:Dining")).toBe("Expenses:Food:Dining");
    expect(completeWith("expenses:fo", "Expenses:Food")).toBe("Expenses:Food");
  });
});

it("short names keep the last two segments", () => {
  expect(shortName("Expenses:Food:Restaurant")).toBe("Food:Restaurant");
  expect(shortName("Assets:Cash")).toBe("Assets:Cash");
});

it("display names: display-name metadata, else the last segment with dashes as spaces", () => {
  expect(displayName({ name: "Assets:Bank:PNC-Shared-Checking" })).toBe("PNC Shared Checking");
  expect(displayName({ name: "Assets:Bank:X", display_name: "BofA Checking" })).toBe(
    "BofA Checking"
  );
});

it("liabilities and income are shown with their signs flipped", () => {
  expect(shown("-250.00", "liability")).toBe("250.00");
  expect(shown("-3000.00", "income")).toBe("3000.00");
  expect(shown("-4.50", "asset")).toBe("-4.50");
  expect(shown("12.00", "expense")).toBe("12.00");
  expect(shown("12.00", undefined)).toBe("12.00");
});

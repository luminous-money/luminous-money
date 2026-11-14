import { expect, it } from "vitest";

import { trail, type Known } from "./crumbs.js";

const nodes = new Set(["Expenses", "Expenses:Food"]);
const known: Known = {
  label: (a) => a.split(":").at(-1)!,
  isNode: (a) => nodes.has(a),
};
const labels = (path: string, back: string | null = null) =>
  trail(path, back, known).map((c) => `${c.label} ${c.href}`);

it("an account's page is under its parents, under Accounts, under home", () => {
  expect(labels("/books/b/accounts/Expenses:Food:Groceries")).toEqual([
    "Home /books/b",
    "Accounts /books/b/accounts",
    "Expenses /books/b/accounts",
    "Food /books/b/accounts/Expenses%3AFood/edit",
  ]);
  // A node's page is its editor; a leaf's editor is under its ledger.
  expect(labels("/books/b/accounts/Expenses%3AFood/edit").at(-1)).toBe(
    "Expenses /books/b/accounts"
  );
  expect(labels("/books/b/accounts/Expenses:Food:Groceries/edit").at(-1)).toBe(
    "Groceries /books/b/accounts/Expenses%3AFood%3AGroceries"
  );
});

it("a page opened from another is under it, with its trail, back to where it was", () => {
  expect(labels("/books/b/transactions/t1", "/books/b/review?only=t1")).toEqual([
    "Home /books/b",
    "Review /books/b/review?only=t1",
  ]);
  expect(
    labels("/books/b/transactions/t1", "/books/b/accounts/Expenses%3AFood%3AGroceries")
  ).toEqual([
    "Home /books/b",
    "Accounts /books/b/accounts",
    "Expenses /books/b/accounts",
    "Food /books/b/accounts/Expenses%3AFood/edit",
    "Groceries /books/b/accounts/Expenses%3AFood%3AGroceries",
  ]);
  // Without one, by its structure.
  expect(labels("/books/b/transactions/t1")).toEqual([
    "Home /books/b",
    "Transactions /books/b/transactions",
  ]);
  // A back that came from somewhere itself keeps that too.
  const rule = `/books/b/rules/new?from=t1&back=${encodeURIComponent("/books/b/review")}`;
  expect(labels("/books/b/schedules/new", rule)).toEqual([
    "Home /books/b",
    "Review /books/b/review",
    `New rule ${rule}`,
  ]);
});

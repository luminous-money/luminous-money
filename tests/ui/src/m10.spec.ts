/** M10: the chart of accounts, and editing accounts from it. */
import { expect, test, type Page } from "@playwright/test";

import { addAccount, addTransactions, setUpUser } from "./support.js";

async function chart(page: Page) {
  const { book, account } = await setUpUser(page);
  await addAccount(book.id, "Expenses:Fun", null);
  await addTransactions(book.id, account, 3); // three groceries of $1.00 each
  await page.goto(`/ui/books/${book.id}/accounts`);
  return { book, account };
}

const section = (page: Page, root: string) => page.getByRole("region", { name: root });

test("the tree rolls balances up, collapses, and finds accounts", async ({ page }) => {
  await chart(page);

  const expenses = section(page, "Expenses");
  await expect(expenses).toContainText("$3.00");
  await expenses.getByRole("button", { name: "Expand Expenses:Food" }).click();
  await expect(expenses.getByRole("link", { name: "Groceries" })).toBeVisible();
  await expenses.getByRole("button", { name: "Collapse Expenses:Food" }).click();
  await expect(expenses.getByRole("link", { name: "Groceries" })).toBeHidden();

  await page.getByRole("searchbox", { name: "Find an account" }).fill("groc");
  await expect(expenses.getByRole("link", { name: "Groceries" })).toBeVisible();
  await expect(expenses.getByRole("link", { name: "Fun" })).toBeHidden();
  await expect(section(page, "Assets")).toBeHidden();
});

test("an account is renamed, then merged into another, from its editor", async ({ page }) => {
  const { book } = await chart(page);
  await page.goto(
    `/ui/books/${book.id}/accounts/${encodeURIComponent("Expenses:Food:Groceries")}/edit`
  );

  const name = page.getByRole("combobox", { name: "Full name" });
  await name.fill("Expenses:Food:Supermarket");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("heading", { name: "Supermarket" })).toBeVisible();

  const merge = page.getByRole("form", { name: "Delete or merge" });
  await expect(merge).toContainText("Its 3 splits move to another account");
  await merge.getByRole("button", { name: /Move its splits to/ }).click();
  await merge.getByRole("combobox", { name: "Move its splits to" }).fill("Fun");
  await page.getByRole("option", { name: "Expenses:Fun" }).click();
  await merge
    .getByRole("textbox", { name: "Name of the account to delete" })
    .fill("Expenses:Food:Supermarket");
  await merge.getByRole("button", { name: "Merge into Fun" }).click();

  await expect(page.getByRole("heading", { name: /^Fun/ })).toBeVisible();
  await page.goto(`/ui/books/${book.id}/accounts`);
  await page.getByRole("searchbox", { name: "Find an account" }).fill("Supermarket");
  await expect(section(page, "Expenses")).toBeHidden();
});

test("system accounts can't be renamed", async ({ page }) => {
  const { book } = await chart(page);
  await page.goto(
    `/ui/books/${book.id}/accounts/${encodeURIComponent("Equity:Opening-Balances")}/edit`
  );
  await expect(page.getByText("A system account")).toBeVisible();
  await expect(page.getByRole("form", { name: "Rename or move" })).toHaveCount(0);
});

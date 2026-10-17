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

test("a node opens its editor, where its display name is set", async ({ page }) => {
  const { book } = await chart(page);
  await page.getByRole("link", { name: "Open Expenses:Food" }).click();
  await expect(page.getByRole("combobox", { name: "Full name" })).toHaveValue("Expenses:Food");
  await expect(page.getByText("Expense account").first()).toBeVisible(); // not flagged as taken

  await page.getByRole("textbox", { name: "Display name" }).fill("Eating");
  await page.getByRole("form", { name: "Name" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Eating" })).toBeVisible();
  await page.goto(`/ui/books/${book.id}/accounts`);
  await expect(
    section(page, "Expenses").getByRole("button", { name: /Expenses:Food/ })
  ).toContainText("Eating");
});

test("an account is renamed, then merged into another, from its editor", async ({ page }) => {
  const { book } = await chart(page);
  await page.goto(
    `/ui/books/${book.id}/accounts/${encodeURIComponent("Expenses:Food:Groceries")}/edit`
  );

  const name = page.getByRole("combobox", { name: "Full name" });
  await name.fill("Expenses:Food:Supermarket");
  await page.getByRole("button", { name: "Save and rename" }).click();
  await expect(page.getByRole("heading", { name: "Supermarket" })).toBeVisible();

  await page.getByText("Delete or merge").click();
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
  await expect(page.getByRole("combobox", { name: "Full name" })).toHaveCount(0);
  await expect(page.getByText("Delete or merge")).toHaveCount(0);
});

test("an asset's settings are in its editor, not on its ledger", async ({ page }) => {
  const { book, account } = await chart(page);
  const ledger = `/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`;
  await page.goto(ledger);
  await expect(page.getByRole("heading", { name: /PNC Checking/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Sales draw on" })).toHaveCount(0);

  await page.getByRole("link", { name: "Edit" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("combobox", { name: "Sales draw on" }).selectOption("FIFO");
  await page.reload();
  await expect(settings.getByRole("combobox", { name: "Sales draw on" })).toHaveValue("FIFO");

  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent("Expenses:Fun")}/edit`);
  await expect(page.getByRole("heading", { name: "Fun" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Settings" })).toHaveCount(0);
});

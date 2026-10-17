/** M11: budgets, on their page, an account's ledger and editor, and home. */
import { expect, test, type Page } from "@playwright/test";

import { setUpUser, stored } from "./support.js";

const GROCERIES = "Expenses:Food:Groceries";
const today = () => new Date().toLocaleDateString("en-CA");
const thisMonth = () => `${today().slice(0, 7)}-01`;

/** A user whose checking account paid for groceries today, and their book. */
async function withGroceries(page: Page, spent: string) {
  const { session, book, account } = await setUpUser(page);
  const ledger = session.ledger;
  const path = { book_id: book.id };
  await ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path },
    body: { name: GROCERIES, kind: "leaf" },
  });
  const spend = (number: string, flag = "*") =>
    ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path },
      body: {
        date: today(),
        flag,
        payee: "Grocer",
        narration: "",
        postings: [
          { account, units: { number: `-${number}`, currency: "USD" } },
          { account: GROCERIES },
        ],
      },
    });
  await spend(spent);
  const budget = (name: string, amount: string, unit: "week" | "month" = "month") =>
    ledger.PUT("/api/ledger/v1/books/{book_id}/budgets/{account}", {
      params: { path: { book_id: book.id, account: name } },
      body: { start: thisMonth(), amount, unit, every: 1 },
    });
  return { book: book.id, spend, budget };
}

test("a budget is added on Budgets, and its bar moves as money's spent", async ({ page }) => {
  const { book, spend } = await withGroceries(page, "100.00");
  await page.goto(`/ui/books/${book}/budgets`);
  await expect(page.getByText("No budgets yet")).toBeVisible();

  await page.getByRole("button", { name: "+ Add" }).click();
  await page.getByRole("button", { name: /Budget for/ }).click();
  await page.getByRole("combobox", { name: "Budget for" }).fill("Groceries");
  await page.getByRole("option", { name: GROCERIES }).click();
  await page.getByRole("textbox", { name: "Amount" }).fill("400");
  await page.getByRole("button", { name: "Save" }).click();

  const bar = page.getByRole("meter", { name: `${GROCERIES}'s budget` });
  await expect(bar).toHaveAttribute("aria-valuetext", "$100.00 of $400.00");
  await spend("50.00");
  await page.reload();
  await expect(bar).toHaveAttribute("aria-valuetext", "$150.00 of $400.00");
  await expect(page.getByRole("region", { name: "Expenses" })).toContainText("$250.00 left");
});

test("a node's budget keeps what's not under its accounts' as Other, and restates per month", async ({
  page,
}) => {
  const { book, budget } = await withGroceries(page, "100.00");
  await budget("Expenses", "1000");
  await budget(GROCERIES, "100", "week");
  await page.goto(`/ui/books/${book}/budgets`);

  await expect(page.getByRole("meter", { name: "Other in Expenses" })).toBeVisible();
  await page.getByRole("radio", { name: "Per month" }).click();
  await expect(page.getByRole("meter", { name: `${GROCERIES}'s budget` })).toHaveAttribute(
    "aria-valuetext",
    "$100.00 of $434.82" // $100 a week, per month
  );
  await expect(page.getByRole("meter", { name: "Other in Expenses" })).toHaveAttribute(
    "aria-valuetext",
    "$0.00 of $565.18"
  );
});

test("the ledger and home show how it's going, and the editor changes it", async ({ page }) => {
  const { book, budget } = await withGroceries(page, "100.00");
  await budget(GROCERIES, "400");

  await page.goto(`/ui/books/${book}`);
  await expect(page.getByRole("region", { name: "Spent this month" })).toContainText(
    "of $400 budgeted"
  );

  await page.goto(`/ui/books/${book}/accounts/${encodeURIComponent(GROCERIES)}`);
  await expect(page.getByRole("link", { name: "Budget" })).toContainText("this month");

  await page.goto(`/ui/books/${book}/accounts/${encodeURIComponent(GROCERIES)}/edit`);
  const card = page.getByRole("region", { name: "Budget" });
  await card.getByRole("textbox", { name: "Amount" }).fill("500");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByRole("meter")).toHaveAttribute("aria-valuetext", "$100.00 of $500.00");

  await card.getByRole("button", { name: "Remove" }).click();
  await expect(card.getByRole("meter")).toHaveCount(0);
});

test("a transaction excluded from budgets still counts, but not against them", async ({ page }) => {
  const { book, budget, spend } = await withGroceries(page, "100.00");
  await budget(GROCERIES, "400");
  await page.goto(`/ui/books/${book}/accounts/${encodeURIComponent(GROCERIES)}`);
  await page
    .getByRole("list", { name: "Transactions" })
    .getByRole("button", { name: /Grocer/ })
    .click();
  await page.getByRole("checkbox", { name: "Exclude from budget" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.goto(`/ui/books/${book}/budgets`);
  const bar = page.getByRole("meter", { name: `${GROCERIES}'s budget` });
  await expect(bar).toHaveAttribute("aria-valuetext", "$0.00 of $400.00");

  // In review, straight from the card.
  const { data } = await spend("30.00", "!");
  await page.goto(`/ui/books/${book}/review`);
  await page.getByRole("article").getByRole("checkbox", { name: "Exclude from budget" }).check();
  await expect.poll(async () => (await stored(book, data!.id)).meta?.budget).toBe(false);
});

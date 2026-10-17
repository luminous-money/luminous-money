/** M12: home's chart and recent transactions, the Transactions page, Reports, and an account's
 * typical periods. */
import { expect, test, type Page } from "@playwright/test";

import { setUpUser } from "./support.js";

const GROCERIES = "Expenses:Food:Groceries";
const RENT = "Expenses:Housing:Rent";
const today = () => new Date().toLocaleDateString("en-CA");
/** The `day`th of the month `back` months ago. */
function dayOf(back: number, day: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A user with six months of rent and groceries before this one, and groceries today. */
async function withHistory(page: Page) {
  const { session, book, account } = await setUpUser(page);
  const path = { book_id: book.id };
  for (const name of [GROCERIES, RENT])
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path },
      body: { name, kind: "leaf" },
    });
  const spend = (date: string, to: string, number: string, payee: string) => ({
    date,
    flag: "*",
    payee,
    narration: "",
    postings: [
      { account, units: { number: `-${number}`, currency: "USD" } },
      { account: to, units: { number, currency: "USD" } },
    ],
  });
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions/batch", {
    params: { path },
    body: [
      ...[1, 2, 3, 4, 5, 6].flatMap((back) => [
        spend(dayOf(back, 1), RENT, "900.00", "Landlord"),
        spend(dayOf(back, 10), GROCERIES, "150.00", "Grocer"),
      ]),
      spend(today(), GROCERIES, "42.00", "Corner Grocer"),
    ],
  });
  return { book: book.id };
}

test("home shows this month's spending, and recent transactions open the whole journal", async ({
  page,
}) => {
  const { book } = await withHistory(page);
  await page.goto(`/ui/books/${book}`);

  const spending = page.getByRole("region", { name: "Spent this month" });
  await expect(spending).toContainText("$42");
  await expect(spending.getByRole("img", { name: /Spent \$42 this month/ })).toBeVisible();
  const recent = page.getByRole("list", { name: "Recent transactions" });
  await expect(recent.getByRole("listitem").first()).toContainText("Corner Grocer");

  await page.getByRole("link", { name: "Recent transactions ›" }).click();
  await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  const all = page.getByRole("list", { name: "Transactions" }).getByRole("listitem");
  await expect(all).toHaveCount(14); // 12, today's, and the opening balance
  await expect(all.first()).toContainText("PNC-Checking → Food:Groceries");
});

test("Reports break spending down, and drill into a category", async ({ page }) => {
  const { book } = await withHistory(page);
  await page.goto(`/ui/books/${book}/reports`);

  const breakdown = page.getByRole("region", { name: "Breakdown" });
  const categories = breakdown.getByRole("list", { name: "Categories" });
  await expect(categories).toContainText("Housing");
  await expect(categories).toContainText("$900");
  await categories.getByRole("button", { name: /Food/ }).click();
  await expect(breakdown.getByRole("navigation", { name: "Drilled into" })).toContainText("Food");
  await expect(categories).toContainText("Groceries");
  await expect(categories).toContainText("$150");

  await expect(page.getByRole("region", { name: "Cash flow" })).toContainText("Expenses");
  await expect(page.getByRole("region", { name: "Largest transactions" })).toContainText(
    "Corner Grocer"
  );
});

test("an expense account's page shows what its periods typically come to", async ({ page }) => {
  const { book } = await withHistory(page);
  await page.goto(`/ui/books/${book}/accounts/${encodeURIComponent(GROCERIES)}`);
  const typical = page.getByRole("region", { name: "Typically" });
  // Half of the last 12 months had $150 of groceries: the median is between.
  await expect(typical.getByRole("row", { name: /A month/ })).toContainText("$75");
});

/** An account's ledger from a date (a partial view), loading either way. The full view: m1. */
import { expect, test, type Page } from "@playwright/test";

import { addTransactions, setUpUser } from "./support.js";

// 450 a day apart from 2024-02-01 (the last 2025-04-25), and the opening balance on 2024-01-01.
const COUNT = 451;

async function longLedger(page: Page) {
  const { book, account } = await setUpUser(page);
  await addTransactions(book.id, account, COUNT - 1);
  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);
  return page.getByRole("list", { name: "Transactions" }).getByRole("listitem");
}

test("going to a date loads from there, then newer above and older below, to all of it", async ({
  page,
}) => {
  const rows = await longLedger(page);
  await expect(rows).toHaveCount(200);

  await page.getByLabel("Go to date").fill("2024-10-01");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page).toHaveURL(/\?date=2024-10-01$/);
  await expect(rows.first()).toContainText("2024-10-01");
  await expect(rows).toHaveCount(200);

  const more = page.getByRole("button", { name: "Load more" });
  await more.click();
  await expect(rows).toHaveCount(400);
  await expect(rows.nth(200)).toContainText("2024-10-01"); // what was on top stays put, below
  await more.click();
  await expect(rows).toHaveCount(406);
  await expect(rows.first()).toContainText("2025-04-25");
  await expect(more).toHaveCount(0);

  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(COUNT);

  await page.getByRole("button", { name: "Back to newest" }).click();
  await expect(page).not.toHaveURL(/date=/);
  await expect(rows).toHaveCount(200);
  await expect(rows.first()).toContainText("2025-04-25");
});

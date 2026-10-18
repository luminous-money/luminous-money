/** M15: dividing an account into parts, moving money between them, and choosing a part. */
import { expect, test } from "@playwright/test";

import { addTransactions, setUpUser } from "./support.js";

test("an account is divided into parts, money moves between them, and a transaction changes part", async ({
  page,
}) => {
  // PNC Checking opened at 1,000.00; Shop 1 and 2 spent 1.00 each.
  const { book, account } = await setUpUser(page);
  await addTransactions(book.id, account, 2);
  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}/edit`);

  const card = page.getByRole("region", { name: "Divided account" });
  await card.getByText(/Divide .*…/).click();
  await card.getByLabel("Part 1", { exact: true }).fill("Padding");
  await card.getByLabel("Part 1's amount").fill("500");
  await card.getByRole("button", { name: "Divide" }).click();

  // Its own page: the parts, the main part marked.
  const parts = page.getByRole("region", { name: "Parts" });
  await expect(parts).toContainText("General");
  await expect(parts).toContainText("$498.00");
  await expect(parts).toContainText("Padding");
  await expect(parts).toContainText("$500.00");
  await expect(parts).toContainText("New money lands here");
  // The whole's ledger: what moved between parts, and which part each touched.
  const transactions = page.getByRole("list", { name: "Transactions" });
  await expect(transactions).toContainText("General → Padding");
  await expect(transactions).toContainText("General · Food:Groceries");

  await parts.getByRole("button", { name: "Move money" }).click();
  const move = page.getByRole("form", { name: "Move money" });
  await move.getByLabel("Amount to move").fill("100");
  await move.getByRole("button", { name: "Move" }).click();
  await expect(parts).toContainText("$398.00");
  await expect(parts).toContainText("$600.00");

  // Shop 1 was paid from Padding, really.
  await transactions.getByRole("button", { name: /Shop 1/ }).click();
  await page.getByRole("combobox", { name: "Paid from" }).selectOption({ label: "Padding" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(parts).toContainText("$399.00");
  await expect(parts).toContainText("$599.00");
});

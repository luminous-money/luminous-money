/** M14: reconciling a statement, the ledger filter, and divided accounts. */
import { expect, test } from "@playwright/test";

import { addTransactions, setUpUser } from "./support.js";

test("a statement is ticked off, saved for later, and finished; ledgers show and filter it", async ({
  page,
}) => {
  // Opened at 1,000.00 on Jan 1; Shop 1 to 3 spend 1.00 each from Feb 1.
  const { book, account } = await setUpUser(page);
  await addTransactions(book.id, account, 3);
  const ledgerUrl = `/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`;
  await page.goto(ledgerUrl);
  await page.getByRole("link", { name: "Reconcile" }).click();

  await page.getByLabel("Statement date").fill("2024-02-29");
  await page.getByLabel("Ending balance").fill("998.00");
  // The opening balance came from a statement: it starts ticked.
  const row = (name: RegExp) => page.getByRole("checkbox", { name });
  await expect(row(/Opening balance/)).toHaveAttribute("aria-checked", "true");
  const finish = page.getByRole("button", { name: "Finish" });
  await expect(finish).toBeDisabled();

  await row(/Shop 1/).click();
  await page.getByRole("button", { name: "Save for later" }).click();
  await expect(page.getByText("Saved: pick it up here any time.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Statement date")).toHaveValue("2024-02-29");
  await expect(row(/Shop 1/)).toHaveAttribute("aria-checked", "true");

  await row(/Shop 2/).click();
  await expect(page.getByRole("region", { name: "Difference" })).toContainText("$0.00");
  // Shop 3, not on it, moves after it.
  await expect(page.getByText("Finishing moves 1 transaction's date")).toBeVisible();
  await finish.click();
  await expect(page.getByText(/Reconciled 3 through Feb 29.* Moved 1/)).toBeVisible();
  const past = page.getByRole("region", { name: "Past statements" });
  await expect(past).toContainText("Feb 29");
  await expect(past.getByRole("button", { name: "Undo" })).toBeVisible();

  await page.goto(ledgerUrl);
  await expect(page.getByText(/Reconciled through Feb 29/)).toBeVisible();
  const transactions = page.getByRole("list", { name: "Transactions" });
  await expect(transactions.getByRole("img", { name: "Reconciled" })).toHaveCount(3);

  // The filter: only what isn't reconciled, kept in the URL; Select all takes just those.
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("radio", { name: "Not reconciled" }).click();
  await expect(page).toHaveURL(/reconciled=no/);
  await expect(transactions.getByRole("listitem")).toHaveCount(1);
  await expect(transactions).toContainText("Shop 3");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByRole("toolbar", { name: "Selected" })).toContainText("1 selected");
  await page.getByRole("button", { name: "Done" }).click();

  // Editing a reconciled transaction asks first.
  await page.getByRole("radio", { name: "All" }).click();
  await transactions.getByRole("button", { name: /Shop 1/ }).click();
  await expect(page.getByText(/Reconciled with PNC Checking's Feb 29.* statement/)).toBeVisible();
  await page.getByLabel("Date", { exact: true }).fill("2024-03-05");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Reconciled" })).toBeVisible();
  await page.getByRole("button", { name: "Save anyway" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("a divided account is reconciled as one; its parts point to it", async ({ page }) => {
  const { session, book } = await setUpUser(page);
  for (const name of ["Assets:PNC:General", "Assets:PNC:Padding"])
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book.id } },
      body: { name, kind: "leaf" },
    });

  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent("Assets:PNC")}/edit`);
  const card = page.getByRole("region", { name: "Divided account" });
  await card.getByRole("checkbox", { name: "One real account, divided" }).check();
  await expect(card.getByRole("link", { name: "Reconcile" })).toBeVisible();

  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent("Assets:PNC:General")}`);
  await expect(page.getByText("a divided account: it's reconciled with it")).toBeVisible();
  await expect(page.getByRole("link", { name: "Reconcile" })).toHaveCount(0);
});

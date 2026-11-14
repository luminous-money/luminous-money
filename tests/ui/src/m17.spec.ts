/** M17: tags, a split's: on a transaction's page, in Select mode, on rows, in ledger filters and
 * reports. */
import { expect, test } from "@playwright/test";

import { addTransactions, setUpUser, splitRows } from "./support.js";

test("a split is tagged on its page; rows show it and the ledger filters by it", async ({
  page,
}) => {
  const { book, account } = await setUpUser(page);
  await addTransactions(book.id, account, 3);
  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);
  const transactions = page.getByRole("list", { name: "Transactions" });
  await transactions.getByRole("button", { name: /Shop 1/ }).click();

  // Each split has its own Tags, in its editor; the groceries' are the second. What's typed is
  // made a tag: lowercase, dashed.
  await expect(splitRows(page)).toHaveCount(2);
  await splitRows(page).nth(1).click();
  const editor = page.getByRole("dialog", { name: "Split", exact: true });
  const tags = editor.getByRole("combobox", { name: "Tags" });
  await tags.fill("Trip to Italy");
  await expect(page.getByRole("option", { name: /#trip-to-italy \(new\)/ })).toBeVisible();
  await tags.press("Enter");
  await expect(editor.getByRole("button", { name: "Remove #trip-to-italy" })).toBeVisible();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(splitRows(page).nth(1)).toContainText("#trip-to-italy");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(splitRows(page).nth(1)).toContainText("#trip-to-italy");
  await expect(splitRows(page).nth(0)).not.toContainText("#trip-to-italy");

  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);
  await expect(transactions.getByRole("button", { name: /Shop 1/ })).toContainText(
    "#trip-to-italy"
  );

  // The filter offers the book's tags, and keeps the choice in the URL.
  await page.getByRole("button", { name: "Filter" }).click();
  const filter = page.getByRole("combobox", { name: "Filter by tag" });
  await filter.fill("trip");
  await filter.press("Enter");
  await expect(page).toHaveURL(/tag=trip-to-italy/);
  await expect(transactions.getByRole("listitem")).toHaveCount(1);
  await expect(transactions).toContainText("Shop 1");
  await page.getByRole("button", { name: "Filter (on)" }).click();
  await expect(page.getByText("Tagged #trip-to-italy only.")).toBeVisible();
  await page.getByRole("button", { name: "Show all" }).click();
  await expect(transactions.getByRole("button", { name: /Shop 3/ })).toBeVisible();
});

test("Select mode adds a tag to several at once, and removes it", async ({ page }) => {
  const { book, account } = await setUpUser(page);
  await addTransactions(book.id, account, 3);
  await page.goto(`/ui/books/${book.id}/transactions`);
  const transactions = page.getByRole("list", { name: "Transactions" });
  await expect(transactions.getByRole("button", { name: /Shop 3/ })).toBeVisible();

  const bar = page.getByRole("toolbar", { name: "Selected" });
  const act = async (label: string) => {
    await bar.getByRole("button", { name: "Actions ▾" }).click();
    await page.getByRole("menuitem", { name: label }).click();
  };
  await page.getByRole("button", { name: "Select", exact: true }).click();
  // Nothing has a tag yet, so there's nothing to remove.
  await transactions.getByRole("checkbox", { name: /Shop 1/ }).click();
  await bar.getByRole("button", { name: "Actions ▾" }).click();
  await expect(page.getByRole("menuitem", { name: /Remove tag…/ })).toBeDisabled();
  await bar.getByRole("button", { name: "Actions ▾" }).click();
  await transactions.getByRole("checkbox", { name: /Shop 2/ }).click();
  await transactions.getByRole("checkbox", { name: /Shop 3/ }).click();

  await act("Add tag…");
  const pick = bar.getByRole("combobox", { name: "Add tag" });
  await pick.fill("reimbursable");
  await pick.press("Enter");
  await expect(bar).toContainText("Tagged 3 transactions #reimbursable.");
  await expect(transactions.getByText("#reimbursable")).toHaveCount(3);

  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await transactions.getByRole("checkbox", { name: /Shop 2/ }).click();
  await act("Remove tag…");
  const remove = bar.getByRole("combobox", { name: "Remove tag" });
  await remove.fill("reim");
  await remove.press("Enter");
  await expect(bar).toContainText("Removed #reimbursable from 1 transaction.");
  await expect(transactions.getByText("#reimbursable")).toHaveCount(2);
  await expect(transactions.getByRole("checkbox", { name: /Shop 2/ })).not.toContainText(
    "#reimbursable"
  );
});

test("Reports filter by tag: All time, the largest tagged, and net worth set aside", async ({
  page,
}) => {
  const { session, book, account } = await setUpUser(page);
  await addTransactions(book.id, account, 1);
  const usd = (number: string) => ({ number, currency: "USD" });
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
    body: { name: "Expenses:Home:Repairs", kind: "leaf" },
  });
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions/batch", {
    params: { path: { book_id: book.id } },
    body: ["120.00", "80.00"].map((amount, i) => ({
      date: `2024-03-0${i + 1}`,
      flag: "*",
      payee: `Hardware ${i + 1}`,
      narration: "",
      postings: [
        { account, units: usd(`-${amount}`) },
        { account: "Expenses:Home:Repairs", tags: ["kitchen"] },
      ],
    })),
  });
  // Groceries bought with a tagged part: only the part counts.
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book.id } },
    body: {
      date: "2024-03-03",
      flag: "*",
      payee: "Hardware 3",
      narration: "",
      postings: [
        { account, units: usd("-40.00") },
        { account: "Expenses:Food:Groceries", units: usd("30.00") },
        { account: "Expenses:Home:Repairs", units: usd("10.00"), tags: ["kitchen"] },
      ],
    },
  });

  await page.goto(`/ui/books/${book.id}/reports`);
  await expect(page.getByRole("region", { name: "Net worth" })).toBeVisible();
  const filter = page.getByRole("combobox", { name: "Filter by tag" });
  // A filter lists the book's tags as soon as it's focused, and says when nothing matches.
  await filter.click();
  await expect(page.getByRole("option", { name: "#kitchen" })).toBeVisible();
  await filter.fill("zzz");
  await expect(page.getByRole("listbox", { name: "Filter by tag" })).toContainText("No tags match");
  await filter.fill("kit");
  // Enter takes the suggestion, once the book's tags have loaded.
  await expect(page.getByRole("option", { name: "#kitchen" })).toBeVisible();
  await filter.press("Enter");
  await expect(page).toHaveURL(/tag=kitchen/);
  await expect(page.getByText("Only splits tagged #kitchen.")).toBeVisible();

  const breakdown = page.getByRole("region", { name: "Breakdown" });
  await expect(breakdown.getByLabel("Show")).toHaveValue("total");
  await expect(breakdown.getByRole("list", { name: "Categories" })).toContainText("Home");
  await expect(breakdown.getByRole("list", { name: "Categories" })).not.toContainText("Food");
  const largest = page.getByRole("region", { name: "Largest transactions" });
  await expect(largest).toContainText("Largest tagged transactions");
  await expect(largest.getByRole("link")).toHaveCount(3);
  await expect(largest).toContainText("Hardware 1");
  await expect(largest).toContainText("$10.00"); // Hardware 3's tagged part
  await expect(page.getByText("Net worth isn't filtered by tag: it's balances.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Net worth" })).toHaveCount(0);

  await page.getByRole("link", { name: "See them" }).click();
  await expect(page).toHaveURL(/transactions\?tag=kitchen/);
  await expect(page.getByRole("list", { name: "Transactions" }).getByRole("listitem")).toHaveCount(
    3
  );
});

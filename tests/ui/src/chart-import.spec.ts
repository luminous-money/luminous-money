/** Importing a chart of accounts: a CSV read into a preview, then added in one write. */
import { expect, test } from "@playwright/test";

import { accounts, setUpUser } from "./support.js";

const CSV = [
  "Account,Display name,Description,Opening balance,As of,Type",
  "expenses:dining out,Eating out,Restaurants and takeout,,,EXPENSE",
  "Expenses:Gifts and giving,,,,,",
  "expenses:gifts and giving:friends,,,,,",
  'liabilities:cards:chase visa,,The travel card,"1,250.00",01/31/2024,LIABILITY',
  "Assets:Bank:PNC-Checking,,,,,",
  "Assets:Bank:PNC-Checking:Padding,,,,,",
  "Stuff:Things,,,,,",
].join("\n");

test("a chart of accounts is previewed with tidied names, then added at once", async ({ page }) => {
  const { book } = await setUpUser(page); // with Assets:Bank:PNC-Checking, a leaf
  await page.goto(`/ui/books/${book.id}/accounts`);
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import a chart of accounts" })).toBeVisible();

  await page.getByLabel("Chart of accounts file").setInputFiles({
    name: "chart.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV),
  });

  const preview = page.getByRole("region", { name: "What it adds" });
  await expect(preview.getByRole("heading", { name: "4 accounts to add" })).toBeVisible();
  for (const text of [
    "Expenses:Dining-Out from “expenses:dining out”",
    "shown as Eating out · Restaurants and takeout",
    "Expenses:Gifts-and-Giving",
    "holds the accounts under it",
    "Expenses:Gifts-and-Giving:Friends",
    "Liabilities:Cards:Chase-Visa",
    "$1,250.00 on Jan 31, 2024",
    "Columns not read: Type.",
  ])
    await expect(preview).toContainText(text);
  const refused = preview.getByRole("region", { name: "Can't be added" });
  await expect(refused).toContainText("2 rows can't be added");
  await expect(refused).toContainText(
    "Assets:Bank:PNC-Checking holds transactions, so it can't have sub-accounts"
  );
  await expect(refused).toContainText("Start with one of");
  await expect(preview.getByRole("region", { name: "Already here" })).toContainText(
    "Assets:Bank:PNC-Checking"
  );

  await preview.getByRole("button", { name: "Add 4 accounts" }).click();
  await expect(page.getByRole("region", { name: "Imported" })).toContainText(
    "Added 4 accounts from chart.csv."
  );
  const added = Object.fromEntries((await accounts(book.id)).map((a) => [a.name, a]));
  expect(added["Expenses:Gifts-and-Giving"]?.kind).toBe("node");
  expect(added["Expenses:Dining-Out"]?.display_name).toBe("Eating out");
  expect(added["Liabilities:Cards:Chase-Visa"]?.open).toBe("2024-01-31");

  await page.getByRole("link", { name: "See them in Accounts" }).click();
  const liabilities = page.getByRole("region", { name: "Liabilities" });
  await liabilities.getByRole("button", { name: "Expand Liabilities:Cards" }).click();
  await expect(liabilities.getByRole("link", { name: /Chase Visa/ })).toContainText("$1,250.00");
  await page.goto(
    `/ui/books/${book.id}/accounts/${encodeURIComponent("Liabilities:Cards:Chase-Visa")}/edit`
  );
  await expect(page.getByText("The travel card")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue("The travel card");
});

test("a description is set in the account's editor", async ({ page }) => {
  const { book, account } = await setUpUser(page);
  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}/edit`);

  await page.getByRole("textbox", { name: "Description" }).fill("Joint, for bills");
  await page.getByRole("form", { name: "Name" }).getByRole("button", { name: "Save" }).click();

  await expect(page.locator(".account-description")).toHaveText("Joint, for bills");
  expect((await accounts(book.id)).find((a) => a.name === account)?.description).toBe(
    "Joint, for bills"
  );
});

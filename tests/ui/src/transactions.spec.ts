/** The Transactions page (every account's): its search and its filter by accounts. */
import { expect, test } from "@playwright/test";

import { importText, setUpUser } from "./support.js";

test("Transactions searches payees, descriptions and items, and filters by any of some accounts", async ({
  page,
}) => {
  const { book } = await setUpUser(page);
  await importText(
    book.id,
    `2024-01-01 open Expenses:Home:Kitchen:Tools
2024-01-01 open Expenses:Home:Garden
2024-01-01 open Expenses:Food
2024-03-01 * "Hardware Barn" "Spatula"
  Assets:Bank:PNC-Checking  -12.00 USD
  Expenses:Home:Kitchen:Tools
2024-03-02 * "Megamart" "Weekly shop"
  Assets:Bank:PNC-Checking  -38.00 USD
  Expenses:Food  30.00 USD
    memo: "Oat milk"
  Expenses:Home:Garden  8.00 USD
    memo: "Seed packets"
2024-03-03 * "Taco Truck" ""
  Assets:Bank:PNC-Checking  -9.00 USD
  Expenses:Food
`
  );
  await page.goto(`/ui/books/${book.id}/transactions`);
  const rows = page.getByRole("list", { name: "Transactions" }).getByRole("listitem");
  await expect(rows).toHaveCount(4); // the opening balance too

  // A split's item, then a payee and a description together.
  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill("seed");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Megamart");
  await expect(page).toHaveURL(/q=seed/);
  await search.fill("hardware spatula");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Hardware Barn");
  await search.fill("nothing like it");
  await expect(page.getByText("No transactions matching “nothing like it”.")).toBeVisible();
  await search.press("Escape");
  await expect(rows).toHaveCount(4);

  // Accounts: any of them, a node taking in what's under it.
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("button", { name: "Filter by account: none" }).click();
  await page.getByRole("combobox", { name: "Filter by account" }).fill("kitchen tools");
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Hardware Barn");
  await page.getByRole("button", { name: "Filter by account: none" }).click();
  await page.getByRole("combobox", { name: "Filter by account" }).fill("expenses food");
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(3);
  await expect(rows).toContainText(["Taco Truck", "Megamart", "Hardware Barn"]);

  await page.getByRole("button", { name: "Remove Expenses:Food" }).click();
  await page.getByRole("button", { name: "Remove Expenses:Home:Kitchen:Tools" }).click();
  await page.getByRole("button", { name: "Filter by account: none" }).click();
  await page.getByRole("combobox", { name: "Filter by account" }).fill("expenses home");
  await page.getByRole("option", { name: "Expenses:Home", exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows).toContainText(["Megamart", "Hardware Barn"]);

  // The search and the filter together, and Back from a transaction keeps both.
  await search.fill("weekly");
  await expect(rows).toHaveCount(1);
  await rows.getByRole("button", { name: /Megamart/ }).click();
  await page.getByRole("link", { name: "‹ Back" }).click();
  await expect(page).toHaveURL(/q=weekly/);
  await expect(page).toHaveURL(/account=Expenses(%3A|:)Home/);
  await expect(search).toHaveValue("weekly");
  await expect(rows).toHaveCount(1);
});

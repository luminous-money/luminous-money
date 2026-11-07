import { expect, test, type Page } from "@playwright/test";

import { problems, seedBook, stageMany, stored, type Seeded } from "./support.js";

let seeded: Seeded;

test.beforeEach(async ({ page }) => {
  seeded = await seedBook(page);
});

const queue = (page: Page) => page.getByRole("article");
const item = (page: Page, payee: string) =>
  page.getByRole("article", { name: new RegExp(`^${payee}`) });

async function openQueue(page: Page) {
  await page.goto(`/ui/books/${seeded.book}/review`);
  await expect(queue(page)).toHaveCount(3);
}

test("the queue is newest first", async ({ page }) => {
  await openQueue(page);
  await expect(queue(page)).toContainText(["Costco", "Grocer", "Corner Cafe"]);
});

test("skip moves an item to the end without changing it", async ({ page }) => {
  await openQueue(page);
  await expect(queue(page).first()).toContainText("Costco");

  await item(page, "Costco").getByRole("button", { name: "Skip" }).click();

  await expect(queue(page).first()).toContainText("Grocer");
  await expect(queue(page).last()).toContainText("Costco");
  const costco = await stored(seeded.book, seeded.ids["Costco"]!);
  expect(costco.flag).toBe("!");
  expect(costco.postings[1]?.account).toBe("Expenses:Uncategorized");

  await page.reload();
  await expect(queue(page).last()).toContainText("Costco");
});

test("an uncategorized item can be confirmed only once it has a category", async ({ page }) => {
  await openQueue(page);
  const coffee = item(page, "Corner Cafe");
  const confirm = coffee.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeDisabled();

  await coffee.getByRole("button", { name: /^Category:/ }).click();
  await coffee.getByRole("combobox", { name: "Category" }).fill("rest");
  await page.keyboard.press("Enter");

  await expect(coffee.getByRole("button", { name: /^Category:/ })).toContainText("Food:Restaurant");
  await expect
    .poll(async () => (await stored(seeded.book, seeded.ids["Corner Cafe"]!)).postings[1]?.account)
    .toBe("Expenses:Food:Restaurant");
  expect((await stored(seeded.book, seeded.ids["Corner Cafe"]!)).flag).toBe("!");

  await confirm.click();

  await expect(queue(page)).toHaveCount(2);
  await expect
    .poll(async () => (await stored(seeded.book, seeded.ids["Corner Cafe"]!)).flag)
    .toBe("*");
});

test("the description is editable in the queue", async ({ page }) => {
  await openQueue(page);
  const description = item(page, "Grocer").getByRole("textbox", { name: "Description" });

  await description.fill("Weekly shop and snacks");
  await description.press("Enter");

  await expect
    .poll(async () => (await stored(seeded.book, seeded.ids["Grocer"]!)).narration)
    .toBe("Weekly shop and snacks");
  expect((await stored(seeded.book, seeded.ids["Grocer"]!)).flag).toBe("!");
});

test("a transaction can be split in the detail view, with one amount left to balance", async ({
  page,
}) => {
  await openQueue(page);
  await item(page, "Costco").getByRole("link", { name: "Split…" }).click();
  await expect(page.getByRole("heading", { name: "Transaction" })).toBeVisible();

  const accounts = page.getByRole("button", { name: /^Account:/ });
  const amounts = page.getByRole("textbox", { name: "Amount" });

  await accounts.nth(1).click();
  await page.getByRole("combobox", { name: "Account" }).fill("groc");
  await page.keyboard.press("Enter");
  await amounts.nth(1).fill("100.00");

  await page.getByRole("button", { name: "+ Add split" }).click();
  await accounts.nth(2).click();
  await page.getByRole("combobox", { name: "Account" }).fill("supplies");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Balanced. The blank amount will be $50.00.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page).toHaveURL(new RegExp(`/ui/books/${seeded.book}/review$`));
  await expect(queue(page)).toHaveCount(2);
  const costco = await stored(seeded.book, seeded.ids["Costco"]!);
  expect(costco.flag).toBe("*");
  expect(costco.postings.map((p) => [p.account, p.units?.number ?? null])).toEqual([
    ["Liabilities:Card", "-150.00"],
    ["Expenses:Food:Groceries", "100.00"],
    ["Expenses:Home:Supplies", null],
  ]);
  expect(await problems(seeded.book)).toEqual([]);
});

test("unbalanced splits can't be saved", async ({ page }) => {
  await openQueue(page);
  await item(page, "Grocer").getByRole("link", { name: "Split…" }).click();

  await page.getByRole("textbox", { name: "Amount" }).nth(1).fill("80.00");

  await expect(page.getByText("Off by -2.10 USD")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Confirm" })).toBeDisabled();
});

/** Where a card's top is on screen. */
const topOf = async (page: Page, payee: string) => (await item(page, payee).boundingBox())!.y;

test("Back or Confirm on a transaction opened from the queue comes back to where it was", async ({
  page,
}) => {
  await stageMany(seeded.book, 20);
  await page.goto(`/ui/books/${seeded.book}/review`);
  await expect(queue(page)).toHaveCount(23);
  // Two skipped go to the end, as they did when Back came out at the bottom.
  await item(page, "Shop 20").getByRole("button", { name: "Skip" }).click();
  await item(page, "Shop 19").getByRole("button", { name: "Skip" }).click();
  await expect(queue(page).last()).toContainText("Shop 19");

  await item(page, "Shop 8").scrollIntoViewIfNeeded();
  const before = await topOf(page, "Shop 8");
  await item(page, "Shop 8").getByRole("link", { name: "Split…" }).click();
  await expect(page.getByRole("heading", { name: "Transaction" })).toBeVisible();
  await page.getByRole("link", { name: "‹ Back" }).click();
  await expect(item(page, "Shop 8")).toBeInViewport();
  expect(Math.abs((await topOf(page, "Shop 8")) - before)).toBeLessThan(4);

  // Confirmed there, the one after it comes back in its place.
  await item(page, "Shop 8").getByRole("link", { name: "Split…" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(queue(page)).toHaveCount(22);
  await expect(item(page, "Shop 7")).toBeInViewport();
  await expect.poll(async () => Math.abs((await topOf(page, "Shop 7")) - before)).toBeLessThan(4);
});

test("a search and a filter by accounts narrow the queue, and Back keeps them", async ({
  page,
}) => {
  await openQueue(page);
  const search = page.getByRole("searchbox", { name: "Search" });

  // Payees and descriptions, every word.
  await search.fill("weekly shop");
  await expect(queue(page)).toHaveCount(1);
  await expect(queue(page)).toContainText("Grocer");
  await expect(page).toHaveURL(/q=weekly/);
  await expect(page.getByText("1 of 3 left")).toBeVisible();
  await search.fill("bulk nothing");
  await expect(
    page.getByText("No transactions matching “bulk nothing” waiting for review.")
  ).toBeVisible();
  await search.fill("");
  await expect(queue(page)).toHaveCount(3);

  // Accounts: any of them, nodes taking in what's under them.
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("button", { name: "Filter by account: none" }).click();
  await page.getByRole("combobox", { name: "Filter by account" }).fill("liabilities card");
  await page.keyboard.press("Enter");
  await expect(queue(page)).toHaveCount(2);
  await expect(queue(page)).toContainText(["Costco", "Corner Cafe"]);
  await page.getByRole("button", { name: "Filter by account: none" }).click();
  await page.getByRole("combobox", { name: "Filter by account" }).fill("expenses food");
  await page.getByRole("option", { name: "Expenses:Food", exact: true }).click();
  await expect(queue(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Remove Liabilities:Card" }).click();
  await expect(queue(page)).toHaveCount(1);
  await expect(queue(page)).toContainText("Grocer");
  await expect(page).toHaveURL(/account=Expenses(%3A|:)Food/);

  // Back from a transaction keeps the filter.
  await item(page, "Grocer").getByRole("link", { name: "Split…" }).click();
  await page.getByRole("link", { name: "‹ Back" }).click();
  await expect(page).toHaveURL(/account=Expenses(%3A|:)Food/);
  await expect(queue(page)).toHaveCount(1);
  await expect(page.getByText("In Expenses:Food only.")).toBeVisible();
  await page.getByRole("button", { name: "Show all" }).click();
  await expect(queue(page)).toHaveCount(3);
});

test("a card is tagged where it is", async ({ page }) => {
  await openQueue(page);
  const tags = item(page, "Grocer").getByRole("combobox", { name: "Tags" });
  await tags.fill("Weekly Run");
  await tags.press("Enter");
  await expect(
    item(page, "Grocer").getByRole("button", { name: "Remove #weekly-run" })
  ).toBeVisible();
  await expect
    .poll(async () => (await stored(seeded.book, seeded.ids["Grocer"]!)).tags)
    .toEqual(["weekly-run"]);
  expect((await stored(seeded.book, seeded.ids["Grocer"]!)).flag).toBe("!");
});

test("a chosen account's name can be edited into a new account's", async ({ page }) => {
  await openQueue(page);
  const grocer = item(page, "Grocer");
  await grocer.getByRole("button", { name: /^Category:/ }).click();
  const search = grocer.getByRole("combobox", { name: "Category" });
  await expect(search).toHaveValue("Expenses:Food:Groceries");
  // Listed as it was, the chosen one first.
  await expect(grocer.getByRole("option").first()).toHaveText("Expenses:Food:Groceries");

  await search.press("End");
  for (const _ of "Groceries") await search.press("Backspace");
  await search.pressSequentially("Snacks");
  await expect(
    grocer.getByRole("option", { name: "+ Create account “Expenses:Food:Snacks”" })
  ).toBeVisible();
  await search.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Create account" });
  await expect(dialog.getByRole("combobox")).toHaveValue("Expenses:Food:Snacks");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(grocer.getByRole("button", { name: /^Category:/ })).toContainText("Food:Snacks");
  await expect
    .poll(async () => (await stored(seeded.book, seeded.ids["Grocer"]!)).postings[1]?.account)
    .toBe("Expenses:Food:Snacks");

  // Tab fills in the account searched for, to edit from.
  const cafe = item(page, "Corner Cafe");
  await cafe.getByRole("button", { name: /^Category:/ }).click();
  const other = cafe.getByRole("combobox", { name: "Category" });
  await expect(other).toHaveValue("");
  await other.fill("restaurant");
  await other.press("Tab");
  await expect(other).toHaveValue("Expenses:Food:Restaurant");
  await expect(other).toBeFocused();
});

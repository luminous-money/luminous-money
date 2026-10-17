import { expect, test, type Page } from "@playwright/test";

import { problems, seedBook, stored, type Seeded } from "./support.js";

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

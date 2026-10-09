import { expect, test, type Locator, type Page } from "@playwright/test";

import { accounts, seedBook, stored, type Seeded } from "./support.js";

let seeded: Seeded;

test.beforeEach(async ({ page }) => {
  seeded = await seedBook();
  await page.goto(`/ui/books/${seeded.book}/review`);
  await expect(page.getByRole("article")).toHaveCount(3);
});

const coffee = (page: Page) => page.getByRole("article", { name: /^Corner Cafe/ });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Create account" });
const nameField = (page: Page) => dialog(page).getByRole("textbox", { name: "Account" });

async function startCreating(page: Page, card: Locator, search: string) {
  await card.getByRole("button", { name: /^Category:/ }).click();
  await card.getByRole("combobox", { name: "Category" }).fill(search);
  await card.getByRole("option", { name: /Create account/ }).click();
  await expect(dialog(page)).toBeVisible();
}

test("the dropdown always ends with Create account", async ({ page }) => {
  const options = coffee(page).getByRole("option");

  await coffee(page)
    .getByRole("button", { name: /^Category:/ })
    .click();
  await coffee(page).getByRole("combobox", { name: "Category" }).fill("groc");
  await expect(options).toHaveText(["Expenses:Food:Groceries", "+ Create account “groc”"]);

  await coffee(page).getByRole("combobox", { name: "Category" }).fill("zzz");
  await expect(options).toHaveText(["+ Create account “zzz”"]);
});

test("the search becomes a full account name under the preferred root", async ({ page }) => {
  await startCreating(page, coffee(page), "Groceries");

  await expect(nameField(page)).toHaveValue("Expenses:Groceries");
  await expect(dialog(page)).toContainText("Expense account");
});

test("editing the full name and creating a leaf selects it for the card", async ({ page }) => {
  await startCreating(page, coffee(page), "coffee shops");
  await expect(nameField(page)).toHaveValue("Expenses:Coffee-Shops");

  await nameField(page).fill("Expenses:Food:Coffee-Shops");
  await dialog(page).getByRole("button", { name: "Create" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(coffee(page).getByRole("button", { name: /^Category:/ })).toContainText(
    "Food:Coffee-Shops"
  );
  await expect
    .poll(async () => (await stored(seeded.book, seeded.ids["Corner Cafe"]!)).postings[1]?.account)
    .toBe("Expenses:Food:Coffee-Shops");
  const created = (await accounts(seeded.book)).find(
    (a) => a.name === "Expenses:Food:Coffee-Shops"
  );
  expect(created?.kind).toBe("leaf");
});

test("names the ledger would refuse are explained and can't be created", async ({ page }) => {
  await startCreating(page, coffee(page), "x");
  const create = dialog(page).getByRole("button", { name: "Create" });

  for (const [name, reason] of [
    ["Expenses:Food:Groceries:Organic", "Expenses:Food:Groceries holds transactions"],
    ["Expenses:Food:Groceries", "already exists"],
    ["Stuff:Things", "Start with one of"],
    ["Expenses:coffee", "isn't valid"],
  ]) {
    await nameField(page).fill(name!);
    await expect(dialog(page)).toContainText(reason!);
    await expect(create).toBeDisabled();
  }

  await nameField(page).fill("Expenses:Home:Garden:Tools");
  await expect(dialog(page)).toContainText("also adds Expenses:Home:Garden to hold it");
  await expect(create).toBeEnabled();
});

test("cancelling returns to the dropdown as it was", async ({ page }) => {
  await startCreating(page, coffee(page), "zzz");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();

  await expect(dialog(page)).toBeHidden();
  const search = coffee(page).getByRole("combobox", { name: "Category" });
  await expect(search).toHaveValue("zzz");
  await expect(search).toBeFocused();
  await expect(coffee(page).getByRole("option")).toHaveText(["+ Create account “zzz”"]);
});

test("a new node can't be picked, so the search moves into it for a leaf", async ({ page }) => {
  await startCreating(page, coffee(page), "utilities");
  await expect(nameField(page)).toHaveValue("Expenses:Utilities");
  await dialog(page)
    .getByRole("radio", { name: /Sub-accounts/ })
    .check();
  await dialog(page).getByRole("button", { name: "Create" }).click();

  const search = coffee(page).getByRole("combobox", { name: "Category" });
  await expect(search).toHaveValue("Expenses:Utilities:");
  await search.fill("Expenses:Utilities:power");
  await coffee(page)
    .getByRole("option", { name: /Create account/ })
    .click();

  await expect(nameField(page)).toHaveValue("Expenses:Utilities:Power");
  await dialog(page).getByRole("button", { name: "Create" }).click();

  await expect(coffee(page).getByRole("button", { name: /^Category:/ })).toContainText(
    "Utilities:Power"
  );
  const tree = await accounts(seeded.book);
  expect(tree.find((a) => a.name === "Expenses:Utilities")?.kind).toBe("node");
  expect(tree.find((a) => a.name === "Expenses:Utilities:Power")?.kind).toBe("leaf");
});

test("the dialog is full screen on a phone", async ({ page }) => {
  await startCreating(page, coffee(page), "x");

  const box = (await dialog(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, viewport.width, viewport.height]);
});

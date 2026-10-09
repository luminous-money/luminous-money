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

async function searchCategory(page: Page, card: Locator, text: string) {
  await card.getByRole("button", { name: /^Category:/ }).click();
  await card.getByRole("combobox", { name: "Category" }).fill(text);
}

async function chooseParent(page: Page, text: string) {
  await dialog(page)
    .getByRole("button", { name: /^Parent:/ })
    .click();
  await dialog(page).getByRole("combobox", { name: "Parent" }).fill(text);
  await page.keyboard.press("Enter");
}

test("the dropdown always ends with Create account", async ({ page }) => {
  const options = coffee(page).getByRole("option");

  await searchCategory(page, coffee(page), "groc");
  await expect(options).toHaveText(["Expenses:Food:Groceries", "+ Create account “groc”"]);

  await coffee(page).getByRole("combobox", { name: "Category" }).fill("zzz");
  await expect(options).toHaveText(["+ Create account “zzz”"]);
});

test("creating a leaf selects it for the card", async ({ page }) => {
  await searchCategory(page, coffee(page), "coffee shops");
  await coffee(page)
    .getByRole("option", { name: /Create account/ })
    .click();

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("textbox", { name: "Name" })).toHaveValue("Coffee-Shops");
  await expect(dialog(page).getByRole("button", { name: "Create" })).toBeDisabled(); // a parent is required

  await chooseParent(page, "food");
  await expect(dialog(page)).toContainText("Expense account");
  await expect(dialog(page)).toContainText("Creates Expenses:Food:Coffee-Shops");
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

test("cancelling returns to the dropdown as it was", async ({ page }) => {
  await searchCategory(page, coffee(page), "zzz");
  await coffee(page)
    .getByRole("option", { name: /Create account/ })
    .click();
  await dialog(page).getByRole("button", { name: "Cancel" }).click();

  await expect(dialog(page)).toBeHidden();
  const search = coffee(page).getByRole("combobox", { name: "Category" });
  await expect(search).toHaveValue("zzz");
  await expect(search).toBeFocused();
  await expect(coffee(page).getByRole("option")).toHaveText(["+ Create account “zzz”"]);
});

test("a new node can't be picked, so the search moves into it for a leaf", async ({ page }) => {
  await searchCategory(page, coffee(page), "utilities");
  await coffee(page)
    .getByRole("option", { name: /Create account/ })
    .click();
  await chooseParent(page, "expenses");
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

  await expect(dialog(page).getByRole("textbox", { name: "Name" })).toHaveValue("Power");
  await expect(dialog(page).getByRole("button", { name: /^Parent:/ })).toContainText(
    "Expenses:Utilities"
  );
  await dialog(page).getByRole("button", { name: "Create" }).click();

  await expect(coffee(page).getByRole("button", { name: /^Category:/ })).toContainText(
    "Utilities:Power"
  );
  const tree = await accounts(seeded.book);
  expect(tree.find((a) => a.name === "Expenses:Utilities")?.kind).toBe("node");
  expect(tree.find((a) => a.name === "Expenses:Utilities:Power")?.kind).toBe("leaf");
});

test("parents are nodes only, and their picker can't create", async ({ page }) => {
  await searchCategory(page, coffee(page), "snacks");
  await coffee(page)
    .getByRole("option", { name: /Create account/ })
    .click();
  await dialog(page)
    .getByRole("button", { name: /^Parent:/ })
    .click();
  const parents = dialog(page).getByRole("listbox", { name: "Parent" });

  await dialog(page).getByRole("combobox", { name: "Parent" }).fill("food");
  await expect(parents.getByRole("option")).toHaveText(["Expenses:Food"]); // not its leaves

  await dialog(page).getByRole("combobox", { name: "Parent" }).fill("groceries");
  await expect(parents.getByRole("option")).toHaveCount(0);
  await expect(parents).toContainText("No matching accounts");
});

test("the dialog is full screen on a phone", async ({ page }) => {
  await searchCategory(page, coffee(page), "x");
  await coffee(page)
    .getByRole("option", { name: /Create account/ })
    .click();

  const box = (await dialog(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, viewport.width, viewport.height]);
});

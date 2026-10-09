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
const nameField = (page: Page) => dialog(page).getByRole("combobox", { name: "Account" });

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
  await expect(nameField(page)).toHaveValue("Expenses:Coffee-shops");

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

test("a typed path keeps its colons, with each part tidied up", async ({ page }) => {
  await startCreating(page, coffee(page), "Gifts and Giving:Friends");

  await expect(nameField(page)).toHaveValue("Expenses:Gifts-and-Giving:Friends");
  await expect(dialog(page)).toContainText("also creates Expenses:Gifts-and-Giving");
  await dialog(page).getByRole("button", { name: "Create" }).click();

  await expect(coffee(page).getByRole("button", { name: /^Category:/ })).toContainText(
    "Gifts-and-Giving:Friends"
  );
  const tree = await accounts(seeded.book);
  expect(tree.find((a) => a.name === "Expenses:Gifts-and-Giving")?.kind).toBe("node");
  expect(tree.find((a) => a.name === "Expenses:Gifts-and-Giving:Friends")?.kind).toBe("leaf");
});

test("names the ledger would refuse are explained and can't be created", async ({ page }) => {
  await startCreating(page, coffee(page), "x");
  const create = dialog(page).getByRole("button", { name: "Create" });

  for (const [name, reason] of [
    ["Expenses:Food:Groceries:Organic", "Expenses:Food:Groceries holds transactions"],
    ["Expenses:Food:Groceries", "already exists"],
    ["Expenses:Food", "can't hold transactions"],
    ["Stuff:Things", "Start with one of"],
  ]) {
    await nameField(page).fill(name!);
    await expect(dialog(page)).toContainText(reason!);
    await expect(create).toBeDisabled();
  }
});

test("typing turns spaces into dashes and capitalizes each part", async ({ page }) => {
  await startCreating(page, coffee(page), "x");

  await nameField(page).fill("");
  await nameField(page).pressSequentially("expenses:late night snacks");

  await expect(nameField(page)).toHaveValue("Expenses:Late-night-snacks");
  await expect(dialog(page).getByRole("button", { name: "Create" })).toBeEnabled();
});

test("there's no leaf or node choice: it's a leaf, with nodes created on the way", async ({
  page,
}) => {
  await startCreating(page, coffee(page), "x");
  await expect(dialog(page).getByRole("radio")).toHaveCount(0);

  await nameField(page).fill("Expenses:Home:Garden:Tools");
  await expect(dialog(page)).toContainText("also creates Expenses:Home:Garden");
  await dialog(page).getByRole("button", { name: "Create" }).click();

  await expect(coffee(page).getByRole("button", { name: /^Category:/ })).toContainText(
    "Garden:Tools"
  );
  const tree = await accounts(seeded.book);
  expect(tree.find((a) => a.name === "Expenses:Home:Garden:Tools")?.kind).toBe("leaf");
  expect(tree.find((a) => a.name === "Expenses:Home:Garden")).toMatchObject({
    kind: "node",
    implicit: false,
  });
});

test("Tab fills in the next portion of a matching node, again and again", async ({ page }) => {
  await startCreating(page, coffee(page), "x");
  const suggestions = dialog(page).getByRole("listbox", { name: "Accounts to continue into" });

  await nameField(page).fill("exp");
  await expect(suggestions.getByRole("option").first()).toHaveText(/Expenses/);
  await nameField(page).press("Tab");
  await expect(nameField(page)).toHaveValue("Expenses");

  // Expenses:Food has no nodes under it, so this fills to the end of its name.
  await nameField(page).press("Tab");
  await expect(nameField(page)).toHaveValue("Expenses:Food");
  await expect(nameField(page)).toBeFocused();

  // Nothing further matches, so Tab does what Tab normally does (no keyboard trap).
  await nameField(page).press("Tab");
  await expect(nameField(page)).toHaveValue("Expenses:Food");
  await expect(nameField(page)).not.toBeFocused();

  await nameField(page).click();
  await nameField(page).press("End");
  await nameField(page).pressSequentially(":coffee");
  await expect(nameField(page)).toHaveValue("Expenses:Food:Coffee");
});

test("tapping a suggestion fills in its next portion", async ({ page }) => {
  await startCreating(page, coffee(page), "x");
  await nameField(page).fill("Expenses:");

  await dialog(page)
    .getByRole("option", { name: /Expenses:Home/ })
    .click();

  await expect(nameField(page)).toHaveValue("Expenses:Home");
  await expect(nameField(page)).toBeFocused();
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

test("the dialog is full screen on a phone", async ({ page }) => {
  await startCreating(page, coffee(page), "x");

  const box = (await dialog(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, viewport.width, viewport.height]);
});

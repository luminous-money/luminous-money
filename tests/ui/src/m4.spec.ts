/** M4: categorization in review. */
import { expect, test, type Page } from "@playwright/test";

import { setUpUser } from "./support.js";

const usd = (number: string) => ({ number, currency: "USD" });

/** A user with categories, a confirmed coffee to learn from, and `unconfirmed` uncategorized ones. */
async function withUnconfirmed(page: Page, unconfirmed: string[]) {
  const { session, book, account } = await setUpUser(page);
  const post = <T>(path: string, body: T) =>
    session.ledger.POST(path as never, { params: { path: { book_id: book.id } }, body } as never);
  for (const name of ["Expenses:Food:Coffee", "Expenses:Food:Tea", "Expenses:Uncategorized"]) {
    await post("/api/ledger/v1/books/{book_id}/accounts", {
      name,
      kind: "leaf",
      opening_balance: null,
    });
  }
  const add = (narration: string, flag: string, other: string) =>
    post("/api/ledger/v1/books/{book_id}/transactions", {
      date: "2024-02-01",
      flag,
      payee: flag === "*" ? "Corner Cafe" : null,
      narration,
      postings: [{ account, units: usd("-4.50") }, { account: other }],
    });
  await add("CORNER CAFE", "*", "Expenses:Food:Coffee");
  for (const narration of unconfirmed) await add(narration, "!", "Expenses:Uncategorized");
  await page.goto(`/ui/books/${book.id}/review`);
  return { book };
}

test("Suggest categories fills in a category and says where it came from", async ({ page }) => {
  await withUnconfirmed(page, ["CORNER CAFE #57"]);

  await page.getByRole("button", { name: "Suggest categories" }).click();

  await expect(page.getByText("Suggested categories for 1.")).toBeVisible();
  const card = page.getByRole("article");
  await expect(card).toContainText("Suggested by history (50%)");
  await expect(card.getByRole("button", { name: /^Category:/ })).toContainText("Food:Coffee");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("All caught up")).toBeVisible();
});

test("picking a category offers it to similar unconfirmed transactions in the account", async ({
  page,
}) => {
  await withUnconfirmed(page, ["TEA HOUSE #1", "TEA HOUSE #2", "TEA HOUSE #3", "SOMEWHERE ELSE"]);
  const first = page.getByRole("article", { name: /TEA HOUSE #1/ });

  await first.getByRole("button", { name: /^Category:/ }).click();
  await page.getByRole("combobox", { name: "Category" }).fill("tea");
  await page.keyboard.press("Enter");
  await first.getByRole("button", { name: "Yes", exact: true }).click();

  await expect(page.getByRole("article").filter({ hasText: "Food:Tea" })).toHaveCount(3);
  await expect(page.getByRole("article", { name: /SOMEWHERE ELSE/ })).not.toContainText("Food:Tea");
});

test("Remember as a rule makes a rule from a card, and offers to apply it", async ({ page }) => {
  const { book } = await withUnconfirmed(page, ["TEA HOUSE #1", "TEA HOUSE #2"]);
  const first = page.getByRole("article").first();
  await first.getByRole("button", { name: /^Category:/ }).click();
  await page.getByRole("combobox", { name: "Category" }).fill("tea");
  await page.keyboard.press("Enter");
  await first.getByRole("button", { name: "No", exact: true }).click();

  await first.getByRole("link", { name: "Remember as a rule…" }).click();
  await expect(page.getByRole("heading", { name: "New rule" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Has the payee key/ })).toHaveValue("tea house");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Apply to 1" }).click();

  await expect(page.getByRole("article").filter({ hasText: "Food:Tea" })).toHaveCount(2);
  await page.goto(`/ui/books/${book.id}/rules`);
  await expect(page.getByRole("region", { name: "Your rules" })).toContainText(
    'payee like "tea house"'
  );
});

test("Select mode categorizes and confirms several at once", async ({ page }) => {
  await withUnconfirmed(page, ["ONE", "TWO", "THREE"]);

  await page.getByRole("button", { name: "Select" }).click();
  const boxes = page.getByRole("checkbox", { name: "Select" });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  const bar = page.getByRole("toolbar", { name: "Selected" });
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: /^Categorize as:/ }).click();
  await page.getByRole("combobox", { name: "Categorize as" }).fill("tea");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("article").filter({ hasText: "Food:Tea" })).toHaveCount(2);
  await bar.getByRole("button", { name: "Confirm 2" }).click();

  await expect(page.getByRole("article")).toHaveCount(1);
});

test("in Select mode, tapping anywhere on a card selects it, and its own controls are off", async ({
  page,
}) => {
  await withUnconfirmed(page, ["ONE", "TWO"]);
  await page.getByRole("button", { name: "Select" }).click();
  const bar = page.getByRole("toolbar", { name: "Selected" });

  const first = page.getByRole("article").first();
  await first.click({ position: { x: 60, y: 150 } }); // over the category picker
  await expect(bar).toContainText("1 selected");
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveCount(0); // didn't open
  await first.click();
  await expect(bar).toContainText("0 selected");
  await bar.getByRole("button", { name: "Done" }).click();
  await expect(bar).toHaveCount(0);
});

test("an account's ledger suggests categories, and categorizes and confirms in bulk", async ({
  page,
}) => {
  const { book } = await withUnconfirmed(page, ["CORNER CAFE #9", "TEA ONE", "TEA TWO"]);
  await page.goto(
    `/ui/books/${book.id}/accounts/${encodeURIComponent("Assets:Bank:PNC-Checking")}`
  );

  await page.getByRole("button", { name: "Suggest categories" }).click();
  await expect(page.getByText("Suggested categories for 1.")).toBeVisible();
  const list = page.getByRole("list", { name: "Transactions" });
  // Now with history's clean payee, and its category.
  await expect(list.getByRole("button", { name: /Corner Cafe.*unconfirmed/ })).toContainText(
    "Food:Coffee"
  );

  await page.getByRole("button", { name: "Select" }).click();
  await list.getByRole("checkbox", { name: /TEA ONE/ }).click();
  await list.getByRole("checkbox", { name: /TEA TWO/ }).click();
  const bar = page.getByRole("toolbar", { name: "Selected" });
  await expect(bar).toContainText("2 selected");
  await expect(bar.getByRole("button", { name: "Confirm 2" })).toBeDisabled(); // uncategorized
  await bar.getByRole("button", { name: /^Categorize as:/ }).click();
  await page.getByRole("combobox", { name: "Categorize as" }).fill("tea");
  await page.keyboard.press("Enter");
  await expect(list.getByRole("checkbox", { name: /TEA ONE/ })).toContainText("Food:Tea");
  await bar.getByRole("button", { name: "Confirm 2" }).click();

  await expect(list.getByRole("checkbox", { name: /TEA ONE/ })).not.toContainText("unconfirmed");
  await expect(list.getByRole("checkbox", { name: /TEA TWO/ })).not.toContainText("unconfirmed");
});

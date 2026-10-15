/** M6: several books, each the context for everything while it's selected. */
import { expect, test, type Page } from "@playwright/test";

import { accounts, addAccount, app, setUpUser } from "./support.js";

/** A second book for the current user, with a starred account. */
async function addBook(name: string, account: string) {
  const response = await app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, time_zone: "America/Chicago" }),
  });
  const book = (await response.json()) as { id: string };
  await addAccount(book.id, account, "50.00");
  return book;
}

const switchTo = async (page: Page, name: string) => {
  await page.getByRole("button", { name: /Switch books/ }).click();
  await page.getByRole("navigation", { name: "Books" }).getByRole("link", { name }).click();
};

const homeCards = (page: Page) => page.getByRole("region", { name: "Accounts" });

test("switching books shows the other book's data everywhere, and / returns to it", async ({
  page,
}) => {
  const { book } = await setUpUser(page);
  const household = await addBook("Household", "Assets:Bank:Joint-Checking");
  await page.goto("/ui/");
  await expect(page).toHaveURL(new RegExp(`/ui/books/${book.id}$`));
  await expect(homeCards(page)).toContainText("PNC Checking");

  await switchTo(page, "Household");

  await expect(page).toHaveURL(new RegExp(`/ui/books/${household.id}$`));
  await expect(page.getByRole("heading", { name: "Household" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Switch books/ })).toHaveText(/Household/);
  await expect(homeCards(page)).toContainText("Joint Checking");
  await expect(homeCards(page)).not.toContainText("PNC Checking");

  await page.getByRole("button", { name: "Menu" }).click();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Review" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/ui/books/${household.id}/review$`));

  await page.goto("/ui/");
  await expect(page).toHaveURL(new RegExp(`/ui/books/${household.id}$`));
});

test("a book that isn't yours is nothing", async ({ page }) => {
  await setUpUser(page);
  await page.goto("/ui/books/not-a-book/review");
  await expect(page.getByText("Nothing here.")).toBeVisible();
});

test("a new book is created in Manage books and opens", async ({ page }) => {
  await setUpUser(page);
  await page.goto("/ui/books");

  await page.getByRole("textbox", { name: "New book's name" }).fill("Side business");
  await page.getByRole("button", { name: "Create book" }).click();

  await expect(page).toHaveURL(/\/ui\/books\/[0-9a-f]{32}$/);
  await expect(page.getByRole("heading", { name: "Side business" })).toBeVisible();
  await expect(page.getByText("No starred accounts yet")).toBeVisible();

  await page.goto("/ui/books");
  await page.getByRole("textbox", { name: "New book's name" }).fill("side BUSINESS");
  await page.getByRole("button", { name: "Create book" }).click();
  await expect(page.getByText("you already have a book named")).toBeVisible();
});

test("a book is deleted only once its name is typed", async ({ page }) => {
  await setUpUser(page);
  await addBook("Household", "Assets:Bank:Joint-Checking");
  await page.goto("/ui/books");

  await page
    .getByRole("region", { name: "Books" })
    .locator(".book", { hasText: "Household" })
    .getByRole("button", { name: "Delete" })
    .click();
  const confirm = page.getByRole("form", { name: "Delete Household" });
  await expect(confirm.getByRole("link", { name: "Export it first" })).toBeVisible();
  const deleteForGood = confirm.getByRole("button", { name: "Delete for good" });
  await expect(deleteForGood).toBeDisabled();
  await confirm.getByRole("textbox", { name: "Name of the book to delete" }).fill("household");
  await expect(deleteForGood).toBeDisabled();
  await confirm.getByRole("textbox", { name: "Name of the book to delete" }).fill("Household");
  await deleteForGood.click();

  await expect(page.getByRole("heading", { name: "Household" })).toBeHidden();
  await page.getByRole("button", { name: /Switch books/ }).click();
  await expect(page.getByRole("navigation", { name: "Books" }).getByRole("link")).toHaveText([
    /Kael Personal/,
    "Manage books",
  ]);
});

test("deleting your last book goes back to setup", async ({ page }) => {
  await setUpUser(page);
  await page.goto("/ui/books");

  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("textbox", { name: "Name of the book to delete" }).fill("Kael Personal");
  await page.getByRole("button", { name: "Delete for good" }).click();

  await expect(page.getByRole("heading", { name: "Let's set up your books" })).toBeVisible();
});

test("an export restores as a new book", async ({ page }) => {
  await setUpUser(page);
  await page.goto("/ui/books");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export" }).click(),
  ]);

  await page.getByLabel("Beancount file").setInputFiles(await download.path());
  await expect(page.getByRole("textbox", { name: "New book's name" })).toHaveValue(
    "Kael Personal (restored)"
  );
  await page.getByRole("button", { name: "Create book" }).click();

  await expect(page.getByRole("heading", { name: "Kael Personal (restored)" })).toBeVisible();
  const restored = /\/ui\/books\/([0-9a-f]{32})$/.exec(page.url())![1]!;
  expect((await accounts(restored)).map((a) => a.name)).toContain("Assets:Bank:PNC-Checking");
});

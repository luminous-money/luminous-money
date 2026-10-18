/** M16: setting a book's AI up, capturing a receipt from a file, and reviewing it. */
import { expect, test } from "@playwright/test";

import { setUpUser } from "./support.js";

// A tiny JPEG (a white pixel), as a file to upload.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  "base64"
);

test("a receipt is captured from a file, read, and reviewed, coming back where it started", async ({
  page,
}) => {
  const { session, book, account } = await setUpUser(page);
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
    body: { name: "Expenses:Food:Groceries", kind: "leaf" },
  });
  await page.goto(`/ui/books/${book.id}/ai`);
  // Saved as it's ticked: checked once the service has it.
  const use = page.getByLabel("Use AI in this book");
  await use.click();
  await expect(use).toBeChecked();
  await page.getByRole("combobox", { name: "Provider" }).selectOption("fake");
  await expect(page.getByText(/Ready: the camera/)).toBeVisible();

  // From the account's page, the masthead's camera takes the account as the hint.
  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);
  await page.getByRole("link", { name: "Capture a receipt" }).click();
  await page.getByLabel("Upload a receipt").setInputFiles({
    name: "jewel.jpg",
    mimeType: "image/jpeg",
    buffer: JPEG,
  });
  await expect(page.getByRole("img", { name: "The receipt" })).toBeVisible();
  await page.getByRole("button", { name: "Create transaction" }).click();

  // It's in review, alone; confirming it comes back to the account.
  const item = page.getByRole("list").filter({ hasText: "Fake Store" });
  await expect(item).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).first().click();
  await expect(page).toHaveURL((url) =>
    decodeURIComponent(url.pathname).endsWith(`/accounts/${account}`)
  );
  await expect(page.getByRole("list", { name: "Transactions" })).toContainText("Fake Store");
});

test("a receipt that isn't read waits in review for the account it was paid from", async ({
  page,
}) => {
  const { session, book } = await setUpUser(page);
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
    body: { name: "Expenses:Food:Groceries", kind: "leaf" },
  });
  // The book has no AI: it's made from what's typed, paid from an account still to choose.
  await page.goto(`/ui/books/${book.id}/receipt`);
  await page.getByLabel("Upload a receipt").setInputFiles({
    name: "cafe.jpg",
    mimeType: "image/jpeg",
    buffer: JPEG,
  });
  await page.getByText("Add what you know").click();
  await page.getByLabel("Total").fill("8.50");
  await page.getByLabel("Payee").fill("Cafe");
  await page.getByRole("button", { name: "Create transaction" }).click();

  const item = page.getByRole("article").filter({ hasText: "Cafe" });
  const confirm = item.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeDisabled();
  await item.getByRole("button", { name: /^Paid from/ }).click();
  await item.getByRole("combobox", { name: "Paid from" }).fill("pnc");
  await page.keyboard.press("Enter");
  await expect(item.getByRole("button", { name: /^Paid from/ })).toHaveCount(0);
  await item.getByRole("button", { name: /^Category/ }).click();
  await item.getByRole("combobox", { name: "Category" }).fill("groc");
  await page.keyboard.press("Enter");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith(`/books/${book.id}`));
});

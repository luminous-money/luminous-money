/** M16: setting a book's AI up, capturing a receipt from a file, and reviewing it (its splits
 * too); a receipt read into the bank's copy, or into a transaction from its page; an iPhone's
 * photo kept as a JPEG; an account's payment cards. */
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { accounts, setUpUser, stored } from "./support.js";

// A tiny JPEG (a white pixel), as a file to upload.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  "base64"
);

// A synthetic HEIC (as an iPhone's photos are), the app's own test fixture.
const HEIC = readFileSync(
  new URL("../../../services/app/src/server/fixtures/receipt.heic", import.meta.url)
);

/** Turn the book's AI on with the fake provider: it reads every receipt as Fake Store's, 12.34
 * today, in two lines. */
async function fakeAi(page: Page, book: string) {
  await page.goto(`/ui/books/${book}/ai`);
  // Saved as it's ticked: checked once the service has it.
  const use = page.getByLabel("Use AI in this book");
  await use.click();
  await expect(use).toBeChecked();
  await page.getByRole("combobox", { name: "Provider" }).selectOption("fake");
  await expect(page.getByText(/Ready: the camera/)).toBeVisible();
}

/** A confirmed purchase already in the account, as if imported and categorized. */
async function bankCopy(
  session: Awaited<ReturnType<typeof setUpUser>>["session"],
  book: string,
  account: string,
  { date, amount }: { date: string; amount: string }
) {
  const { data } = await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book } },
    body: {
      date,
      flag: "*",
      payee: "FAKE STORE 0042",
      narration: "",
      postings: [
        { account, units: { number: amount, currency: "USD" } },
        { account: "Expenses:Food:Groceries" },
      ],
    },
  });
  return data!;
}

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

test("a receipt is captured from a file, read, and reviewed, coming back where it started", async ({
  page,
}) => {
  const { session, book, account } = await setUpUser(page);
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
    body: { name: "Expenses:Food:Groceries", kind: "leaf" },
  });
  await fakeAi(page, book.id);

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
  await expect(item.getByLabel("About the receipt")).toHaveText(
    "Receipt: The book's AI isn't set up, so it wasn't read."
  );
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

test("an account's payment cards are added and removed in its editor", async ({ page }) => {
  const { book, account } = await setUpUser(page);
  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}/edit`);
  const cards = page.getByRole("region", { name: "Payment cards" });
  await cards.getByRole("combobox", { name: "Brand" }).selectOption("visa");
  await cards.getByLabel("Last four").fill("4242");
  await cards.getByRole("button", { name: "Add card" }).click();
  await expect(cards.getByRole("listitem")).toHaveText([/Visa ending 4242/]);
  await expect
    .poll(async () => (await accounts(book.id)).find((a) => a.name === account)?.cards)
    .toEqual([{ brand: "visa", last_four: "4242" }]);

  await cards.getByRole("button", { name: "Remove the Visa ending 4242" }).click();
  await expect(cards.getByRole("listitem")).toHaveCount(0);
});

test("an itemized receipt's splits are each placed in review", async ({ page }) => {
  const { session, book, account } = await setUpUser(page);
  for (const name of ["Expenses:Food:Groceries", "Expenses:Food:Restaurant"])
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book.id } },
      body: { name, kind: "leaf" },
    });
  await fakeAi(page, book.id);

  await page.goto(`/ui/books/${book.id}/receipt?account=${encodeURIComponent(account)}`);
  await page.getByLabel("Upload a receipt").setInputFiles({
    name: "jewel.jpg",
    mimeType: "image/jpeg",
    buffer: JPEG,
  });
  await page.getByRole("radio", { name: "Yes" }).click();
  await page.getByRole("button", { name: "Create transaction" }).click();

  // Each line is a split, placed by the (fake) AI, to change as you like.
  const item = page.getByRole("article").filter({ hasText: "Fake Store" });
  await expect(item.getByRole("button", { name: /^FIRST ITEM/ })).toContainText("Groceries");
  await expect(item.getByRole("button", { name: /^SECOND ITEM/ })).toContainText("Groceries");
  await item.getByRole("button", { name: /^FIRST ITEM/ }).click();
  await item.getByRole("combobox", { name: "FIRST ITEM" }).fill("rest");
  await page.keyboard.press("Enter");
  const id = new URL(page.url()).searchParams.get("only")!;
  // Chosen, it's yours: no longer a split to confirm. The other still is.
  await expect
    .poll(async () => (await stored(book.id, id)).postings.map((p) => [p.account, p.flag ?? null]))
    .toEqual([
      [account, null],
      ["Expenses:Food:Restaurant", null],
      ["Expenses:Food:Groceries", "!"],
    ]);
  await item.getByRole("button", { name: "Confirm" }).click();
  // Opened without a way back, it goes home.
  await expect(page).toHaveURL((url) => url.pathname.endsWith(`/books/${book.id}`));
});

test("a receipt for a purchase already here is read into it, which is back in review", async ({
  page,
}) => {
  const { session, book, account } = await setUpUser(page);
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
    body: { name: "Expenses:Food:Groceries", kind: "leaf" },
  });
  const date = yesterday();
  const bank = await bankCopy(session, book.id, account, { date, amount: "-12.34" });
  await fakeAi(page, book.id);

  await page.goto(`/ui/books/${book.id}/receipt?account=${encodeURIComponent(account)}`);
  await page.getByLabel("Upload a receipt").setInputFiles({
    name: "fake.jpg",
    mimeType: "image/jpeg",
    buffer: JPEG,
  });
  await page.getByRole("radio", { name: "Yes" }).click();
  await page.getByRole("button", { name: "Create transaction" }).click();

  await expect(page).toHaveURL((url) => url.searchParams.get("only") === bank.id);
  const item = page.getByRole("article").filter({ hasText: "FAKE STORE 0042" });
  await expect(item.getByLabel("About the receipt")).toHaveText(
    `Receipt: It was read into the transaction already here from ${date}, which is back in review. Read by the fake provider.`
  );
  await expect(item.getByRole("button", { name: /^FIRST ITEM/ })).toBeVisible();
  const t = await stored(book.id, bank.id);
  expect([t.flag, t.postings.length, t.date]).toEqual(["!", 3, date]);
});

test("an iPhone's photo is kept as a JPEG, and read into its transaction as the receipt", async ({
  page,
}) => {
  const { session, book, account } = await setUpUser(page);
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
    body: { name: "Expenses:Food:Groceries", kind: "leaf" },
  });
  // Paid with a tip the receipt doesn't show.
  const t0 = await bankCopy(session, book.id, account, { date: yesterday(), amount: "-15.00" });
  await fakeAi(page, book.id);

  await page.goto(`/ui/books/${book.id}/transactions/${t0.id}`);
  await page.getByLabel("Upload a file").setInputFiles({
    name: "IMG_0001.HEIC",
    mimeType: "image/heic",
    buffer: HEIC,
  });
  const photo = page.getByRole("img", { name: "IMG_0001.jpg" });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth))
    .toBe(600);

  await page.getByRole("button", { name: "Read IMG_0001.jpg as its receipt" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("only") === t0.id);
  const item = page.getByRole("article").filter({ hasText: "FAKE STORE 0042" });
  await expect(item.getByLabel("About the receipt")).toContainText(
    "The receipt says 12.34; the transaction's amount was kept."
  );
  const t = await stored(book.id, t0.id);
  expect(t.flag).toBe("!");
  expect(t.postings[0]!.units?.number).toBe("-15.00");
});

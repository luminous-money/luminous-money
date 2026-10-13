/** M3: schedules made with "Repeat…", staging occurrences marked in the ledger. */
import { expect, test } from "@playwright/test";

import { app, setUpUser } from "./support.js";

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

test("Repeat… makes a monthly schedule that stages what's due, marked ↻ in the ledger", async ({
  page,
}) => {
  const { session, book, account } = await setUpUser(page);
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
    body: { name: "Expenses:Rent", kind: "leaf", opening_balance: null },
  });
  const { data: paid } = await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book.id } },
    body: {
      date: day(-40),
      flag: "*",
      payee: "Landlord",
      narration: "Rent",
      postings: [
        { account, units: { number: "-1500.00", currency: "USD" } },
        { account: "Expenses:Rent" },
      ],
    },
  });

  await page.goto(`/ui/books/${book.id}/transactions/${paid!.id}`);
  await page.getByRole("link", { name: "Repeat…" }).click();

  await expect(page.getByRole("heading", { name: "New schedule" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Landlord");
  await expect(page.getByText(/^Every month on the/)).toBeVisible();
  await expect(page.getByText("1 occurrence since")).toBeVisible(); // a month after, already past
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible();
  const card = page.getByRole("link", { name: /Landlord/ });
  await expect(card).toContainText("1,500.00");
  await expect(card).toContainText("Next:");
  await expect(page.getByRole("region", { name: "Upcoming" })).toContainText("Landlord");

  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);
  await expect(page.getByRole("img", { name: "Scheduled" })).toHaveCount(1);
});

test("a schedule can be edited from the list, paused, and deleted", async ({ page }) => {
  const { book } = await setUpUser(page);
  await page.goto(`/ui/books/${book.id}/schedules/new`);

  await page.getByRole("textbox", { name: "Name" }).fill("Allowance");
  await page.getByRole("combobox", { name: "Unit" }).selectOption("week");
  await page.getByLabel("Starts").fill(day(10));
  await page.getByRole("textbox", { name: "Amount" }).first().fill("-20.00");
  await page
    .getByRole("button", { name: /^Account:/ })
    .first()
    .click();
  await page.getByRole("combobox", { name: "Account" }).fill("PNC");
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: /^Account:/ })
    .nth(1)
    .click();
  await page.getByRole("combobox", { name: "Account" }).fill("Equity:Opening");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("link", { name: /Allowance/ }).click();
  await page.getByRole("checkbox", { name: "Paused" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: /Allowance/ })).toContainText("Paused");

  await page.getByRole("link", { name: /Allowance/ }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No schedules yet")).toBeVisible();
});

/** A monthly rent schedule on `account` starting `start`, made through the API. */
async function scheduleRent(book: string, account: string, start: string) {
  await app(`/books/${book}/schedules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Rent",
      rule: { every: 1, unit: "month", days: [], start, until: null, weekend: "keep" },
      template: {
        payee: "Landlord",
        narration: "Rent",
        tags: [],
        links: [],
        meta: {},
        postings: [
          { account, units: { number: "-1500.00", currency: "USD" } },
          { account: "Equity:Opening-Balances", units: null },
        ],
      },
    }),
  });
}

test("upcoming occurrences show grayed in the ledger, with the projected balance", async ({
  page,
}) => {
  const { book, account } = await setUpUser(page);
  await scheduleRent(book.id, account, day(5));

  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);

  const upcoming = page.getByRole("list", { name: "Upcoming" });
  await expect(upcoming.getByRole("listitem")).toHaveCount(1);
  await expect(upcoming).toContainText(day(5));
  await expect(upcoming).toContainText("projected −$500.00");
});

test("Not this time drops a scheduled occurrence for good", async ({ page }) => {
  const { book, account } = await setUpUser(page);
  await scheduleRent(book.id, account, day(0));
  await page.goto(`/ui/books/${book.id}/review`);

  const card = page.getByRole("article").filter({ hasText: "From a schedule" });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Not this time" }).click();
  await expect(card).toHaveCount(0);

  await app(`/books/${book.id}/schedules/run`, { method: "POST" });
  await page.reload();
  await expect(page.getByText("All caught up")).toBeVisible();
});

test("a schedule's splits take a match tolerance; a book's time zone can be set", async ({
  page,
}) => {
  const { book } = await setUpUser(page);
  await page.goto(`/ui/books/${book.id}/schedules/new`);

  await expect(page.getByRole("textbox", { name: "Match tolerance" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Amount" }).first().fill("-20.00");
  await expect(page.getByRole("textbox", { name: "Match tolerance" })).toHaveCount(1);
  await page.getByRole("textbox", { name: "Match tolerance" }).fill("abc");
  await expect(page.getByText("A match tolerance is an amount")).toBeVisible();

  await page.goto("/ui/books");
  const zone = page.getByRole("combobox", { name: "Time zone" });
  await zone.selectOption("America/Chicago");
  await page.reload();
  await expect(zone).toHaveValue("America/Chicago");
});

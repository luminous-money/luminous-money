/** M3: schedules made with "Repeat…", staging occurrences marked in the ledger. */
import { expect, test } from "@playwright/test";

import { app, editSplit, setUpUser, splitRows } from "./support.js";

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
      date: day(-50), // repeats from about day -20, and again within the upcoming window
      flag: "*",
      payee: "Landlord",
      narration: "Rent",
      // A bank row's: where it came from doesn't repeat, being left out of budgets does.
      meta: { source: "simplefin", "import-batch": "b1", "import-id": "id:1", budget: false },
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
  const [schedule] = (await (await app(`/books/${book.id}/schedules`)).json()) as {
    template: { meta: Record<string, unknown> };
  }[];
  expect(schedule!.template.meta).toEqual({ budget: false });

  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);
  await expect(page.getByRole("img", { name: "Scheduled" })).toHaveCount(1);
});

test("a schedule can be edited from the list, paused, and deleted", async ({ page }) => {
  const { book } = await setUpUser(page);
  await page.goto(`/ui/books/${book.id}/schedules/new`);

  await page.getByRole("textbox", { name: "Name" }).fill("Allowance");
  await page.getByRole("combobox", { name: "Unit" }).selectOption("week");
  await page.getByLabel("Starts").fill(day(10));
  await editSplit(page, 0, { account: "PNC", amount: "-20.00" });
  await editSplit(page, 1, { account: "Equity:Opening" });
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

  // In the split's editor, once it has an amount; shown on the split once saved.
  await splitRows(page).first().click();
  const editor = page.getByRole("dialog", { name: "Split", exact: true });
  await expect(editor.getByRole("textbox", { name: "Match tolerance" })).toHaveCount(0);
  await editor.getByRole("button", { name: /^Account:/ }).click();
  await editor.getByRole("combobox", { name: "Account" }).fill("PNC");
  await page.keyboard.press("Enter");
  await editor.getByRole("textbox", { name: "Amount" }).fill("-20.00");
  await expect(editor.getByRole("textbox", { name: "Match tolerance" })).toHaveCount(1);
  await editor.getByRole("textbox", { name: "Match tolerance" }).fill("abc");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor.getByText("A match tolerance is an amount")).toBeVisible();
  await editor.getByRole("textbox", { name: "Match tolerance" }).fill("5.00");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(splitRows(page).first()).toContainText("−$20.00 ±5.00");

  await page.goto("/ui/books");
  const zone = page.getByRole("combobox", { name: "Time zone" });
  // A book with no time zone is given the browser's in the background: let that land first, or
  // it can overwrite the choice. Then wait for the choice itself to be saved.
  await expect(zone).toBeEnabled();
  await expect(zone).not.toHaveValue("");
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith("/settings") && r.ok()
  );
  await zone.selectOption("America/Chicago");
  await saved;
  await page.reload();
  await expect(zone).toHaveValue("America/Chicago");
});

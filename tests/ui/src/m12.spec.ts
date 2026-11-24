/** M12: home's chart and recent transactions, the Transactions page, Reports, and an account's
 * typical periods. */
import { expect, type Page } from "@playwright/test";

import { test } from "./fixtures.js";
import { setUpUser } from "./support.js";

const GROCERIES = "Expenses:Food:Groceries";
const RENT = "Expenses:Housing:Rent";
const today = () => new Date().toLocaleDateString("en-CA");
/** The `day`th of the month `back` months ago. */
function dayOf(back: number, day: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The month `back` months ago, YYYY-MM, and as the breakdown's months read it ("Sep 2026"). */
const monthOf = (back: number) => dayOf(back, 1).slice(0, 7);
const named = (month: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`)
  );

/** A user with six months of rent and groceries before this one, and groceries today. */
async function withHistory(page: Page) {
  const { session, book, account } = await setUpUser(page);
  const path = { book_id: book.id };
  for (const name of [GROCERIES, RENT])
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path },
      body: { name, kind: "leaf" },
    });
  const spend = (date: string, to: string, number: string, payee: string) => ({
    date,
    flag: "*",
    payee,
    narration: "",
    postings: [
      { account, units: { number: `-${number}`, currency: "USD" } },
      { account: to, units: { number, currency: "USD" } },
    ],
  });
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions/batch", {
    params: { path },
    body: [
      ...[1, 2, 3, 4, 5, 6].flatMap((back) => [
        spend(dayOf(back, 1), RENT, "900.00", "Landlord"),
        spend(dayOf(back, 10), GROCERIES, "150.00", "Grocer"),
      ]),
      spend(today(), GROCERIES, "42.00", "Corner Grocer"),
    ],
  });
  return { book: book.id, session, account };
}

test("home shows this month's spending, and recent transactions open the whole journal", async ({
  page,
}) => {
  const { book } = await withHistory(page);
  await page.goto(`/ui/books/${book}`);

  const spending = page.getByRole("region", { name: "Spent this month" });
  await expect(spending).toContainText("$42");
  await expect(spending.getByRole("img", { name: /Spent \$42 this month/ })).toBeVisible();
  const recent = page.getByRole("list", { name: "Recent transactions" });
  await expect(recent.getByRole("listitem").first()).toContainText("Corner Grocer");

  await page.getByRole("link", { name: "Recent transactions ›" }).click();
  await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  const all = page.getByRole("list", { name: "Transactions" }).getByRole("listitem");
  await expect(all).toHaveCount(14); // 12, today's, and the opening balance
  await expect(all.first()).toContainText("PNC-Checking → Food:Groceries");
});

test("a charge shows as what left the card, though a discount is negative too", async ({
  page,
}) => {
  const { book, session, account } = await withHistory(page);
  const gift = "Assets:Gift-Cards:Cafe";
  const discounts = "Income:Discounts";
  for (const name of [gift, discounts])
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book } },
      body: { name, kind: "leaf" },
    });
  const usd = (number: string) => ({ number, currency: "USD" });
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book } },
    body: {
      date: today(),
      flag: "*",
      payee: "Warehouse Club",
      narration: "",
      postings: [
        { account, units: usd("-90.00") },
        { account: gift, units: usd("50.00") },
        { account: gift, units: usd("50.00") },
        { account: GROCERIES, units: usd("10.00") },
        { account: discounts, units: usd("-20.00") },
      ],
    },
  });
  await page.goto(`/ui/books/${book}/transactions`);
  const row = page
    .getByRole("list", { name: "Transactions" })
    .getByRole("listitem")
    .filter({ hasText: "Warehouse Club" });
  await expect(row).toContainText("2 accounts → 2 accounts");
  await expect(row).toContainText("$90.00");
});

test("Reports break spending down, and drill into a category", async ({ page }) => {
  const { book } = await withHistory(page);
  // The three complete months before this one: no month in part.
  await page.goto(`/ui/books/${book}/reports?from=${monthOf(3)}&through=${monthOf(1)}`);

  const breakdown = page.getByRole("region", { name: "Breakdown" });
  const categories = breakdown.getByRole("list", { name: "Categories" });
  await expect(categories).toContainText("Housing");
  await expect(categories).toContainText("$900");
  await categories.getByRole("button", { name: /Food/ }).click();
  await expect(breakdown.getByRole("navigation", { name: "Drilled into" })).toContainText("Food");
  await expect(categories).toContainText("Groceries");
  await expect(categories).toContainText("$150");

  await expect(page.getByRole("region", { name: "Cash flow" })).toContainText("Expenses");
  await expect(page.getByRole("region", { name: "Largest transactions" })).toContainText(
    "Corner Grocer"
  );
});

test("the breakdown covers a range of months, as a donut of the average or a bar a month", async ({
  page,
}) => {
  const { book } = await withHistory(page);
  const reports = `/ui/books/${book}/reports`;
  await page.goto(reports);

  const breakdown = page.getByRole("region", { name: "Breakdown" });
  const months = breakdown.getByRole("button", { name: /^Months:/ });
  // By default, the last six months through this one.
  await expect(months).toHaveAccessibleName(`Months: ${named(monthOf(5))} – ${named(monthOf(0))}`);
  const categories = breakdown.getByRole("list", { name: "Categories" });
  await page.goto(`${reports}?from=${monthOf(12)}&through=${monthOf(1)}`);
  await expect(categories).toContainText("$450"); // six months' rent, over twelve
  await page.goto(`${reports}?from=${monthOf(3)}&through=${monthOf(1)}`);
  await expect(categories).toContainText("$900");
  await expect(breakdown.getByRole("img", { name: /per month/ })).toBeVisible();

  // Bars: each month as it was, and the list the months summed.
  const chart = breakdown.getByRole("radiogroup", { name: "Chart" });
  await chart.getByRole("radio", { name: "Bars" }).click();
  await expect(page).toHaveURL(/from=.*through=.*chart=bars/);
  await expect(breakdown).toContainText(`$3,150 over ${named(monthOf(3))} – ${named(monthOf(1))}`);
  await expect(categories).toContainText("$2,700");
  await expect(categories).toContainText("$450");
  const bars = breakdown.getByRole("img", { name: /^By month: .*\$1,050/ });
  await expect(bars).toBeVisible();

  // Tapping a bar narrows to its month, no category picked; then a tap on one picks it.
  const tap = async (i: number, of: number) => {
    const box = (await bars.boundingBox())!;
    await page.mouse.click(
      box.x + 4 + ((box.width - 52) * (i + 0.5)) / of,
      box.y + box.height - 60
    );
  };
  await tap(1, 3);
  await expect(months).toHaveAccessibleName(`Months: ${named(monthOf(2))}`);
  await expect(page).toHaveURL(new RegExp(`from=${monthOf(2)}&through=${monthOf(2)}`));
  await expect(breakdown.getByRole("navigation", { name: "Drilled into" })).toHaveCount(0);
  await expect(breakdown).toContainText(`$1,050 in ${named(monthOf(2))}`);
  await tap(0, 1);
  await expect(breakdown.getByRole("navigation", { name: "Drilled into" })).toContainText(
    "Housing"
  );
  await expect(months).toHaveAccessibleName(`Months: ${named(monthOf(2))}`);

  // Drilling in keeps the bars and the months; this month is one bar.
  await page.goto(`${reports}?of=Expenses%3AFood&chart=bars`);
  await expect(breakdown.getByRole("navigation", { name: "Drilled into" })).toContainText("Food");
  await months.click();
  await breakdown.getByRole("button", { name: "This month" }).click();
  await expect(months).toHaveAccessibleName(`Months: ${named(monthOf(0))}`);
  await expect(breakdown).toContainText("$42 this month so far");
  await chart.getByRole("radio", { name: "Pie" }).click();
  await expect(page).not.toHaveURL(/chart=bars/);
  await expect(breakdown.getByRole("img", { name: /\$42 this month/ })).toBeVisible();
});

test("the breakdown's months are picked as a start and an end, in any year", async ({ page }) => {
  const { book } = await withHistory(page);
  await page.goto(`/ui/books/${book}/reports`);
  const breakdown = page.getByRole("region", { name: "Breakdown" });
  const months = breakdown.getByRole("button", { name: /^Months:/ });
  const now = monthOf(0);
  const yearAgo = monthOf(12);

  await months.click();
  const picker = breakdown.getByRole("dialog", { name: "Months" });
  await expect(picker).toContainText("Choose a start and end month (can be the same)");
  await expect(picker.getByRole("button", { name: "6 months" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  // A first tap is that month alone; a second, a year back, the other end.
  await picker.getByRole("button", { name: named(now), exact: true }).click();
  await expect(months).toHaveAccessibleName(`Months: ${named(now)}`);
  await picker.getByRole("button", { name: "The year before" }).click();
  await picker.getByRole("button", { name: named(yearAgo), exact: true }).click();
  await expect(months).toHaveAccessibleName(`Months: ${named(yearAgo)} – ${named(now)}`);
  await expect(picker).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`from=${yearAgo}&through=${now}`));
  // Rent's six months over thirteen, this one counting as the part of it gone.
  await expect(breakdown.getByRole("list", { name: "Categories" })).toContainText("Housing");

  // A month ahead is offered, and the window stops at today.
  await months.click();
  await picker.getByRole("button", { name: "The year after" }).click();
  await picker.getByRole("button", { name: named(monthOf(-12)), exact: true }).click();
  await picker.getByRole("button", { name: named(monthOf(-12)), exact: true }).click();
  await expect(breakdown.getByText(`Nothing in ${named(monthOf(-12))}.`)).toBeVisible();
  await months.click();
  await picker.getByRole("button", { name: "All time" }).click();
  await expect(months).toHaveAccessibleName("Months: All time");
  await expect(page).toHaveURL(/from=start/);

  // Level is how deep, at the top only.
  await breakdown.getByRole("radio", { name: "2" }).click();
  await expect(breakdown.getByRole("list", { name: "Categories" })).toContainText("Rent");
});

test("the breakdown lists every transaction under where it is, and keeps its place", async ({
  page,
}) => {
  const { book } = await withHistory(page);
  await page.goto(`/ui/books/${book}/reports`);

  const breakdown = page.getByRole("region", { name: "Breakdown" });
  const all = breakdown.getByRole("list", { name: "Transactions under Expenses" });
  await expect(all.getByRole("listitem")).toHaveCount(13); // 12, and today's
  await breakdown
    .getByRole("list", { name: "Categories" })
    .getByRole("button", { name: /Food/ })
    .click();
  const food = breakdown.getByRole("list", { name: "Transactions under Food" });
  await expect(food.getByRole("listitem")).toHaveCount(7);
  await expect(food).not.toContainText("Landlord");
  await expect(food.getByRole("listitem").first()).toContainText("Corner Grocer"); // newest first
  await expect(page).toHaveURL(/of=Expenses%3AFood/);

  // Opening one and coming back finds the breakdown where it was.
  await food.getByRole("button", { name: /Corner Grocer/ }).click();
  await expect(page.getByRole("heading", { name: "Transaction" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Breadcrumbs" })
    .getByRole("link", { name: "Reports" })
    .click();
  await expect(breakdown.getByRole("navigation", { name: "Drilled into" })).toContainText("Food");
  await expect(food.getByRole("listitem")).toHaveCount(7);

  // A leaf opens too: its own transactions, and nothing else's (2026-11-14).
  await breakdown
    .getByRole("list", { name: "Categories" })
    .getByRole("button", { name: /Groceries/ })
    .click();
  await expect(breakdown.getByRole("navigation", { name: "Drilled into" })).toContainText(
    "Groceries"
  );
  const groceries = breakdown.getByRole("list", { name: "Transactions under Groceries" });
  await expect(groceries).toContainText("Corner Grocer");
  await expect(page).toHaveURL(/of=Expenses%3AFood%3AGroceries/);
});

test("the breakdown's transactions are their splits under where it is, not their totals", async ({
  page,
}) => {
  const { book, session, account } = await withHistory(page);
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book } },
    body: {
      date: today(),
      flag: "*",
      payee: "Megamart",
      narration: "",
      postings: [
        { account, units: { number: "-100.00", currency: "USD" } },
        { account: GROCERIES, units: { number: "30.00", currency: "USD" }, meta: { memo: "Oats" } },
        { account: RENT, units: { number: "70.00", currency: "USD" } },
      ],
    },
  });
  await page.goto(`/ui/books/${book}/reports?of=Expenses%3AFood`);
  const food = page
    .getByRole("region", { name: "Breakdown" })
    .getByRole("list", { name: "Transactions under Food" });
  const megamart = food.getByRole("listitem").filter({ hasText: "Megamart" });
  await expect(megamart).toHaveCount(1);
  await expect(megamart).toContainText("Groceries · Oats");
  await expect(megamart).toContainText("$30.00");
  await expect(megamart).not.toContainText("$100.00");

  // At the top, each of its splits is a row of its own.
  await page.goto(`/ui/books/${book}/reports`);
  const all = page
    .getByRole("region", { name: "Breakdown" })
    .getByRole("list", { name: "Transactions under Expenses" })
    .getByRole("listitem")
    .filter({ hasText: "Megamart" });
  await expect(all).toHaveCount(2);
  await expect(all.filter({ hasText: "Housing:Rent" })).toContainText("$70.00");
  await expect(all.filter({ hasText: "Food:Groceries" })).toContainText("$30.00");
});

test("what counts as spending shows on its expense account, and in the breakdown's transactions", async ({
  page,
}) => {
  const { book, session, account } = await withHistory(page);
  const path = { book_id: book };
  const owing = "Liabilities:Loans:Mortgage";
  const counted = "Expenses:Housing:Mortgage";
  for (const name of [owing, counted])
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path },
      body: { name, kind: "leaf" },
    });
  const { data: accounts } = await session.ledger.GET("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path },
  });
  await session.ledger.PATCH("/api/ledger/v1/books/{book_id}/accounts/{account}", {
    params: { path: { ...path, account: owing } },
    body: { updated_at: accounts!.find((a) => a.name === owing)!.updated_at!, outflow: counted },
  });
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path },
    body: {
      date: today(),
      flag: "*",
      payee: "Lender",
      narration: "",
      postings: [
        { account, units: { number: "-1200.00", currency: "USD" } },
        { account: owing, units: { number: "1200.00", currency: "USD" } },
      ],
    },
  });

  // Nothing's booked to the expense account; its page says what counts there, and how much.
  await page.goto(`/ui/books/${book}/accounts/${counted}`);
  const card = page.getByRole("region", { name: "Counted as spending here" });
  await expect(card).toContainText("Loans:Mortgage");
  await expect(card).toContainText("$1,200.00 this month");
  await card.getByRole("link", { name: "See what's paid into it" }).click();
  await expect(page.getByRole("list", { name: "Transactions" })).toContainText("Lender");

  // In the breakdown, read as outflows, the payment is under Housing; as booked, it isn't.
  await page.goto(`/ui/books/${book}/reports?of=Expenses%3AHousing`);
  const housing = page
    .getByRole("region", { name: "Breakdown" })
    .getByRole("list", { name: "Transactions under Housing" });
  await expect(housing).toContainText("Lender");
  await expect(
    housing.getByRole("button", {
      name: /Lender.*Mortgage · paid into Loans:Mortgage.*\$1,200\.00/,
    })
  ).toBeVisible();
  await expect(housing).toContainText("Landlord");
  await page
    .getByRole("radiogroup", { name: "Spending as" })
    .getByRole("radio", { name: "Expenses" })
    .click();
  await expect(page).toHaveURL(/lens=expenses.*of=Expenses%3AHousing/);
  await expect(housing).toContainText("Landlord");
  await expect(housing).not.toContainText("Lender");
});

test("Reports can leave out what's excluded from budgets", async ({ page }) => {
  const { book, session, account } = await withHistory(page);
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book } },
    body: {
      date: today(),
      flag: "*",
      payee: "Roofer",
      narration: "",
      meta: { budget: false },
      postings: [
        { account, units: { number: "-5000.00", currency: "USD" } },
        { account: RENT, units: { number: "5000.00", currency: "USD" } },
      ],
    },
  });
  await page.goto(`/ui/books/${book}/reports`);
  const breakdown = page.getByRole("region", { name: "Breakdown" });
  await breakdown.getByRole("button", { name: /^Months:/ }).click();
  await breakdown.getByRole("button", { name: "This month" }).click();
  const categories = breakdown.getByRole("list", { name: "Categories" });
  await expect(categories).toContainText("$5,000");
  const largest = page.getByRole("region", { name: "Largest transactions" });
  await expect(largest).toContainText("Roofer");

  await page.getByLabel("Leave out what's excluded from budgets").check();
  await expect(page).toHaveURL(/budgeted=only/);
  await expect(categories).not.toContainText("Housing");
  await expect(categories).toContainText("Food");
  await expect(largest).not.toContainText("Roofer");
  await expect(
    breakdown.getByRole("list", { name: "Transactions under Expenses" })
  ).not.toContainText("Roofer");
});

test("an expense account's page shows what its periods typically come to", async ({ page }) => {
  const { book } = await withHistory(page);
  await page.goto(`/ui/books/${book}/accounts/${encodeURIComponent(GROCERIES)}`);
  const typical = page.getByRole("region", { name: "Typically" });
  // Half of the last 12 months had $150 of groceries: the median is between.
  await expect(typical.getByRole("row", { name: /A month/ })).toContainText("$75");
});

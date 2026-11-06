/**
 * Loans: New loan's questionnaire for a home (what it's for, terms, escrow with a bill, payments
 * so far, payment, then checking it over and renaming an account), its page (what's owed, the
 * next payment's parts, escrow and its bill, a dated escrow change, an extra payment), and a
 * car's (no payments due yet, so no history step; the answers kept through a reload; a loan
 * account already in the books; counting principal as spending, and Reports' switch).
 *
 * In Chicago's time zone, where a due date on the 1st once showed as the month before.
 */
import { expect, test, type Page } from "@playwright/test";

import { importText, logIn } from "./support.js";

test.use({ timezoneId: "America/Chicago" });

const CHECKING = "Assets:Bank:Checking";

/** The 1st of the month `n` months from this one. */
function monthFrom(n: number): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
}

/** A date as the tables show it: "Sep 1, 2024". */
const fullDay = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

async function loanBook(page: Page, more = "") {
  const session = await logIn(page);
  const { data } = await session.ledger.POST("/api/ledger/v1/books", { body: { name: "Home" } });
  const book = data!.id;
  const opened = monthFrom(-12);
  await importText(
    book,
    `option "operating_currency" "USD"
${opened} open ${CHECKING} USD

${opened} * "Opening"
  ${CHECKING}  50000.00 USD
  Equity:Opening-Balances
${more}`
  );
  return { session, book };
}

const next = (page: Page) => page.getByRole("button", { name: "Next" }).click();

test("New loan for a home, step by step, then its page", async ({ page }) => {
  const { book } = await loanBook(page);
  await page.goto(`/ui/books/${book}/loans`);
  await expect(page.getByText("No loans yet")).toBeVisible();
  await page.getByRole("link", { name: "New loan" }).click();

  // 1. What it's for.
  await expect(page.getByText("Step 1 of 6 · What it's for")).toBeVisible();
  await next(page);
  await expect(page.getByRole("alert")).toHaveText("Say what kind of loan it is");
  await page.getByRole("radio", { name: "A home" }).click();
  await page.getByLabel("What is this loan for?").fill("123 Main St");
  await next(page);

  // 2. Terms, and the table they make, its first payment due on the 1st.
  const first = monthFrom(-6);
  await page.getByLabel("Borrowed", { exact: true }).fill("300000");
  await page.getByLabel("Rate (% a year)").fill("3.75");
  await page.getByLabel("First payment").fill(first);
  await page.getByLabel(/What it cost/).fill("375000");
  await expect(page.getByText("360 payments of $1,389.35 at 3.75%")).toBeVisible();
  const rows = page.getByRole("table", { name: "Payments" }).getByRole("row");
  await expect(rows).toHaveCount(13);
  await expect(rows.nth(1)).toContainText(fullDay(first));
  await page.getByRole("button", { name: "Looks right" }).click();

  // 3. Extras: escrow, what's in it, and the property tax it pays.
  await page.getByLabel("Part of each payment goes to escrow").check();
  await page.getByLabel("Escrow each month").fill("450.00");
  await expect(
    page.getByText("Goes to Assets:Escrow:123-Main-St. You can change it at the end.")
  ).toBeVisible();
  await page.getByLabel(/What's in it now/).fill("1200.00");
  await page.getByLabel("Property tax", { exact: true }).check();
  await page.getByLabel("Property tax: amount").fill("2550");
  await page.getByLabel("How often").selectOption("Twice a year");
  await page.getByLabel("Property tax: next due").fill(monthFrom(4));
  await next(page);

  // 4. Payments so far: from what's owed now.
  await expect(page.getByText(/7 payments were due, from/)).toBeVisible();
  await page.getByRole("radio", { name: /Start from what I owe now/ }).check();
  await page.getByLabel("Owed", { exact: true }).fill("296000.00");
  await next(page);

  // 5. Payment: checking, the only account under Assets:Bank, by default.
  await expect(page.getByRole("button", { name: `Paid from: ${CHECKING}` })).toBeVisible();
  await page.getByLabel(/Lender/).fill("Big Bank Mortgage");
  await next(page);

  // 6. Check it over: where the money goes, what's new, what Confirm does.
  await expect(page.getByText("Step 6 of 6 · Check it over")).toBeVisible();
  const each = page.getByRole("region", { name: "Each payment" });
  await expect(each).toContainText("$1,839.35");
  await expect(
    each.getByRole("button", { name: "Principal goes to: Liabilities:Loans:Mortgages:123-Main-St" })
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Paid from escrow" }).getByText("Property tax")
  ).toBeVisible();
  const confirming = page.getByRole("region", { name: "When you confirm" });
  await expect(confirming).toContainText("Opens 5 accounts");
  await expect(confirming).toContainText("Records that $296,000.00 is owed");
  await expect(confirming).toContainText("Assets:Property:123-Main-St starts at $375,000.00");
  await expect(page.getByLabel(/as monthly spending/)).not.toBeChecked();

  // Interest goes to a name of one's own: "Create account", the new name prefilled.
  await each
    .getByRole("button", { name: "Interest goes to: Expenses:Financing:Interest:123-Main-St" })
    .click();
  await page.getByRole("option", { name: /Create account/ }).click();
  const dialog = page.getByRole("dialog", { name: "Create account" });
  await expect(dialog.getByRole("combobox", { name: "Account" })).toHaveValue(
    "Expenses:Financing:Interest:123-Main-St"
  );
  await dialog
    .getByRole("combobox", { name: "Account" })
    .fill("Expenses:Financing:Mortgage-Interest");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(
    each.getByRole("button", { name: "Interest goes to: Expenses:Financing:Mortgage-Interest" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();

  // Its page.
  await expect(page).toHaveURL(/\/loans\/[0-9a-f]+$/);
  await expect(page.getByRole("heading", { name: "123 Main St mortgage" })).toBeVisible();
  const summary = page.getByRole("region", { name: "What's owed" });
  await expect(summary).toContainText("$296,000.00");
  await expect(summary).toContainText("$1,839.35");
  await expect(summary).toContainText("$450.00 escrow");
  const escrow = page.getByRole("region", { name: "Escrow" });
  await expect(escrow).toContainText("$1,200.00");
  await expect(escrow.getByRole("link", { name: "123 Main St property tax" })).toBeVisible();
  await expect(page.getByRole("region", { name: "What to do when" })).toContainText(
    "use Extra payment, above"
  );
  await expect(
    page.getByRole("region", { name: "Payments ahead" }).getByRole("row").nth(1)
  ).toContainText(fullDay(monthFrom(1)));

  // Escrow goes up from next month.
  const changes = page.getByRole("region", { name: "Changes" });
  await changes.getByRole("button", { name: "A change…" }).click();
  await changes.getByLabel("New amount").fill("482.17");
  await changes.getByRole("button", { name: "Save the change" }).click();
  await expect(page.getByRole("region", { name: "Changes" })).toContainText(
    "Escrow becomes $482.17"
  );
  await expect(page.getByRole("region", { name: "What's owed" })).toContainText("$1,871.52");

  // $10,000 extra: less owed, the same payment, worked out from the books.
  const extra = page.getByRole("region", { name: "Extra payment" });
  await extra.getByRole("button", { name: "Pay extra…" }).click();
  await extra.getByLabel("Amount").fill("10000");
  await extra.getByRole("button", { name: /Pay \$10,000\.00 extra/ }).click();
  await expect(page.getByRole("region", { name: "What's owed" })).toContainText("$286,000.00");

  // What it bought, at what it cost.
  await page.goto(`/ui/books/${book}/accounts/Assets:Property:123-Main-St`);
  await expect(page.getByText("$375,000.00").first()).toBeVisible();

  // The Loans page lists it; Schedules links its payments to it.
  await page.goto(`/ui/books/${book}/loans`);
  await expect(page.getByRole("link", { name: /123 Main St mortgage/ })).toContainText(
    "$286,000.00"
  );
  await page.goto(`/ui/books/${book}/schedules`);
  await page.getByRole("link", { name: /A loan's payments/ }).click();
  await expect(page.getByRole("heading", { name: "123 Main St mortgage" })).toBeVisible();
});

test("a car's loan: no payments due yet, kept through a reload, its account already in the books, as spending", async ({
  page,
}) => {
  const owing = "Liabilities:Loans:Car-Loan";
  const { book } = await loanBook(
    page,
    `
${monthFrom(-1)} open ${owing} USD
${monthFrom(-1)} * "Dealer"
  ${owing}  -15000.00 USD
  Equity:Opening-Balances
`
  );
  await page.goto(`/ui/books/${book}/loans/new`);
  await page.getByRole("radio", { name: "A car" }).click();
  await page.getByLabel("What is this loan for?").fill("2023 Chevy Spark");
  await next(page);
  await page.getByLabel("Borrowed", { exact: true }).fill("15000");
  await page.getByLabel("Rate (% a year)").fill("7");
  await page.getByLabel("Monthly payments").fill("60");
  await page.getByLabel("First payment").fill(monthFrom(1));
  await page.getByRole("button", { name: "Looks right" }).click();

  // Nothing's due yet, so there's no history step; a reload keeps the answers.
  await expect(page.getByText("Step 3 of 5 · Extras")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Step 3 of 5 · Extras")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Rate (% a year)")).toHaveValue("7");
  await page.getByRole("button", { name: "Looks right" }).click();
  await next(page);
  await next(page);

  // The loan's account is one already in the books, which already says what's owed.
  const each = page.getByRole("region", { name: "Each payment" });
  await each
    .getByRole("button", { name: "Principal goes to: Liabilities:Loans:Auto:2023-Chevy-Spark" })
    .click();
  await page.getByRole("combobox", { name: "Principal goes to" }).fill("car");
  await page.getByRole("option", { name: owing }).click();
  await expect(page.getByRole("region", { name: "When you confirm" })).toContainText(
    `${owing} already says $15,000.00 is owed, so nothing is written for it.`
  );

  // Counting principal as spending, opted into here.
  await page.getByLabel("Count principal as monthly spending").check();
  await expect(
    page.getByRole("button", {
      name: "Principal counts as: Expenses:Financing:Principal:2023-Chevy-Spark",
    })
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page).toHaveURL(/\/loans\/[0-9a-f]+$/);
  await expect(page.getByRole("region", { name: "What's owed" })).toContainText("$15,000.00");
  await expect(page.getByRole("region", { name: "As spending" })).toContainText(
    `${owing} counts as Expenses:Financing:Principal:2023-Chevy-Spark`
  );

  // The account editor says so too.
  await page.goto(`/ui/books/${book}/accounts/${owing}/edit`);
  await expect(
    page.getByRole("region", { name: "Counts as spending" }).getByRole("button", {
      name: "Counts as: Expenses:Financing:Principal:2023-Chevy-Spark",
    })
  ).toBeVisible();

  // Reports: outflows by default, expenses on the switch (kept in the address).
  await page.goto(`/ui/books/${book}/reports`);
  const lens = page.getByRole("radiogroup", { name: "Spending as" });
  await expect(lens.getByRole("radio", { name: "Outflows" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await lens.getByRole("radio", { name: "Expenses" }).click();
  await expect(page).toHaveURL(/lens=expenses/);
  await expect(page.getByText("Spending as the books have it")).toBeVisible();
});

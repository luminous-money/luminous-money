/**
 * Loans: a new loan worked out from its terms and declared from today, its page (what's owed,
 * the next payment's parts, escrow and a payment from it), a dated escrow change, an extra
 * payment, a lender's CSV schedule read into a table, and the Loans and Schedules pages.
 */
import { expect, test, type Page } from "@playwright/test";

import { importText, logIn } from "./support.js";

const CHECKING = "Assets:Bank:Checking";
const MORTGAGE = "Liabilities:Loans:Mortgage";
const INTEREST = "Expenses:Housing:Mortgage-Interest";

/** The 1st of the month `n` months from this one. */
function monthFrom(n: number): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
}

async function loanBook(page: Page) {
  const session = await logIn(page);
  const { data } = await session.ledger.POST("/api/ledger/v1/books", { body: { name: "Home" } });
  const book = data!.id;
  const opened = monthFrom(-12);
  await importText(
    book,
    `option "operating_currency" "USD"
${opened} open ${CHECKING} USD
${opened} open ${MORTGAGE} USD
${opened} open ${INTEREST}
${opened} open Expenses:Housing:Property-Tax

${opened} * "Opening"
  ${CHECKING}  50000.00 USD
  Equity:Opening-Balances
`
  );
  return { session, book };
}

const pick = async (page: Page, label: string, search: string, account: string) => {
  await page.getByRole("button", { name: `${label}: none` }).click();
  await page.getByRole("combobox", { name: label }).fill(search);
  await page.getByRole("option", { name: account }).click();
};

test("a new loan from its terms, declared from today, then its page", async ({ page }) => {
  const { book } = await loanBook(page);
  await page.goto(`/ui/books/${book}/loans`);
  await expect(page.getByText("No loans yet")).toBeVisible();
  await page.getByRole("link", { name: "New loan" }).click();

  await page.getByLabel("Name").fill("Mortgage");
  await pick(page, "What's owed", "mortgage", MORTGAGE);
  await pick(page, "Paid from", "checking", CHECKING);
  await pick(page, "Interest goes to", "interest", INTEREST);
  await page.getByLabel("Borrowed").fill("300000");
  await page.getByLabel("Rate (% a year)").fill("3.75");
  await page.getByLabel("First payment").fill(monthFrom(-6));
  await expect(page.getByText("360 payments of $1,389.35 at 3.75%")).toBeVisible();
  await expect(page.getByRole("table", { name: "Payments" }).getByRole("row")).toHaveCount(13);

  await page.getByRole("button", { name: "+ Escrow" }).click();
  await page.getByLabel("Amount", { exact: true }).fill("450.00");
  await expect(
    page.getByRole("button", { name: "Escrow goes to: Assets:Escrow:Mortgage" })
  ).toBeVisible();

  await page.getByRole("radio", { name: /From today/ }).check();
  await page.getByLabel("Owed", { exact: true }).fill("296000.00");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/\/loans\/[0-9a-f]+$/);
  await expect(page.getByRole("heading", { name: "Mortgage" })).toBeVisible();
  const summary = page.getByRole("region", { name: "What's owed" });
  await expect(summary).toContainText("$296,000.00");
  await expect(summary).toContainText("$1,839.35");
  await expect(summary).toContainText("$450.00 escrow");
  await expect(page.getByRole("region", { name: "Payments ahead" })).toBeVisible();

  // Escrow: nothing paid from it yet, and a payment from it is a schedule of its own.
  const escrow = page.getByRole("region", { name: "Escrow" });
  await expect(escrow).toContainText("Nothing's paid from it yet");
  await escrow.getByRole("link", { name: "+ A payment from escrow" }).click();
  await expect(page.getByRole("heading", { name: "New schedule" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Unit" })).toHaveValue("year");
  await expect(page.getByRole("button", { name: "Account: Assets:Escrow:Mortgage" })).toBeVisible();
  await page.goBack();

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
  await expect(page.getByRole("region", { name: "What's owed" })).toContainText(
    "Worked out from what the books say"
  );

  // The Loans page lists it; Schedules links its payments to it.
  await page.goto(`/ui/books/${book}/loans`);
  await expect(page.getByRole("link", { name: /Mortgage/ })).toContainText("$286,000.00");
  await page.goto(`/ui/books/${book}/schedules`);
  await page.getByRole("link", { name: /A loan's payments/ }).click();
  await expect(page.getByRole("heading", { name: "Mortgage" })).toBeVisible();
});

test("a lender's CSV schedule, its columns guessed", async ({ page }) => {
  const { book } = await loanBook(page);
  await page.goto(`/ui/books/${book}/loans/new`);
  await page.getByRole("radio", { name: "Import a CSV" }).click();
  const csv = [
    "Pmt #,Due Date,Payment,Principal,Interest,Escrow,Remaining Balance",
    '1,08/01/2016,"$1,839.35",$451.85,$937.50,$450.00,"$299,548.15"',
    '2,09/01/2016,"$1,839.35",$453.26,$936.09,$450.00,"$299,094.89"',
    '3,10/01/2016,"$1,839.35",$454.68,$934.67,$450.00,"$298,640.21"',
  ].join("\n");
  await page
    .getByLabel("The lender's schedule, as a CSV")
    .setInputFiles({ name: "schedule.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByRole("combobox", { name: "Principal" })).toHaveValue("3");
  await expect(page.getByText("3 payments of $1,389.35 at 3.75%")).toBeVisible();
  // Its escrow column became an escrow part.
  await expect(page.getByRole("button", { name: /^Escrow goes to: Assets:Escrow:/ })).toBeVisible();

  // A wrong column says what doesn't add up.
  await page.getByRole("combobox", { name: "Owed after" }).selectOption("Payment");
  await expect(page.getByText(/doesn't add up/)).toBeVisible();
});

test("outflows: a new loan's payments count as spending, and Reports switch to expenses", async ({
  page,
}) => {
  const { book } = await loanBook(page);
  await page.goto(`/ui/books/${book}/loans/new`);
  await page.getByLabel("Name").fill("Mortgage");
  await pick(page, "What's owed", "mortgage", MORTGAGE);
  await pick(page, "Paid from", "checking", CHECKING);
  await pick(page, "Interest goes to", "interest", INTEREST);
  await page.getByLabel("Borrowed").fill("300000");
  await page.getByLabel("Rate (% a year)").fill("3.75");
  await page.getByLabel("First payment").fill(monthFrom(-1));
  await page.getByRole("button", { name: "+ Escrow" }).click();
  await page.getByLabel("Amount", { exact: true }).fill("450.00");
  await page.getByRole("radio", { name: /From the start/ }).check();
  await expect(page.getByLabel("Count the whole payment as monthly spending")).toBeChecked();
  await expect(
    page.getByText("Principal counts as Expenses:Housing:Mortgage-Principal")
  ).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/\/loans\/[0-9a-f]+$/);
  const spending = page.getByRole("region", { name: "As spending" });
  await expect(spending).toContainText(
    `${MORTGAGE}: counts as Expenses:Housing:Mortgage-Principal`
  );
  await expect(spending).toContainText(
    "Assets:Escrow:Mortgage: counts as Expenses:Housing:Mortgage-Escrow"
  );

  // The account editor says so too.
  await page.goto(`/ui/books/${book}/accounts/${MORTGAGE}/edit`);
  await expect(
    page.getByRole("region", { name: "Counts as spending" }).getByRole("button", {
      name: "Counts as: Expenses:Housing:Mortgage-Principal",
    })
  ).toBeVisible();

  // Reports: outflows by default, expenses on the switch (kept in the address).
  await page.goto(`/ui/books/${book}/reports`);
  const lens = page.getByRole("radiogroup", { name: "Spending as" });
  await expect(lens.getByRole("radio", { name: "Outflows" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(page.getByText("Spending as it leaves your hands")).toBeVisible();
  await lens.getByRole("radio", { name: "Expenses" }).click();
  await expect(page).toHaveURL(/lens=expenses/);
  await expect(page.getByText("Spending as the books have it")).toBeVisible();
});

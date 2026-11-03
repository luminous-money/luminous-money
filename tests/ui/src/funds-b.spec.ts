/**
 * Funds B, step 1: shares in funds. Move money with two amounts (one typed in dollars) and the
 * holdings it leaves; a trade's From fund and To fund; a sale that needs a fund, from the bell
 * through Notifications to review (the only fund that could have sold, suggested); and an IRA's
 * default fund, previewed in the account editor.
 */
import { expect, test, type Page } from "@playwright/test";

import { importText, logIn, stored } from "./support.js";

const CASH = "Assets:Brokerage:Fidelity:Cash";
const VTI = "Assets:Brokerage:Fidelity:VTI";
const IRA = "Assets:Retirement:Roth-IRA";
const TEXT = `option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open ${CASH} USD
2026-01-01 open Assets:Brokerage:Fidelity:FXAIX
2026-01-01 open ${VTI}
2026-01-01 open ${IRA}:Cash USD
2026-01-01 open ${IRA}:FXAIX
2026-01-01 open Income:Capital-Gains
2026-01-01 open Equity:Opening-Balances

2026-01-01 * "Opening balance"
  ${CASH}  6000.00 USD
  Assets:Brokerage:Fidelity:FXAIX  200 FXAIX {150.00 USD}
  ${VTI}  50 VTI {250.00 USD}
  Equity:Opening-Balances

2026-01-01 * "Opening balance"
  ${IRA}:Cash  500.00 USD
  ${IRA}:FXAIX  20 FXAIX {100.00 USD}
  Equity:Opening-Balances

2026-11-01 price FXAIX 200.00 USD
2026-11-01 price VTI 300.00 USD
`;
const amount = (number: string, currency = "USD") => ({ number, currency });

/** A new user's book holding the brokerage and the IRA, with the funds named. */
async function sharesBook(page: Page, funds: string[]) {
  const session = await logIn(page);
  const { data } = await session.ledger.POST("/api/ledger/v1/books", { body: { name: "Ours" } });
  const book = data!.id;
  await importText(book, TEXT);
  for (const name of funds)
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/funds", {
      params: { path: { book_id: book } },
      body: { name, description: null, target: null },
    });
  const move = (to: string, number: string, currency = "USD") =>
    session.ledger.POST("/api/ledger/v1/books/{book_id}/fund-moves", {
      params: { path: { book_id: book } },
      body: {
        date: "2026-11-02",
        from_fund: "Unallocated",
        to_fund: to,
        amount: amount(number, currency),
        note: null,
      },
    });
  return { session, book, move };
}

test("Move money with two amounts, one typed in dollars; the Funds page shows holdings", async ({
  page,
}) => {
  const { book } = await sharesBook(page, ["Emergency", "Wedding"]);
  await page.goto(`/ui/books/${book}/funds`);
  await page.getByRole("button", { name: "Move money" }).click();
  const dialog = page.getByRole("dialog", { name: "Move money" });
  await dialog.getByRole("combobox", { name: "To" }).selectOption("Emergency");
  await dialog.getByRole("textbox", { name: "Amount of Cash" }).fill("4000");
  await dialog.getByRole("button", { name: "+ Another amount" }).click();
  await dialog
    .getByRole("group", { name: "FXAIX in" })
    .getByRole("button", { name: "Dollars" })
    .click();
  await dialog.getByRole("textbox", { name: "Amount of FXAIX" }).fill("8000");
  await expect(dialog).toContainText("$8,000.00 is 40 FXAIX at $200.00");
  await expect(dialog).toContainText(
    "Unallocated −$4,000.00 and −40 FXAIX → Emergency +$4,000.00 and +40 FXAIX"
  );
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const emergency = page.getByRole("link", { name: /Emergency/ }).first();
  await expect(emergency).toContainText("$12,000.00");
  await expect(emergency).toContainText("$4,000.00 · 40 FXAIX");

  // More shares than a fund has: Move waits.
  await page.getByRole("button", { name: "Move money" }).click();
  await dialog.getByRole("combobox", { name: "From" }).selectOption("Emergency");
  await dialog.getByRole("combobox", { name: "To" }).selectOption("Wedding");
  await dialog.getByRole("combobox", { name: "Of" }).selectOption("FXAIX");
  await dialog.getByRole("textbox", { name: "Amount of FXAIX" }).fill("41");
  await expect(dialog).toContainText("Emergency has 40 FXAIX");
  await expect(dialog.getByRole("button", { name: "Move", exact: true })).toBeDisabled();
});

test("a trade's From fund and To fund: one choice gives a fund the whole trade", async ({
  page,
}) => {
  const { session, book, move } = await sharesBook(page, ["Emergency"]);
  await move("Emergency", "3000.00");
  const { data: t } = await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book } },
    body: {
      date: "2026-11-03",
      flag: "!",
      payee: "Fidelity",
      narration: "Bought 10 VTI",
      postings: [
        { account: CASH, units: amount("-3000.00") },
        { account: VTI, units: amount("10", "VTI"), cost: { number: "300.00", currency: "USD" } },
      ],
    },
  });
  await page.goto(`/ui/books/${book}/transactions/${t!.id}`);
  const funds = page.getByRole("group", { name: "Funds" });
  await expect(funds).toContainText("Bought 10 VTI for $3,000.00.");
  await funds.getByRole("combobox", { name: "From fund" }).selectOption("Emergency");
  await expect(funds.getByRole("combobox", { name: "To fund" })).toHaveValue("Emergency");
  await expect(funds).toContainText("Emergency −$3,000.00 and +10 VTI");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(((await stored(book, t!.id)).funds ?? []).map((l) => [l.fund, l.amount.number])).toEqual([
    ["Emergency", "-3000.00"],
    ["Emergency", "10"],
  ]);
});

test("a sale that needs a fund: the bell, Notifications, and review's suggestion", async ({
  page,
}) => {
  const { session, book, move } = await sharesBook(page, ["Emergency", "Wedding"]);
  await move("Wedding", "50", "VTI");
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book }, query: { staging: true } },
    body: {
      date: "2026-11-04",
      flag: "!",
      payee: "Fidelity",
      narration: "Sold 20 VTI",
      postings: [
        { account: VTI, units: amount("-20", "VTI"), cost: { number: "250.00", currency: "USD" } },
        { account: CASH, units: amount("6100.00") },
        { account: "Income:Capital-Gains" },
      ],
    },
  });

  await page.goto(`/ui/books/${book}/funds`);
  await expect(page.getByRole("alert")).toContainText(
    "Your funds hold 20 VTI more than your accounts do."
  );
  await page.getByRole("link", { name: "Notifications: 1 needs attention" }).click();
  await expect(page.getByRole("heading", { name: "A sale needs a fund" })).toBeVisible();
  await expect(page.getByRole("listitem")).toContainText("takes 20 VTI from Unallocated");
  await page.getByRole("link", { name: "Give it a fund in review ›" }).click();

  const card = page.getByRole("article", { name: /Sold 20 VTI/ });
  await expect(card).toContainText("Needs a fund");
  await expect(card.getByRole("combobox", { name: "From fund" })).toHaveValue("Wedding");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
});

test("an IRA's default fund, previewed and saved in the account editor", async ({ page }) => {
  const { book } = await sharesBook(page, ["Retirement"]);
  await page.goto(`/ui/books/${book}/accounts/${encodeURIComponent(IRA)}/edit`);
  const card = page.getByRole("region", { name: `Default fund of ${IRA}` });
  await card.getByRole("combobox", { name: "Fund" }).selectOption("Retirement");
  await card.getByLabel("From", { exact: true }).fill("2026-01-01");
  await expect(card).toContainText("Retirement +$500.00 and +20 FXAIX (+$4,500.00)");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card).toContainText("Retirement from Jan 1");

  await page.goto(`/ui/books/${book}/funds/Retirement`);
  await expect(page.getByRole("main")).toContainText(`The default fund of ${IRA}`);
  await expect(page.getByRole("table", { name: "Holdings" })).toContainText("20 FXAIX");
});

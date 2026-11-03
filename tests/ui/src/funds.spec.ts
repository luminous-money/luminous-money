/**
 * Funds A: Kael's four examples first (a transfer for Emergency, spending from it, a paycheck
 * split 500/500, a move on the Funds page), then a review card's choice, Select mode's Fund…,
 * More options, archiving, a rule's fund on an import, a schedule's occurrence, and a writer, who
 * can choose funds and move money but not set them up.
 */
import { expect, test, type Page } from "@playwright/test";

import { addAccount, app, logIn, stored } from "./support.js";

const PNC = "Assets:Bank:PNC";
const FIDELITY = "Assets:Fidelity:Cash";
const REPAIRS = "Expenses:Home:Maintenance";
const SALARY = "Income:Salary";
const LONG = "Special Home Maintenance and Repair";
const usd = (number: string) => ({ number, currency: "USD" });
const BASE_URL = process.env.LUMINOUS_MONEY_URL ?? "http://localhost:8080";

/** A new user's book: PNC (with $10,000), the brokerage's cash, a repairs and a salary account,
 * and the funds named. */
async function fundsBook(page: Page, funds: { name: string; target?: string }[] = []) {
  const session = await logIn(page);
  const { data } = await session.ledger.POST("/api/ledger/v1/books", { body: { name: "Ours" } });
  const book = data!.id;
  await addAccount(book, PNC, "10000.00");
  await addAccount(book, FIDELITY, null);
  for (const name of [REPAIRS, SALARY])
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book } },
      body: { name, kind: "leaf" },
    });
  for (const f of funds)
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/funds", {
      params: { path: { book_id: book } },
      body: { name: f.name, description: null, target: f.target ? usd(f.target) : null },
    });
  /** A transaction from one account to another (confirmed unless `flag` says). */
  const add = async (
    from: string,
    to: string,
    amount: string,
    {
      flag = "*",
      payee = `${from} to ${to}`,
      funds = [] as { fund: string; amount: ReturnType<typeof usd> }[],
    } = {}
  ) => {
    const { data: t } = await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book } },
      body: {
        date: "2024-03-01",
        flag,
        payee,
        narration: "",
        postings: [
          { account: from, units: usd(`-${amount}`) },
          { account: to, units: usd(amount) },
        ],
        funds,
      },
    });
    return t!.id;
  };
  const lines = async (id: string) =>
    ((await stored(book, id)).funds ?? []).map((l) => [l.fund, l.amount.number]);
  return { session, book, add, lines };
}

const fundsSection = (page: Page) => page.getByRole("group", { name: "Funds" });

test("a transfer for Emergency: choosing the fund puts all of it there", async ({ page }) => {
  const { book, add, lines } = await fundsBook(page, [{ name: "Emergency" }]);
  const id = await add(PNC, FIDELITY, "2000.00", { payee: "To the brokerage" });
  await page.goto(`/ui/books/${book}/transactions/${id}`);

  const funds = fundsSection(page);
  await expect(funds).toContainText("$2,000.00 moving between accounts.");
  await expect(funds).toContainText("Unallocated +$0.00");
  await funds.getByRole("combobox", { name: "For fund" }).selectOption("Emergency");
  await expect(funds.getByRole("textbox", { name: "Amount for Emergency" })).toHaveValue("2000.00");
  await expect(funds).toContainText("Emergency +$2,000.00 · Unallocated −$2,000.00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(await lines(id)).toEqual([["Emergency", "2000.00"]]);

  // Its rows say so.
  await page.goto(`/ui/books/${book}/accounts/${encodeURIComponent(PNC)}`);
  await expect(
    page
      .getByRole("list", { name: "Transactions" })
      .getByRole("button", { name: /To the brokerage/ })
  ).toContainText("to Emergency");
});

test("spending from Emergency, and a note when that takes it below zero", async ({ page }) => {
  const { book, add, lines } = await fundsBook(page, [{ name: "Emergency" }]);
  await add(PNC, FIDELITY, "300.00", { funds: [{ fund: "Emergency", amount: usd("300.00") }] });
  const id = await add(PNC, REPAIRS, "500.00", { payee: "Plumber" });
  await page.goto(`/ui/books/${book}/transactions/${id}`);

  const funds = fundsSection(page);
  await expect(funds).toContainText("$500.00 going out.");
  const from = funds.getByRole("combobox", { name: "From fund" });
  await expect(from.getByRole("option", { name: "Emergency · $300.00" })).toHaveCount(1);
  await from.selectOption("Emergency");
  await expect(funds).toContainText("Emergency −$500.00 · Unallocated +$0.00");
  await expect(funds).toContainText("Emergency will be at −$200.00.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(await lines(id)).toEqual([["Emergency", "-500.00"]]);

  // Back to Unallocated: no lines.
  await from.selectOption("Unallocated");
  await expect(funds).toContainText("Unallocated −$500.00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => lines(id)).toEqual([]);
});

test("a paycheck split $500 and $500, and no more than came in", async ({ page }) => {
  const { book, add, lines } = await fundsBook(page, [{ name: "Emergency" }, { name: LONG }]);
  const id = await add(SALARY, PNC, "1000.00", { payee: "Acme" });
  await page.goto(`/ui/books/${book}/transactions/${id}`);

  const funds = fundsSection(page);
  await expect(funds).toContainText("$1,000.00 coming in.");
  await funds.getByRole("combobox", { name: "To fund" }).selectOption("Emergency");
  const first = funds.getByRole("textbox", { name: "Amount to Emergency" });
  await expect(first).toHaveValue("1000.00");
  await first.fill("1200");
  await expect(funds).toContainText(
    "Its funds get $1,200.00, more than the $1,000.00 that came in"
  );
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await first.fill("500");
  await funds.getByRole("button", { name: "+ Another fund" }).click();
  const second = funds.getByRole("combobox", { name: "To fund" }).nth(1);
  await second.selectOption(LONG);
  await expect(funds.getByRole("textbox", { name: `Amount to ${LONG}` })).toHaveValue("500.00");
  await expect(funds).toContainText(`Emergency +$500.00 · ${LONG} +$500.00 · Unallocated +$0.00`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(await lines(id)).toEqual([
    ["Emergency", "500.00"],
    [LONG, "500.00"],
  ]);
});

test("money moved between funds on the Funds page, and each fund's history", async ({ page }) => {
  const { book } = await fundsBook(page, [{ name: "Wedding", target: "10000.00" }]);
  await page.goto(`/ui/books/${book}/funds`);
  const totals = page.getByRole("region", { name: "Totals" });
  await expect(totals).toContainText("Net worth$10,000.00");
  await expect(totals).toContainText("Unallocated$10,000.00");

  await page.getByRole("button", { name: "Move money" }).click();
  const dialog = page.getByRole("dialog", { name: "Move money" });
  await expect(dialog.getByRole("combobox", { name: "From" })).toHaveValue("Unallocated");
  await expect(dialog.getByRole("combobox", { name: "To" })).toHaveValue("Wedding");
  await dialog.getByRole("textbox", { name: "Amount" }).fill("2,500");
  await expect(dialog).toContainText("Unallocated −$2,500.00 → Wedding +$2,500.00");
  await dialog.getByRole("textbox", { name: "Note" }).fill("Setting up");
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(dialog).toHaveCount(0);

  const wedding = page.getByRole("link", { name: /Wedding/ });
  await expect(wedding).toContainText("$2,500.00");
  await expect(wedding).toContainText("$7,500.00 to go · target $10,000.00");
  await expect(totals).toContainText("In funds$2,500.00");
  await expect(totals).toContainText("Unallocated$7,500.00");

  // Its page: the move in its history, opened to change it.
  await wedding.click();
  const history = page.getByRole("list", { name: "History" });
  await expect(history).toContainText("Moved from Unallocated");
  await expect(history).toContainText("Setting up");
  await history.getByRole("button", { name: /Moved from Unallocated/ }).click();
  const change = page.getByRole("dialog", { name: "Change the move" });
  await change.getByRole("textbox", { name: "Amount" }).fill("3000");
  await change.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("region", { name: "Balance" })).toContainText("$3,000.00");

  // Home shows the fund and Unallocated.
  await page.goto(`/ui/books/${book}`);
  const card = page.getByRole("region", { name: "Funds" });
  await expect(card).toContainText("Wedding");
  await expect(card).toContainText("$3,000.00");
  await expect(card).toContainText("Unallocated");
  await expect(card).toContainText("$7,000.00");
});

test("a review card's fund: the whole amount, and Unallocated clears it", async ({ page }) => {
  const { book, add, lines } = await fundsBook(page, [{ name: "Emergency" }]);
  const id = await add(PNC, REPAIRS, "80.00", { flag: "!", payee: "Hardware" });
  await page.goto(`/ui/books/${book}/review`);
  const card = page.getByRole("article").filter({ hasText: "Hardware" });
  const fund = card.getByRole("combobox", { name: "From fund" });
  await expect(fund).toHaveValue("");
  await fund.selectOption("Emergency");
  await expect.poll(() => lines(id)).toEqual([["Emergency", "-80.00"]]);
  await fund.selectOption("");
  await expect.poll(() => lines(id)).toEqual([]);
});

test("a review card with split lines shows them, and Edit… opens the page", async ({ page }) => {
  const { book, add } = await fundsBook(page, [{ name: "Emergency" }, { name: LONG }]);
  await add(SALARY, PNC, "1000.00", {
    flag: "!",
    payee: "Acme",
    funds: [
      { fund: "Emergency", amount: usd("400.00") },
      { fund: LONG, amount: usd("600.00") },
    ],
  });
  await page.goto(`/ui/books/${book}/review`);
  const card = page.getByRole("article").filter({ hasText: "Acme" });
  await expect(card.getByRole("combobox", { name: "To fund" })).toHaveCount(0);
  await expect(card.getByLabel("to Emergency")).toBeVisible();
  await expect(card.getByLabel(`to ${LONG}`)).toHaveAttribute("title", `${LONG} +$600.00`);
  await card.getByRole("link", { name: "Edit…" }).click();
  await expect(
    fundsSection(page).getByRole("textbox", { name: "Amount to Emergency" })
  ).toHaveValue("400.00");
});

test("Select mode's Fund… sets a fund on several at once, and clears them", async ({ page }) => {
  const { book, add, lines } = await fundsBook(page, [{ name: "Emergency" }]);
  const a = await add(PNC, REPAIRS, "20.00", { payee: "Shop A" });
  const b = await add(PNC, REPAIRS, "30.00", { payee: "Shop B" });
  await page.goto(`/ui/books/${book}/transactions`);
  const rows = page.getByRole("list", { name: "Transactions" });
  await expect(rows.getByRole("button", { name: /Shop B/ })).toBeVisible();

  const bar = page.getByRole("toolbar", { name: "Selected" });
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await rows.getByRole("checkbox", { name: /Shop A/ }).click();
  await rows.getByRole("checkbox", { name: /Shop B/ }).click();
  await bar.getByRole("button", { name: "Actions ▾" }).click();
  await page.getByRole("menuitem", { name: "Fund…" }).click();
  await bar.getByRole("combobox", { name: "Fund" }).selectOption("Emergency");
  await expect(bar).toContainText("Set the fund of 2 transactions to Emergency.");
  expect(await lines(a)).toEqual([["Emergency", "-20.00"]]);
  expect(await lines(b)).toEqual([["Emergency", "-30.00"]]);
  await expect(rows.getByLabel("from Emergency")).toHaveCount(2);

  await bar.getByRole("button", { name: "Actions ▾" }).click();
  await page.getByRole("menuitem", { name: "Fund…" }).click();
  await bar.getByRole("combobox", { name: "Fund" }).selectOption("Unallocated");
  await expect(bar).toContainText("Cleared the funds of 2 transactions.");
  await expect(rows.getByLabel("from Emergency")).toHaveCount(0);
});

test("More options on a transfer: from one fund, for another", async ({ page }) => {
  const { book, add, lines } = await fundsBook(page, [{ name: "Emergency" }, { name: "Vacation" }]);
  const id = await add(PNC, FIDELITY, "2000.00");
  await page.goto(`/ui/books/${book}/transactions/${id}`);

  const funds = fundsSection(page);
  await expect(funds.getByRole("group", { name: "Take from" })).toHaveCount(0);
  await funds.getByRole("button", { name: "More options" }).click();
  const take = funds.getByRole("group", { name: "Take from" });
  await take.getByRole("combobox", { name: "From fund" }).selectOption("Emergency");
  await expect(funds).toContainText("Emergency −$2,000.00 · Unallocated +$2,000.00");
  await funds.getByRole("combobox", { name: "For fund" }).selectOption("Vacation");
  await expect(funds).toContainText(
    "Vacation +$2,000.00 · Emergency −$2,000.00 · Unallocated +$0.00"
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(await lines(id)).toEqual([
    ["Vacation", "2000.00"],
    ["Emergency", "-2000.00"],
  ]);

  // Open on its own when the transaction takes from a fund.
  await page.reload();
  await expect(fundsSection(page).getByRole("group", { name: "Take from" })).toBeVisible();
});

test("archiving a fund moves what's left, and folds it away", async ({ page }) => {
  const { book, add } = await fundsBook(page, [{ name: "Emergency" }, { name: "Old car" }]);
  await add(PNC, FIDELITY, "400.00", { funds: [{ fund: "Old car", amount: usd("400.00") }] });
  await page.goto(`/ui/books/${book}/funds/${encodeURIComponent("Old car")}`);
  await page.getByRole("button", { name: "Archive…" }).click();
  const dialog = page.getByRole("dialog", { name: "Archive Old car" });
  await dialog.getByRole("combobox", { name: /What's left/ }).selectOption("Emergency");
  await dialog.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("region", { name: "Balance" })).toContainText("Archived");
  await expect(page.getByRole("button", { name: "Unarchive" })).toBeVisible();

  await page.getByRole("link", { name: "‹ Funds" }).click();
  await expect(page.getByRole("link", { name: /Emergency/ })).toContainText("$400.00");
  await expect(page.getByText("Archived (1)")).toBeVisible();
  // It's gone from the pickers.
  const id = await add(PNC, REPAIRS, "5.00");
  await page.goto(`/ui/books/${book}/transactions/${id}`);
  await expect(
    fundsSection(page)
      .getByRole("combobox", { name: "From fund" })
      .getByRole("option", { name: /Old car/ })
  ).toHaveCount(0);
});

test("a rule's fund: what it imports comes from the fund", async ({ page }) => {
  const { book } = await fundsBook(page, [{ name: "Emergency" }]);
  const rule = (await (
    await app(`/books/${book}/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Plumber",
        conditions: { account: PNC, key: null, contains: "plumb", min: null, max: null },
        account: REPAIRS,
        payee: "Plumber",
        auto_confirm: false,
      }),
    })
  ).json()) as { id: string };
  await page.goto(`/ui/books/${book}/rules/${rule.id}`);
  const fund = page.getByRole("combobox", { name: /Fund/ });
  await expect(fund).toHaveValue("");
  await fund.selectOption("Emergency");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: /Plumber/ })).toContainText("Emergency");

  await app(`/books/${book}/profiles/${encodeURIComponent(PNC)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        delimiter: ",",
        skip: 0,
        header: true,
        columns: ["Date", "Description", "Amount"],
        date: { column: 0, format: "MM/DD/YYYY" },
        amount: { kind: "signed", column: 2, negate: false },
        description: 1,
        payee: null,
        id: null,
        balance: null,
      },
    ]),
  });
  const form = new FormData();
  form.set("account", PNC);
  form.set(
    "file",
    new Blob(["Date,Description,Amount\n03/05/2024,ACE PLUMBING,-180.00\n"]),
    "f.csv"
  );
  await app(`/books/${book}/imports`, { method: "POST", body: form });

  await page.goto(`/ui/books/${book}/review`);
  const card = page.getByRole("article", { name: /ACE PLUMBING/ });
  await expect(card.getByRole("combobox", { name: "From fund" })).toHaveValue("Emergency");
});

test("a schedule's funds: the editor has them, and its occurrence carries them", async ({
  page,
}) => {
  const { book } = await fundsBook(page, [{ name: "Emergency" }]);
  const today = new Date().toISOString().slice(0, 10);
  await app(`/books/${book}/schedules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Savings",
      rule: { every: 1, unit: "month", days: [], start: today, until: null, weekend: "keep" },
      template: {
        payee: "Savings",
        narration: "",
        tags: [],
        links: [],
        meta: {},
        postings: [
          { account: PNC, units: usd("-250.00") },
          { account: FIDELITY, units: null },
        ],
        funds: [{ fund: "Emergency", amount: usd("250.00") }],
      },
    }),
  });
  await page.goto(`/ui/books/${book}/schedules`);
  await expect(page.getByRole("link", { name: /Savings/ })).toContainText("to Emergency");
  await page.getByRole("link", { name: /Savings/ }).click();
  const funds = fundsSection(page);
  await expect(funds.getByRole("combobox", { name: "For fund" })).toHaveValue("Emergency");
  await expect(funds).toContainText("Emergency +$250.00 · Unallocated −$250.00");

  await page.goto(`/ui/books/${book}/review`);
  const card = page.getByRole("article").filter({ hasText: "From a schedule" });
  await expect(card.getByRole("combobox", { name: "For fund" })).toHaveValue("Emergency");
});

test("a writer chooses funds and moves money, but doesn't set funds up", async ({
  page,
  browser,
}) => {
  const { session, book, add } = await fundsBook(page, [{ name: "Emergency" }]);
  const id = await add(PNC, REPAIRS, "50.00", { payee: "Hardware" });
  const theirs = await browser.newContext({ baseURL: BASE_URL });
  const writer = await theirs.newPage();
  const { email } = await logIn(writer);
  // The owner invites them; they accept (`app` acts as the last one logged in).
  const invite = (await (
    await fetch(`${BASE_URL}/api/app/v1/books/${book}/invites`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "write", email, label: "Writer" }),
    })
  ).json()) as { token: string };
  expect((await app(`/invites/${invite.token}/accept`, { method: "POST" })).status).toBe(200);

  await writer.goto(`/ui/books/${book}/funds`);
  await expect(writer.getByRole("button", { name: "Move money" })).toBeVisible();
  await expect(writer.getByRole("button", { name: "New fund" })).toHaveCount(0);
  await writer.goto(`/ui/books/${book}/transactions/${id}`);
  const from = fundsSection(writer).getByRole("combobox", { name: "From fund" });
  await expect(from.getByRole("option", { name: "New fund…" })).toHaveCount(0);
  await from.selectOption("Emergency");
  await writer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(writer.getByText("Saved", { exact: true })).toBeVisible();
  await writer.goto(`/ui/books/${book}/funds/Emergency`);
  await expect(writer.getByRole("button", { name: "Settings" })).toHaveCount(0);
  await expect(writer.getByRole("list", { name: "History" })).toContainText("Hardware");
  await theirs.close();
});

test("a manager makes a fund from the transaction's picker", async ({ page }) => {
  const { book, add, lines } = await fundsBook(page, [{ name: "Emergency" }]);
  const id = await add(SALARY, PNC, "300.00", { payee: "Bonus" });
  await page.goto(`/ui/books/${book}/transactions/${id}`);
  await fundsSection(page).getByRole("combobox", { name: "To fund" }).selectOption("New fund…");
  const dialog = page.getByRole("dialog", { name: "New fund" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("unallocated");
  await expect(dialog).toContainText("Unallocated is what isn't in a fund");
  await dialog.getByRole("textbox", { name: "Name" }).fill("emergency");
  await expect(dialog).toContainText("There's a fund called Emergency already");
  await dialog.getByRole("textbox", { name: "Name" }).fill("Vacation");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(fundsSection(page).getByRole("combobox", { name: "To fund" })).toHaveValue(
    "Vacation"
  );
  // The dialog's form isn't the page's: nothing was saved yet.
  expect(await lines(id)).toEqual([]);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => lines(id)).toEqual([["Vacation", "300.00"]]);
});

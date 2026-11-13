/** M9: bank feeds through SimpleFIN, against the e2e stack's fake SimpleFIN server. */
import { expect, test, type Page } from "@playwright/test";

import { app, setUpUser } from "./support.js";

const FAKE = process.env.SIMPLEFIN_FAKE_URL ?? "http://simplefin-fake:8080";
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

async function fake(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${FAKE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await response.json()) as Record<string, string>;
}

/** A bank at the fake with a checking account; returns a setup token for it. */
async function bank() {
  const { user, setup_token } = await fake("/control/users", "POST");
  await fake(`/control/users/${user}/accounts/chk`, "PUT", {
    name: "Everyday Checking",
    institution: "Fake Bank",
    balance: "1234.56",
  });
  await fake(`/control/users/${user}/accounts/chk/transactions`, "POST", [
    {
      id: "t1",
      posted: NOW - 30 * DAY,
      amount: "-25.00",
      description: "Coffee",
      memo: "POS CORNER CAFE",
      payee: "Corner Cafe",
    },
    {
      id: "t2",
      posted: NOW - 3 * DAY,
      amount: "-75.00",
      description: "Groceries",
      memo: "GREEN GROCER 0042",
      payee: "Green Grocer",
    },
  ]);
  return setup_token!;
}

async function connect(page: Page, book: string) {
  await page.goto(`/ui/books/${book}/connections`);
  await page.getByRole("textbox", { name: "Setup token" }).fill(await bank());
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("region", { name: /Connection to/ })).toContainText(
    "Everyday Checking"
  );
  // Named by the connection, not by every bank it reaches.
  await expect(page.getByRole("heading", { name: /^SimpleFIN [0-9a-f]{8}$/ })).toBeVisible();
}

test("connect a bank, link a new account, and see what the bank reports", async ({ page }) => {
  const { book } = await setUpUser(page);
  await connect(page, book.id);

  await page.getByRole("button", { name: "Link…" }).click();
  const form = page.getByRole("form", { name: "Link Everyday Checking" });
  await expect(form.getByRole("combobox", { name: "New account" })).toHaveValue(
    "Assets:Bank:Fake-Bank-Everyday-Checking"
  );
  await form.getByRole("button", { name: "Preview" }).click();
  // The history comes in the background; the preview fills in when it's here.
  const linking = page.getByRole("group", { name: /Linking to/ });
  await expect(linking.getByRole("region", { name: "What linking will do" })).toContainText(
    "Opening balance $1,334.56"
  );
  await linking.getByRole("button", { name: "Link", exact: true }).click();

  await page.getByRole("link", { name: "Fake Bank Everyday Checking" }).click();
  await expect(page.getByRole("heading", { name: /Fake Bank Everyday Checking/ })).toBeVisible();
  await expect(page.getByText(/^Reported today \d+:\d\d[ap]m: \$1,234\.56$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
});

test("reconciling marks what the bank doesn't know in review", async ({ page }) => {
  const { book, account, session } = await setUpUser(page);
  // setUpUser's account opened 2024-01-01 at 1,000.00; add a purchase the bank never saw.
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
    body: { name: "Expenses:Food", kind: "leaf" },
  });
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book.id } },
    body: {
      date: new Date((NOW - 10 * DAY) * 1000).toISOString().slice(0, 10),
      flag: "*",
      narration: "Cash I never spent",
      postings: [
        { account, units: { number: "-12.00", currency: "USD" } },
        { account: "Expenses:Food" },
      ],
    },
  });
  await connect(page, book.id);

  await page.getByRole("button", { name: "Link…" }).click();
  const form = page.getByRole("form", { name: "Link Everyday Checking" });
  await form.getByRole("radio", { name: "An account in this book" }).click();
  await form.getByRole("button", { name: "Account: none" }).click();
  await form.getByRole("combobox", { name: "Account" }).fill("PNC");
  await page.getByRole("option", { name: account }).click();
  await expect(form.getByRole("radio", { name: /Reconcile with the bank/ })).toBeChecked();
  await form.getByRole("button", { name: "Preview" }).click();
  const linking = page.getByRole("group", { name: /Linking to/ });
  const summary = linking.getByRole("region", { name: "What linking will do" });
  await expect(summary).toContainText("0 match yours");
  await expect(summary).toContainText("2 are new");
  await expect(summary).toContainText("1 of yours aren't at the bank");
  await expect(summary).toContainText("(was $1,000.00)");
  await linking.getByRole("button", { name: "Link", exact: true }).click();

  await expect(page.getByText(/Linked to/)).toBeVisible();
  await page.goto(`/ui/books/${book.id}/review`);
  await expect(page.getByText("Green Grocer").first()).toBeVisible();
  // Only the stray purchase is marked (its description is an input, so it's found by amount).
  await expect(page.getByText("Not at the bank", { exact: true })).toHaveCount(1);
  const stray = page.getByRole("listitem").filter({ hasText: "Not at the bank" });
  await expect(stray).toContainText("12.00");
});

test("a bank feed's problem is its connection's, unless it names an account; the bell has each", async ({
  page,
}) => {
  const { book } = await setUpUser(page);
  const { user, setup_token } = await fake("/control/users", "POST");
  await fake(`/control/users/${user}/accounts/chk`, "PUT", {
    name: "Everyday Checking",
    institution: "Fake Bank",
    balance: "100.00",
  });
  await fake(`/control/users/${user}/accounts/plan`, "PUT", {
    name: "College Plan",
    institution: "Fake 529 Plan",
    balance: "200.00",
  });
  const post = (path: string, body: unknown) =>
    app(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const connection = (await (await post("/simplefin/connections", { setup_token })).json()) as {
    id: string;
  };
  for (const [account_id, account] of [
    ["chk", "Assets:Bank:Checking"],
    ["plan", "Assets:College:Plan"],
  ])
    expect(
      (
        await post(`/books/${book.id}/simplefin/links`, {
          connection_id: connection.id,
          account_id,
          account,
          mode: "new",
        })
      ).status
    ).toBe(201);
  // The Bridge's own words (2026-11-12): a plain string, so the connection's. And one naming an
  // account, which is that account's.
  await fake(`/control/users/${user}/errors`, "PUT", {
    shape: "v1",
    errors: [
      { code: "gen.", msg: "Connection to Fake 529 Plan may need attention. Auth required" },
    ],
  });
  await post(`/simplefin/connections/${connection.id}/sync`, {});

  const plain = "Connection to Fake 529 Plan may need attention. Auth required";
  const accountPage = (account: string) =>
    page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);
  for (const account of ["Assets:College:Plan", "Assets:Bank:Checking"]) {
    await accountPage(account);
    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
    await expect(page.getByText(plain)).toHaveCount(0);
  }

  // The bell has it, linking to its connection; it can be dismissed there, and the connection
  // goes on saying it.
  await page.getByRole("link", { name: "Notifications: 1 needs attention" }).click();
  const notice = page.getByRole("listitem").filter({ hasText: "needs attention" });
  await expect(notice).toContainText(`SimpleFIN ${connection.id.slice(0, 8)} needs attention`);
  await expect(notice).toContainText(plain);
  await notice.getByRole("link", { name: "See the connection ›" }).click();
  await expect(page).toHaveURL(new RegExp(`connection=${connection.id}`));
  await expect(page.getByRole("region", { name: /Connection to/ })).toContainText(plain);
  await page.getByRole("link", { name: "Notifications: 1 needs attention" }).click();
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Nothing needs you right now.")).toBeVisible();

  // One naming an account is on that account's page, not the others'.
  await fake(`/control/users/${user}/errors`, "PUT", {
    shape: "v2",
    errors: [{ code: "con.auth", msg: "log in", account_id: "plan" }],
  });
  await post(`/simplefin/connections/${connection.id}/sync`, {});
  const said = "Your bank wants you to log in again at SimpleFIN Bridge.";
  await accountPage("Assets:College:Plan");
  await expect(page.getByRole("list", { name: "Bank feed problems" })).toContainText(said);
  await accountPage("Assets:Bank:Checking");
  await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
  await expect(page.getByText(said)).toHaveCount(0);
  await page.getByRole("link", { name: "Notifications: 1 needs attention" }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Fake 529 Plan wants you to log in again" })
  ).toBeVisible();
});

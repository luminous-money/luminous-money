/** M9: bank feeds through SimpleFIN, against the e2e stack's fake SimpleFIN server. */
import { expect, test, type Page } from "@playwright/test";

import { setUpUser } from "./support.js";

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
    { id: "t1", posted: NOW - 30 * DAY, amount: "-25.00", description: "Coffee", memo: "POS CORNER CAFE", payee: "Corner Cafe" },
    { id: "t2", posted: NOW - 3 * DAY, amount: "-75.00", description: "Groceries", memo: "GREEN GROCER 0042", payee: "Green Grocer" },
  ]);
  return setup_token!;
}

async function connect(page: Page, book: string) {
  await page.goto(`/ui/books/${book}/connections`);
  await page.getByRole("textbox", { name: "Setup token" }).fill(await bank());
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("region", { name: /Connection to/ })).toContainText("Everyday Checking");
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
  await expect(form.getByRole("region", { name: "What linking will do" })).toContainText(
    "Opening balance $1,334.56"
  );
  await form.getByRole("button", { name: "Link", exact: true }).click();

  await page.getByRole("link", { name: "Fake Bank Everyday Checking" }).click();
  await expect(page.getByRole("heading", { name: /Fake Bank Everyday Checking/ })).toBeVisible();
  await expect(page.getByText(/^Reported today \d+:\d\d[ap]m: \$1,234\.56$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
});

test("reconciling marks what the bank doesn't know in review", async ({ page }) => {
  const { book, account } = await setUpUser(page);
  // setUpUser's account opened 2024-01-01 at 1,000.00; add a purchase the bank never saw.
  await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);
  await connect(page, book.id);

  await page.getByRole("button", { name: "Link…" }).click();
  const form = page.getByRole("form", { name: "Link Everyday Checking" });
  await form.getByRole("radio", { name: "An account in this book" }).click();
  await form.getByRole("combobox", { name: "Account" }).click();
  await page.getByRole("option", { name: account }).click();
  await expect(form.getByRole("radio", { name: /Reconcile with the bank/ })).toBeChecked();
  await form.getByRole("button", { name: "Preview" }).click();
  const summary = form.getByRole("region", { name: "What linking will do" });
  await expect(summary).toContainText("0 match yours");
  await expect(summary).toContainText("2 are new");
  await expect(summary).toContainText("(was $1,000.00)");
  await form.getByRole("button", { name: "Link", exact: true }).click();

  await expect(page.getByText(/Linked to/)).toBeVisible();
  await page.goto(`/ui/books/${book.id}/review`);
  await expect(page.getByText("GREEN GROCER 0042")).toBeVisible();
});

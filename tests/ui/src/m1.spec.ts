/** M1: one bank account, end to end. */
import { expect, test, type Page } from "@playwright/test";

import { addTransactions, logIn, setUpUser } from "./support.js";

const menu = async (page: Page, item: string) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole(item === "Log out" ? "button" : "link", { name: item })
    .click();
};

test.describe("logged out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("arriving shows log in, with create account disabled for now", async ({ page }) => {
    await page.goto("/ui/");

    await expect(page.getByRole("button", { name: "Log in" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();

    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("button", { name: "Log in" })).toBeHidden();
  });
});

test("a new user sets up their books and first account, and lands home", async ({ page }) => {
  await logIn(page);
  await page.goto("/ui/");

  await expect(page.getByRole("heading", { name: "Let's set up your books" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name your books" }).fill("Kael and Jess");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Add an account to Kael and Jess")).toBeVisible();
  await page.getByRole("textbox", { name: "Account name" }).fill("Green Fi Joint");
  await expect(page.getByText("Kept in the ledger as Assets:Bank:Green-Fi-Joint")).toBeVisible();
  await page.getByRole("textbox", { name: "Current balance" }).fill("2,500.00");
  await page.getByLabel("Balance as of").fill("2024-01-01");
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page.getByRole("heading", { name: "Kael and Jess" })).toBeVisible();
  const card = page.getByRole("link", { name: /Green Fi Joint/ });
  await expect(card).toContainText("$2,500.00");
  await expect(card).toContainText("No imports yet");
});

test("the menu has home, manage books, review and log out", async ({ page }) => {
  const { book } = await setUpUser(page);
  await page.goto("/ui/");

  await menu(page, "Review");
  await expect(page).toHaveURL(new RegExp(`/ui/books/${book.id}/review$`));
  await menu(page, "Manage books");
  await expect(page.getByRole("heading", { name: "Manage books" })).toBeVisible();
  await menu(page, "Home");
  await expect(page.getByRole("heading", { name: "Kael Personal" })).toBeVisible();
  await menu(page, "Log out");
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("a book can be renamed", async ({ page }) => {
  await setUpUser(page);
  await page.goto("/ui/books");

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Book name" }).fill("Kael (personal)");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { name: "Kael (personal)" })).toBeVisible();
  await page.goto("/ui/");
  await expect(page.getByRole("heading", { name: "Kael (personal)" })).toBeVisible();
});

test.describe("an account's ledger", () => {
  test("pages 200 at a time, newest first, loading more as you scroll", async ({ page }) => {
    const { book, account } = await setUpUser(page);
    await addTransactions(book.id, account, 205);
    await page.goto("/ui/");
    await page.getByRole("link", { name: /PNC Checking/ }).click();

    const rows = page.getByRole("list", { name: "Transactions" }).getByRole("listitem");
    await expect(rows).toHaveCount(200);
    await expect(rows.first()).toContainText("Shop 205");
    await expect(rows.first()).toContainText("Food:Groceries");
    await expect(rows.first()).toContainText("$795.00"); // the running balance after all of them

    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows).toHaveCount(206); // the rest, and the opening balance
    await expect(rows.last()).toContainText("Opening balance");
  });

  test("shows the other account, or <multiple>; tapping opens the transaction, and back returns", async ({
    page,
  }) => {
    const { session, book, account } = await setUpUser(page);
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book.id } },
      body: { name: "Expenses:Home:Supplies", kind: "leaf" },
    });
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book.id } },
      body: { name: "Expenses:Food", kind: "leaf" },
    });
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book.id } },
      body: {
        date: "2024-03-01",
        flag: "!",
        payee: "Costco",
        narration: "",
        postings: [
          { account, units: { number: "-150.00", currency: "USD" } },
          { account: "Expenses:Food", units: { number: "100.00", currency: "USD" } },
          { account: "Expenses:Home:Supplies" },
        ],
      },
    });
    await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);

    const costco = page.getByRole("button", { name: /Costco/ });
    await expect(costco).toContainText("<multiple>");
    await expect(costco).toContainText("pending");
    await expect(page.getByRole("button", { name: /Opening balance/ })).toContainText(
      "Equity:Opening-Balances"
    );

    await costco.click();
    await expect(page.getByRole("heading", { name: "Transaction" })).toBeVisible();
    await page.getByRole("link", { name: "‹ Back" }).click();
    await expect(page.getByRole("heading", { name: "PNC Checking" })).toBeVisible();
  });

  test("the line above the transactions adds one", async ({ page }) => {
    const { session, book, account } = await setUpUser(page);
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book.id } },
      body: { name: "Expenses:Food:Restaurant", kind: "leaf" },
    });
    await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(account)}`);

    const add = page.getByRole("button", { name: "+ Add transaction" });
    const list = page.getByRole("list", { name: "Transactions" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    expect((await add.boundingBox())!.y).toBeLessThan((await list.boundingBox())!.y);
    await add.click();
    await expect(page.getByRole("heading", { name: "New transaction" })).toBeVisible();
    await page.getByRole("textbox", { name: "Payee" }).fill("Corner Cafe");
    const amounts = page.getByRole("textbox", { name: "Amount" });
    await amounts.nth(0).fill("-4.50");
    await page
      .getByRole("button", { name: /^Account:/ })
      .nth(1)
      .click();
    await page.getByRole("combobox", { name: "Account" }).fill("rest");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Balanced. The blank amount will be $4.50.")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("heading", { name: "PNC Checking" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Corner Cafe/ })).toContainText(
      "Food:Restaurant"
    );
    await expect(page.getByRole("button", { name: /Corner Cafe/ })).toContainText("$995.50");
  });

  test("imports into the account it's showing, and comes back", async ({ page }) => {
    const { session, book } = await setUpUser(page);
    const { data: savings } = await session.ledger.POST(
      "/api/ledger/v1/books/{book_id}/money-accounts",
      {
        params: { path: { book_id: book.id } },
        body: {
          display_name: "PNC Savings",
          money: "bank",
          currency: "USD",
          balance: "0",
          as_of: "2024-01-01",
        },
      }
    );
    await page.goto(`/ui/books/${book.id}/accounts/${encodeURIComponent(savings!.name)}`);

    await page.getByRole("link", { name: "Import transactions" }).click();
    await expect(page.getByRole("heading", { name: "Import transactions" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Account" })).toHaveValue(savings!.name);

    await page.getByRole("link", { name: "‹ Back" }).click();
    await expect(page.getByRole("heading", { name: "PNC Savings" })).toBeVisible();
  });
});

test("a transaction's Back and Save stay on screen, and settle into place at the end", async ({
  page,
}) => {
  const { session, book, account } = await setUpUser(page);
  await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
    body: { name: "Expenses:Food", kind: "leaf" },
  });
  const { data: big } = await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book.id } },
    body: {
      date: "2024-03-01",
      flag: "*",
      payee: "Costco",
      narration: "",
      postings: [
        { account, units: { number: "-12.00", currency: "USD" } },
        ...Array.from({ length: 12 }, () => ({
          account: "Expenses:Food",
          units: { number: "1.00", currency: "USD" },
        })),
      ],
    },
  });
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto(`/ui/books/${book.id}/transactions/${big!.id}`);

  const save = page.getByRole("button", { name: "Save" });
  const gapBelow = async () =>
    640 - (await save.boundingBox())!.y - (await save.boundingBox())!.height;
  await expect(page.getByRole("textbox", { name: "Amount" })).toHaveCount(13);
  await expect(save).toBeInViewport();
  await expect(page.getByRole("link", { name: "Back", exact: true })).toBeInViewport();
  expect(await gapBelow()).toBeLessThan(30); // pinned to the bottom of the screen

  await page.getByText("Early build").scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  expect(await gapBelow()).toBeGreaterThan(30); // back in place, with the page's end below it
});

const CSV = `Date,Description,Amount,Balance
01/01/2024,ALREADY IN THE OPENING BALANCE,-1.00,1000.00
03/01/2024,CORNER CAFE,-4.50,995.50
03/02/2024,WHOLE FOODS,-82.10,913.40
03/03/2024,ACME PAYROLL,2000.00,2913.40
`;

test("importing a CSV: profile it once, import, see the results, and re-import without duplicates", async ({
  page,
}) => {
  const { book, account } = await setUpUser(page);
  await page.goto("/ui/");
  await page.getByRole("link", { name: "Import transactions" }).click();

  await expect(page.getByRole("combobox", { name: "Account" })).toHaveValue(account);
  await expect(page.getByText("First import for this account")).toBeVisible();
  await page
    .getByLabel("CSV file")
    .setInputFiles({ name: "march.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });

  const profile = page.getByRole("region", { name: "CSV profile" });
  await expect(profile).toBeVisible();
  await expect(profile.getByRole("combobox", { name: "Date format" })).toHaveValue("MM/DD/YYYY");
  await expect(profile.getByRole("combobox", { name: "Running balance" })).toHaveValue("3");
  await expect(profile).toContainText("4 of the first 4 rows read cleanly");
  await profile.getByRole("button", { name: "Save and import" }).click();

  const results = page.getByRole("region", { name: "Import results" });
  await expect(results).toContainText("3 new transactions to review");
  await expect(results).toContainText("1 before the opening balance");

  await page.getByRole("button", { name: "Import another file" }).click();
  await expect(page.getByText("This account's CSV layout is known")).toBeVisible();
  await page
    .getByLabel("CSV file")
    .setInputFiles({ name: "march-again.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await expect(results).toContainText("0 new transactions to review");
  await expect(results).toContainText("3 already imported");

  await page.goto("/ui/");
  const card = page.getByRole("link", { name: /PNC Checking/ });
  await expect(card).toContainText("Last updated at:");
  await expect(card).toContainText("$2,913.40");

  await card.click();
  await expect(page.getByRole("button", { name: /CORNER CAFE/ })).toContainText("Uncategorized");
  await page.goto(`/ui/books/${book.id}/review`);
  await expect(page.getByRole("article")).toHaveCount(3);
});

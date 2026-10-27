/** Migrating from another system (GnuCash): every step, on a book already linked to its bank. */
import { expect, test, type Page } from "@playwright/test";

import { accounts, logIn, setUpUser } from "./support.js";

// GnuCash's exports, synthetic.
const TREE = [
  '"Type","Full Account Name","Account Name","Account Code","Description","Account Color","Notes","Symbol","Namespace","Hidden","Tax Info","Placeholder"',
  '"ASSET","Assets","Assets","","","","","USD","CURRENCY","F","F","T"',
  '"BANK","Assets:Current Assets:Checking Account","Checking Account","","","","","USD","CURRENCY","F","F","F"',
  '"EXPENSE","Expenses:Dining Out","Dining Out","","Restaurants and cafes","","","USD","CURRENCY","F","F","F"',
  '"EXPENSE","Expenses:Groceries","Groceries","","","","","USD","CURRENCY","F","F","F"',
  '"EXPENSE","Expenses:Old Hobby","Old Hobby","","","","","USD","CURRENCY","T","F","F"',
].join("\n");
const CHECKING = "Assets:Current Assets:Checking Account";
const split = (date: string, id: string, description: string, account: string, value: string) =>
  `"${date}","${id}","","${description}","","CURRENCY::USD","","","","${account}","x","","${value}","","${value}","n","","1"`;
const HISTORY = [
  '"Date","Transaction ID","Number","Description","Notes","Commodity/Currency","Void Reason","Action","Memo","Full Account Name","Account Name","Amount With Sym","Amount Num.","Value With Sym","Value Num.","Reconcile","Reconcile Date","Rate/Price"',
  ...["01", "08", "15"].flatMap((day, i) => [
    split(`06/${day}/2026`, `c${i}`, "Corner Cafe", CHECKING, "-4.50"),
    split(`06/${day}/2026`, `c${i}`, "Corner Cafe", "Expenses:Dining Out", "4.50"),
    split(`06/${day}/2026`, `g${i}`, "Fake Grocer", CHECKING, "-60.00"),
    split(`06/${day}/2026`, `g${i}`, "Fake Grocer", "Expenses:Groceries", "60.00"),
  ]),
].join("\n");

const file = (name: string, text: string) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(text),
});
const step = (page: Page, name: string) => page.getByRole("region", { name });

test("a GnuCash book comes in: accounts, history, the AI, rules and suggestions", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { session, book, account } = await setUpUser(page); // Assets:Bank:PNC-Checking
  const ledger = session.ledger;
  await ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
    body: { name: "Expenses:Uncategorized", kind: "leaf" },
  });
  for (const [narration, amount] of [
    ["SQ *CORNER CAFE #12 CHICAGO IL", "-5.25"],
    ["FAKE GROCER", "-71.10"],
  ] as const)
    await ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book.id } },
      body: {
        date: "2026-07-02",
        flag: "!",
        payee: null,
        narration,
        postings: [
          { account, units: { number: amount, currency: "USD" } },
          { account: "Expenses:Uncategorized" },
        ],
      },
    });

  await page.goto(`/ui/books/${book.id}/accounts`);
  await page
    .getByRole("region", { name: "Migrate from another system" })
    .getByRole("link", { name: "Migrate" })
    .click();
  await page.getByRole("button", { name: "Start, from GnuCash" }).click();

  // 1. The files.
  await page.getByLabel("GnuCash accounts file").setInputFiles(file("accounts.csv", TREE));
  await page.getByLabel("GnuCash transactions file").setInputFiles(file("txns.csv", HISTORY));
  await page.getByRole("button", { name: "Continue" }).click();

  // 2. The accounts: the old checking account is the one linked here.
  const preview = page.getByRole("region", { name: "What it adds" });
  await expect(preview).toContainText("3 accounts to add");
  await preview
    .getByRole("combobox", { name: "What Assets:Current-Assets:Checking-Account is" })
    .selectOption({ label: `Same as ${account}` });
  await expect(preview).toContainText("2 accounts to add");
  await expect(preview).toContainText("Expenses:Dining-Out from “Expenses:Dining Out”");
  await expect(preview.getByRole("region", { name: "Left out" })).toContainText(
    "Hidden in the other system: Expenses:Old-Hobby."
  );
  await preview.getByRole("button", { name: "Add 2 accounts" }).click();

  // 3. The history.
  await expect(step(page, "History")).toBeVisible();
  await page.getByRole("button", { name: "Read the history" }).click();
  const steps = page.getByRole("list", { name: "Steps" });
  await expect(steps).toContainText("History · 6 transactions, Jun 1 to Jun 15");

  // 4. Bank feeds: already linked elsewhere, so skipped.
  await step(page, "Bank feeds").getByRole("button", { name: "Skip" }).click();

  // 5. The AI, set up here (the fake provider).
  await step(page, "AI").getByRole("button", { name: "Set up the AI" }).click();
  const use = page.getByLabel("Use AI in this book");
  await use.click();
  await expect(use).toBeChecked();
  await page.getByRole("combobox", { name: "Provider" }).selectOption("fake");
  await page.getByRole("button", { name: "Continue with the AI" }).click();

  // 6. The reference.
  const reference = step(page, "Reference");
  await expect(reference).toContainText("2 payees from 6 imported transactions");
  await expect(reference.getByRole("list", { name: "Most frequent payees" })).toContainText(
    "Expenses:Groceries 100%"
  );
  await reference.getByRole("button", { name: "Use it" }).click();

  // 7. Rules: the café's, only.
  const rules = step(page, "Rules");
  await expect(rules.getByRole("checkbox")).toHaveCount(2);
  await expect(rules).toContainText("when the description has “corner cafe”");
  await rules.getByRole("checkbox", { name: /Fake Grocer/ }).uncheck();
  await rules.getByRole("button", { name: "Add 1 rule" }).click();

  // 8. Suggestions for the two waiting.
  const suggestions = step(page, "Suggestions");
  await expect(suggestions).toContainText("2 transactions are uncategorized.");
  await suggestions.getByRole("button", { name: "Suggest categories" }).click();
  await expect(suggestions).toContainText("2 transactions of 2 got a suggestion.", {
    timeout: 20_000,
  });
  await suggestions.getByRole("button", { name: "Continue" }).click();
  await step(page, "Finish").getByRole("button", { name: "Finish" }).click();

  // In review: the café by its rule, the grocer by the AI with the reference.
  await expect(page).toHaveURL(new RegExp(`/books/${book.id}/review`));
  const cafe = page.getByRole("article", { name: /CORNER CAFE/ });
  await expect(cafe.getByRole("button", { name: /^Category:/ })).toContainText("Dining-Out");
  const grocer = page.getByRole("article", { name: /FAKE GROCER/ });
  await expect(grocer.getByRole("button", { name: /^Category:/ })).toContainText("Groceries");
  await expect(grocer).toContainText("From the reference");

  // The accounts are there, and the migration's offer is gone.
  const names = (await accounts(book.id)).map((a) => a.name);
  expect(names).toEqual(expect.arrayContaining(["Expenses:Dining-Out", "Expenses:Groceries"]));
  expect(names).not.toContain("Assets:Current-Assets:Checking-Account");
  await page.goto(`/ui/books/${book.id}/accounts`);
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Migrate from another system" })).toHaveCount(0);
});

test("a new user's setup offers it, after naming the book", async ({ page }) => {
  await logIn(page);
  await page.goto("/ui/");
  await expect(page.getByRole("heading", { name: "Let's set up your books" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name your books" }).fill("Personal");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Migrate from another system" }).click();

  await expect(page.getByRole("heading", { name: "Migrate from another system" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start, from GnuCash" })).toBeVisible();
});

/** A transaction's splits: each shown as it is and opened in the split editor; several at once in
 * Select mode (a long press, or a click with Shift). */
import { expect, test } from "@playwright/test";

import { editSplit, setUpUser, splitRows, stored } from "./support.js";

const usd = (number: string) => ({ number, currency: "USD" });

test("splits are edited one at a time in the split editor, and tagged or deleted together", async ({
  page,
}) => {
  const { session, book, account } = await setUpUser(page);
  for (const name of ["Expenses:Food:Groceries", "Expenses:Home:Supplies"])
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book.id } },
      body: { name, kind: "leaf" },
    });
  const { data: made } = await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id: book.id } },
    body: {
      date: "2024-03-01",
      flag: "*",
      payee: "Costco",
      narration: "",
      postings: [
        { account, units: usd("-60.00") },
        { account: "Expenses:Food:Groceries", units: usd("20.00"), meta: { memo: "Bananas" } },
        { account: "Expenses:Food:Groceries", units: usd("25.00"), meta: { memo: "Bread" } },
        { account: "Expenses:Home:Supplies", units: usd("15.00"), meta: { memo: "Sponges" } },
      ],
    },
  });
  await page.goto(`/ui/books/${book.id}/transactions/${made!.id}`);
  const rows = splitRows(page);
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText("Bananas");
  await expect(rows.nth(1)).toContainText("Expenses:Food:Groceries");
  await expect(rows.nth(1)).toContainText("$20.00");

  // A split's memo is changed in its editor: Escape leaves it as it was, Enter saves it.
  const editor = page.getByRole("dialog", { name: "Split", exact: true });
  await rows.nth(1).click();
  await editor.getByRole("textbox", { name: "Memo" }).fill("Plantains");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(rows.nth(1)).toContainText("Bananas");
  await rows.nth(1).click();
  await editor.getByRole("textbox", { name: "Memo" }).fill("Plantains");
  await page.keyboard.press("Enter");
  await expect(editor).toBeHidden();
  await expect(rows.nth(1)).toContainText("Plantains");

  // A click with Shift starts Select mode; then a click selects. Add tag… tags them all.
  const bar = page.getByRole("toolbar", { name: "Selected" });
  await rows.nth(1).click({ modifiers: ["Shift"] });
  await expect(bar).toContainText("1 selected");
  await expect(page.getByRole("checkbox", { name: /Plantains/ })).toBeChecked();
  await rows.nth(2).click();
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: "Actions ▾" }).click();
  await page.getByRole("menuitem", { name: "Add tag…" }).click();
  const tag = bar.getByRole("combobox", { name: "Add tag" });
  await tag.fill("party");
  await tag.press("Enter");
  await expect(rows.nth(1)).toContainText("#party");
  await expect(rows.nth(2)).toContainText("#party");
  await expect(rows.nth(3)).not.toContainText("#party");
  await bar.getByRole("button", { name: "Done" }).click();
  await expect(bar).toBeHidden();

  // A long press starts it too (and doesn't open the split); Delete takes the selected out.
  const box = (await rows.nth(3).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(bar).toContainText("1 selected");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await bar.getByRole("button", { name: "Actions ▾" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByText("Off by -15.00 USD")).toBeVisible();

  // Nothing is saved until the transaction is.
  expect((await stored(book.id, made!.id)).postings).toHaveLength(4);
  await editSplit(page, 0, { amount: "-45.00" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const saved = await stored(book.id, made!.id);
  expect(
    saved.postings.map((p) => [p.account, p.units?.number, p.meta?.memo ?? null, p.tags])
  ).toEqual([
    [account, "-45.00", null, []],
    ["Expenses:Food:Groceries", "20.00", "Plantains", ["party"]],
    ["Expenses:Food:Groceries", "25.00", "Bread", ["party"]],
  ]);
});

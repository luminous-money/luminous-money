/** HSA tracking: an Amazon item marked FSA or HSA eligible is tagged, and review says the tag came
 * from Amazon's order; the book's AI page has "Suggest tags", on by default. (Made-up orders.) */
import { expect } from "@playwright/test";

import { test } from "./fixtures.js";
import { addAccount, app, setUpUser } from "./support.js";

const CARD = "Liabilities:Example-Visa";

test("an item Amazon marks eligible is tagged, and review says it came from Amazon", async ({
  page,
}) => {
  const { session, book } = await setUpUser(page);
  await addAccount(book.id, CARD, null);
  const { data: accounts } = await session.ledger.GET("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book.id } },
  });
  await session.ledger.PATCH("/api/ledger/v1/books/{book_id}/accounts/{account}", {
    params: { path: { book_id: book.id, account: CARD } },
    body: {
      updated_at: accounts!.find((a) => a.name === CARD)!.updated_at!,
      cards: [{ brand: "visa", last_four: "4242" }] as never,
    },
  });
  const sent = await app(`/books/${book.id}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      charges: [
        {
          id: "c1",
          shop: "amazon",
          date: "2026-03-10",
          amount: "-32.00",
          card: { last_four: "4242" },
          orders: [{ number: "111-0000000-0000001", url: null }],
          lines: [
            { text: "Digital thermometer", amount: "20.00", hsa_fsa_eligible: true },
            { text: "Coffee beans", amount: "12.00" },
          ],
          note: null,
        },
      ],
    }),
  });
  expect(sent.status).toBe(202);
  await expect
    .poll(async () => {
      const list = (await (await app(`/books/${book.id}/orders?shop=amazon`)).json()) as {
        state: string;
      }[];
      return list[0]?.state;
    })
    .toBe("read");

  await page.goto(`/ui/books/${book.id}/review`);
  const card = page.getByRole("article", { name: /^Amazon/ });
  await expect(card.getByRole("list", { name: "Where its tags came from" })).toHaveText(
    "#hsa-fsa-eligible on Digital thermometer from Amazon's order"
  );

  // No invoice came with it (this stack's shops has none), so it says it needs a receipt, and
  // lists every one without.
  await expect(card.getByText("HSA or FSA eligible, without a receipt")).toBeVisible();
  await card.getByRole("link", { name: "All without one" }).click();
  await expect(page).toHaveURL(/\/transactions\?tag=hsa-fsa-eligible&receipt=no/);
  await expect(page.getByRole("button", { name: "Remove no receipt" })).toBeVisible();
  const rows = page.getByRole("list", { name: "Transactions" }).getByRole("listitem");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Amazon");
});

test("the AI page's Suggest tags is on by default, and can be turned off", async ({ page }) => {
  const { book } = await setUpUser(page);
  await page.goto(`/ui/books/${book.id}/ai`);
  const use = page.getByLabel("Use AI in this book");
  await use.click();
  await expect(use).toBeChecked();
  await page.getByRole("combobox", { name: "Provider" }).selectOption("fake");

  const suggest = page.getByLabel("Suggest tags");
  await expect(suggest).toBeChecked();
  await suggest.click();
  await expect(suggest).not.toBeChecked();
  await page.reload();
  await expect(page.getByLabel("Suggest tags")).not.toBeChecked();
});

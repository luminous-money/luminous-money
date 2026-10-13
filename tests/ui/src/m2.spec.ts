/** M2: matches proposed on import, reviewed in the queue. */
import { expect, test } from "@playwright/test";

import { app, setUpUser } from "./support.js";

const PROFILE = {
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
};

test("the coffee example: both rows matched, swapped in review, confirmed, and one undone", async ({
  page,
}) => {
  const { session, book, account } = await setUpUser(page);
  for (const date of ["2024-03-05", "2024-03-07"]) {
    await session.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book.id } },
      body: {
        date,
        flag: "*",
        payee: "Corner Cafe",
        narration: "Coffee",
        postings: [
          { account, units: { number: "-5.00", currency: "USD" } },
          { account: "Equity:Opening-Balances" },
        ],
      },
    });
  }
  await app(`/books/${book.id}/profiles/${encodeURIComponent(account)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([PROFILE]),
  });
  const form = new FormData();
  form.set("account", account);
  form.set(
    "file",
    new Blob(["Date,Description,Amount\n03/07/2024,CAFE,-5.00\n03/08/2024,CAFE,-5.00\n"]),
    "cafe.csv"
  );
  await app(`/books/${book.id}/imports`, { method: "POST", body: form });

  await page.goto(`/ui/books/${book.id}/review`);
  const cards = page.getByRole("article");
  const fifth = cards.filter({ hasText: /^2024-03-05 · Bank/ });
  const seventh = cards.filter({ hasText: /^2024-03-07 · Bank/ });
  await expect(cards).toHaveCount(2);
  // Proximity pairs the 7th's row with the 7th's coffee: the accepted miss.
  await expect(seventh.getByRole("region", { name: "Match" })).toContainText(
    "Matches: CAFE · 2024-03-07"
  );
  await expect(fifth.getByRole("region", { name: "Match" })).toContainText(
    "Matches: CAFE · 2024-03-08"
  );

  await seventh.getByRole("button", { name: "Swap" }).click();
  await expect(fifth.getByRole("region", { name: "Match" })).toContainText(
    "Matches: CAFE · 2024-03-07"
  );
  await expect(seventh.getByRole("region", { name: "Match" })).toContainText(
    "Matches: CAFE · 2024-03-08"
  );

  await fifth.getByRole("button", { name: "Confirm" }).click();
  await expect(cards).toHaveCount(1);

  await seventh.getByRole("button", { name: "Not a match" }).click();
  const fresh = cards.filter({ hasText: "Imported as new" });
  await expect(fresh).toHaveCount(1);
  await expect(fresh).toContainText("2024-03-08");
  await expect(fresh.getByRole("button", { name: "Match with this" })).toBeVisible();
  await expect(cards).toHaveCount(1); // the 7th's coffee is no longer matched, so it left review
});

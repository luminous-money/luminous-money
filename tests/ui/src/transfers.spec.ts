/** Transfers paired in review: two imports (out of one account, into another) made one. */
import { expect, test } from "@playwright/test";

import { app, importText, logIn } from "./support.js";

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

test("a paired transfer shows what it was made of, and Reject brings the two back", async ({
  page,
}) => {
  const { ledger } = await logIn(page);
  const { data: book } = await ledger.POST("/api/ledger/v1/books", { body: { name: "Mine" } });
  await importText(
    book!.id,
    `option "operating_currency" "USD"
2026-01-01 open Assets:Fidelity:Cash USD
2026-01-01 open Assets:Bank:PNC-Checking USD
`
  );
  for (const [account, line] of [
    ["Assets:Fidelity:Cash", "10/10/2026,TRANSFER TO PNC,-14000.00"],
    ["Assets:Bank:PNC-Checking", "10/12/2026,TRANSFER FROM FIDELITY,14000.00"],
  ] as const) {
    await app(`/books/${book!.id}/profiles/${encodeURIComponent(account)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([PROFILE]),
    });
    const form = new FormData();
    form.set("account", account);
    form.set("file", new Blob([`Date,Description,Amount\n${line}\n`]), "f.csv");
    await app(`/books/${book!.id}/imports`, { method: "POST", body: form });
  }

  await page.goto(`/ui/books/${book!.id}/review`);
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(1);
  const note = cards.getByRole("note", { name: "Paired transfer" });
  await expect(note).toContainText("TRANSFER TO PNC");
  await expect(note).toContainText("TRANSFER FROM FIDELITY");

  await note.getByRole("button", { name: "Reject" }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole("note", { name: "Paired transfer" })).toHaveCount(0);
});

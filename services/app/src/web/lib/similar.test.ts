import type { Transaction } from "@fava-beans/ledger-client";
import { expect, it } from "vitest";

import { similarUnconfirmed } from "./similar.js";

let n = 0;
const t = (
  narration: string,
  account = "Assets:Checking",
  other = "Expenses:Uncategorized",
  flag = "!"
) =>
  ({
    id: `t${n++}`,
    date: "2024-03-01",
    flag,
    payee: null,
    narration,
    postings: [
      { account, units: { number: "-4.50", currency: "USD" } },
      { account: other, units: null },
    ],
  }) as unknown as Transaction;

it("finds unconfirmed ones with the same payee key in the same account, still undecided", () => {
  const picked = t("POS CORNER CAFE #1 CHICAGO IL", "Assets:Checking", "Expenses:Coffee");
  const same = t("CORNER CAFE #2 CHICAGO IL");
  const proposed = t("CORNER CAFE CHICAGO", "Assets:Checking", "Expenses:Food");
  const chosen = t("CORNER CAFE CHICAGO", "Assets:Checking", "Expenses:Gifts");
  const elsewhere = t("CORNER CAFE CHICAGO", "Liabilities:Card");
  const other = t("TEA HOUSE");
  const done = t("CORNER CAFE CHICAGO", "Assets:Checking", "Expenses:Uncategorized", "*");

  const found = similarUnconfirmed(
    picked,
    [picked, same, proposed, chosen, elsewhere, other, done],
    {
      [proposed.id]: {
        categorizer: "history",
        accounts: ["Expenses:Food"],
        payee: null,
        confidence: 0.5,
        reason: "",
      },
    }
  );

  expect(found.map((x) => x.id)).toEqual([same.id, proposed.id]);
});

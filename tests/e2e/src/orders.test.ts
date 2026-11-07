/** Amazon orders' step 2 through the real stack: a shop's reader hands the book its charges
 * (made up here), each itemized as a receipt is: paid from the account holding its card, made as
 * its own transaction until the bank's copy comes in, its lines its splits; one on a card no
 * account holds waits. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eventually, newUser, stackIsUp } from "./support.ts";

type User = Awaited<ReturnType<typeof newUser>>;
const CARD = "Liabilities:Example-Visa";

async function bookWithCard(user: User) {
  const created = await user.app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Ours",
      time_zone: "UTC",
      text: `option "operating_currency" "USD"
2026-01-01 open ${CARD} USD
2026-01-01 open Expenses:Household
`,
    }),
  });
  const book = ((await created.json()) as { id: string }).id;
  const { data: accounts } = await user.ledger.GET("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book } },
  });
  await user.ledger.PATCH("/api/ledger/v1/books/{book_id}/accounts/{account}", {
    params: { path: { book_id: book, account: CARD } },
    body: {
      updated_at: accounts!.find((a) => a.name === CARD)!.updated_at!,
      cards: [{ brand: "visa", last_four: "4242" }] as never,
    },
  });
  return book;
}

const charge = (id: string, last_four: string) => ({
  id,
  shop: "amazon",
  date: "2026-03-10",
  amount: "-27.00",
  card: { last_four },
  orders: [{ number: `111-${id}`, url: null }],
  lines: [
    { text: "Paper towels, 12 rolls", amount: "20.00" },
    { text: "Tax", amount: "2.00" },
    { text: "Coffee beans", amount: "10.00" },
    { text: "Gift card", amount: "-5.00", account: "Income:Gifts" },
  ],
  note: null,
});

type Stored = { id: string; state: string; detail: string | null; transaction_id: string | null };

describe("Shops' orders", () => {
  before(stackIsUp);

  it("itemizes a charge into a transaction paid from its card's account; one on another card waits", async () => {
    const user = await newUser();
    const book = await bookWithCard(user);

    const bad = await user.app(`/books/${book}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ charges: [{ ...charge("c0", "4242"), amount: "-30.00" }] }),
    });
    assert.equal(bad.status, 422);

    const sent = await user.app(`/books/${book}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ charges: [charge("c1", "4242"), charge("c2", "1881")] }),
    });
    assert.equal(sent.status, 202);
    assert.deepEqual(await sent.json(), { received: 2, new: 2 });

    const stored = await eventually(async () => {
      const list = (await (await user.app(`/books/${book}/orders?shop=amazon`)).json()) as Stored[];
      assert.equal(list.find((c) => c.id === "c1")?.state, "read");
      assert.ok(list.find((c) => c.id === "c2")?.detail, "c2 settled");
      return list;
    });
    const read = stored.find((c) => c.id === "c1")!;
    const waiting = stored.find((c) => c.id === "c2")!;
    assert.equal(waiting.state, "waiting");
    assert.match(waiting.detail!, /No account in this book holds the card ending 1881/);

    const { data: t } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      { params: { path: { book_id: book, directive_id: read.transaction_id! } } }
    );
    assert.equal(t!.flag, "!");
    assert.equal(t!.meta?.["source"], "order");
    assert.equal(t!.meta?.["order"], "Amazon 111-c1");
    assert.deepEqual(
      t!.postings.map((p) => [p.account, p.units?.number, p.meta?.["memo"] ?? null]),
      [
        [CARD, "-27.00", null],
        ["Expenses:Uncategorized", "20.00", "Paper towels, 12 rolls"],
        ["Expenses:Uncategorized", "2.00", "Tax"],
        ["Expenses:Uncategorized", "10.00", "Coffee beans"],
        ["Income:Gifts", "-5.00", "Gift card"],
      ]
    );

    // The same charges again change nothing.
    const again = await user.app(`/books/${book}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ charges: [charge("c1", "4242")] }),
    });
    assert.deepEqual(await again.json(), { received: 1, new: 0 });
  });
});

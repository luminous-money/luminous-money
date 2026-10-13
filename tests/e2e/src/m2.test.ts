/** M2 through the real stack: a transfer recognized by the second import, and reviewing
 * matches (swap, not a match, confirm). */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { newUser, stackIsUp } from "./support.ts";

type User = Awaited<ReturnType<typeof newUser>>;
type Row = { line: number; outcome: string; transaction_id: string; match: string | null };
type Proposed = Row & {
  batch_id: string;
  candidates: { transaction_id: string; holder: { line: number } | null }[];
};

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

async function setUp() {
  const user = await newUser();
  const { data: book } = await user.ledger.POST("/api/ledger/v1/books", { body: { name: "Mine" } });
  for (const name of ["Assets:Bank:Checking", "Liabilities:Card"]) {
    await user.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book!.id } },
      body: { name, kind: "leaf", opening_balance: null },
    });
    await user.app(`/books/${book!.id}/profiles/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([PROFILE]),
    });
  }
  return { user, book: book!.id };
}

async function upload(user: User, book: string, account: string, rows: string) {
  const form = new FormData();
  form.set("account", account);
  form.set("file", new Blob([`Date,Description,Amount\n${rows}`], { type: "text/csv" }), "f.csv");
  const response = await user.app(`/books/${book}/imports`, { method: "POST", body: form });
  assert.equal(response.status, 201);
  return (await response.json()) as { batch: { id: string }; rows: Row[] };
}

describe("matching on import", () => {
  before(stackIsUp);

  it("a payment categorized to the card on checking's import is matched by the card's", async () => {
    const { user, book } = await setUp();
    const checking = await upload(
      user,
      book,
      "Assets:Bank:Checking",
      "03/01/2024,PAYMENT TO CARD,-500.00\n"
    );
    const paymentId = checking.rows[0]!.transaction_id;
    const { data: payment } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      { params: { path: { book_id: book, directive_id: paymentId } } }
    );
    await user.ledger.PATCH("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
      params: { path: { book_id: book, directive_id: paymentId } },
      body: {
        updated_at: payment!.updated_at,
        postings: [payment!.postings[0]!, { account: "Liabilities:Card" }],
      },
    });

    const card = await upload(
      user,
      book,
      "Liabilities:Card",
      "03/03/2024,PAYMENT THANK YOU,500.00\n03/04/2024,BOOKSHOP,-20.00\n"
    );
    const again = await upload(
      user,
      book,
      "Liabilities:Card",
      "03/03/2024,PAYMENT THANK YOU,500.00\n03/04/2024,BOOKSHOP,-20.00\n"
    );

    assert.deepEqual(
      card.rows.map((r) => [r.outcome, r.match]),
      [
        ["matched", "proposed"],
        ["staged", null],
      ]
    );
    assert.equal(card.rows[0]!.transaction_id, paymentId);
    assert.deepEqual(
      again.rows.map((r) => r.outcome),
      ["duplicate", "duplicate"]
    );
    const { data: all } = await user.ledger.GET("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book } },
    });
    assert.equal(all!.length, 2); // the payment once, and the bookshop
  });
});

describe("reviewing matches", () => {
  before(stackIsUp);

  it("swap, not a match, and confirm", async () => {
    const { user, book } = await setUp();
    for (const date of ["2024-03-05", "2024-03-07"]) {
      await user.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
        params: { path: { book_id: book } },
        body: {
          date,
          flag: "*",
          narration: "Coffee",
          postings: [
            { account: "Assets:Bank:Checking", units: { number: "-5.00", currency: "USD" } },
            { account: "Expenses:Uncategorized" },
          ],
        },
      });
    }
    const imported = await upload(
      user,
      book,
      "Assets:Bank:Checking",
      "03/07/2024,CAFE,-5.00\n03/08/2024,CAFE,-5.00\n"
    );
    const batch = imported.batch.id;
    const [r7, r8] = imported.rows;
    const act = async (line: number, action: string, body?: unknown) => {
      const response = await user.app(`/books/${book}/imports/${batch}/rows/${line}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()) as Proposed[];
    };

    let proposed = await act(2, "assign", { transaction: r8!.transaction_id });
    assert.deepEqual(
      proposed.map((p) => p.transaction_id),
      [r8!.transaction_id, r7!.transaction_id]
    );

    proposed = await act(3, "assign", { transaction: null });
    assert.equal(proposed[1]!.outcome, "staged");

    proposed = await act(2, "confirm");
    assert.deepEqual(
      proposed.map((p) => p.line),
      [3]
    );
    const refused = await user.app(`/books/${book}/imports/${batch}/rows/2/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transaction: r7!.transaction_id }),
    });
    assert.equal(refused.status, 409);
  });
});

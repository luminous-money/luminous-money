import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { beancount, ledger, newBook, purchase, stackIsUp, stage, stagedText } from "./support.ts";

async function queue(book_id: string) {
  const { data } = await ledger.GET("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id }, query: { flag: "!" } },
  });
  return (data ?? []).map((t) => t.id);
}

describe("reviewing staged transactions (JSON)", () => {
  before(stackIsUp);

  it("stages, lists, and confirms a transaction", async () => {
    const book_id = await newBook("review");
    const entry = await stage(book_id, "Coffee");

    assert.equal(entry.flag, "!");
    assert.deepEqual(entry.postings[0]?.units, { number: "4.50", currency: "USD" });
    assert.deepEqual(await queue(book_id), [entry.id]);

    const { data: confirmed } = await ledger.POST(
      "/api/ledger/v1/books/{book_id}/directives/{directive_id}/confirm",
      { params: { path: { book_id, directive_id: entry.id } } }
    );

    assert.equal(confirmed?.flag, "*");
    assert.deepEqual(await queue(book_id), []);
  });

  it("edits a transaction in place, keeping its ID", async () => {
    const book_id = await newBook("edit");
    const entry = await stage(book_id, "Coffee");

    const { data: updated } = await ledger.PUT(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      {
        params: { path: { book_id, directive_id: entry.id } },
        body: { ...purchase("Coffee", "5.25"), flag: "*" },
      }
    );

    assert.equal(updated?.id, entry.id);
    assert.equal(updated?.flag, "*");
    assert.deepEqual(updated?.postings[0]?.units, { number: "5.25", currency: "USD" });
  });

  it("deletes a transaction", async () => {
    const book_id = await newBook("delete");
    const entry = await stage(book_id, "Coffee");
    const path = { params: { path: { book_id, directive_id: entry.id } } };

    const deleted = await ledger.DELETE(
      "/api/ledger/v1/books/{book_id}/directives/{directive_id}",
      path
    );
    const fetched = await ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      path
    );

    assert.equal(deleted.response.status, 204);
    assert.equal(fetched.response.status, 404);
  });

  it("rejects malformed transactions: bad amounts by schema, bad accounts by Beancount", async () => {
    const book_id = await newBook("malformed");
    const coffee = purchase("Coffee");

    for (const body of [
      { ...coffee, postings: [] },
      {
        ...coffee,
        postings: [{ account: "Expenses:Food", units: { number: "4.5.0", currency: "USD" } }],
      },
      { ...coffee, postings: [{ account: "expenses:food" }, { account: "Assets:Bank:Checking" }] },
    ]) {
      const { response } = await ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
        params: { path: { book_id } },
        body,
      });
      assert.equal(response.status, 422, JSON.stringify(body));
    }
  });

  it("reports validation problems against the transaction that caused them", async () => {
    const book_id = await newBook("problems");
    const bad = await stage(book_id, "Typo");
    await ledger.PUT("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
      params: { path: { book_id, directive_id: bad.id } },
      body: {
        ...purchase("Typo"),
        postings: [
          { account: "Expenses:Food", units: { number: "5", currency: "USD" } },
          { account: "Assets:Bank:Checking", units: { number: "-4", currency: "USD" } },
        ],
      },
    });

    const { data: problems } = await ledger.GET("/api/ledger/v1/books/{book_id}/problems", {
      params: { path: { book_id } },
    });

    assert.deepEqual(
      problems?.map((p) => p.directive_id),
      [bad.id]
    );
  });

  it("answers BQL queries over the booked book", async () => {
    const book_id = await newBook("query");
    await stage(book_id, "Coffee");
    await stage(book_id, "Muffin", "3.00");

    const { data } = await ledger.POST("/api/ledger/v1/books/{book_id}/query", {
      params: { path: { book_id } },
      ...beancount("SELECT sum(position) WHERE account ~ 'Food'"),
    });

    assert.deepEqual(data?.rows, [[["7.50 USD"]]]);
  });
});

describe("raw directives (Beancount text)", () => {
  before(stackIsUp);

  it("writes text and reads it back as JSON, and the reverse", async () => {
    const book_id = await newBook("text");

    const { data: written } = await ledger.POST("/api/ledger/v1/books/{book_id}/directives", {
      params: { path: { book_id } },
      ...beancount(stagedText("Coffee")),
    });
    const { data: asJson } = await ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      { params: { path: { book_id, directive_id: written?.id ?? "" } } }
    );
    const staged = await stage(book_id, "Muffin");
    const { data: asText } = await ledger.GET(
      "/api/ledger/v1/books/{book_id}/directives/{directive_id}",
      { params: { path: { book_id, directive_id: staged.id } } }
    );

    assert.equal(asJson?.narration, "Coffee");
    assert.match(asText?.text ?? "", /^2024-03-01 ! "Corner Cafe" "Muffin"$/m);
  });

  it("rejects text that isn't exactly one well-formed directive", async () => {
    const book_id = await newBook("malformed-text");

    for (const text of ["not beancount", stagedText("One") + "\n" + stagedText("Two")]) {
      const { response } = await ledger.POST("/api/ledger/v1/books/{book_id}/directives", {
        params: { path: { book_id } },
        ...beancount(text),
      });
      assert.equal(response.status, 422, text);
    }
  });
});

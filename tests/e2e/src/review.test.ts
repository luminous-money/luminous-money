import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { beancount, ledger, newBook, stackIsUp, staged } from "./support.ts";

async function create(book_id: string, text: string) {
  const { data, response } = await ledger.POST("/api/ledger/v1/books/{book_id}/directives", {
    params: { path: { book_id } },
    ...beancount(text),
  });
  assert.equal(response.status, 201);
  return data as { id: string; flag: string; text: string };
}

async function queue(book_id: string) {
  const { data } = await ledger.GET("/api/ledger/v1/books/{book_id}/directives", {
    params: { path: { book_id }, query: { flag: "!" } },
  });
  return (data ?? []).map((d) => d.id);
}

describe("reviewing staged transactions", () => {
  before(stackIsUp);

  it("stages, lists, and confirms a transaction", async () => {
    const book_id = await newBook("review");
    const entry = await create(book_id, staged("Coffee"));

    assert.equal(entry.flag, "!");
    assert.deepEqual(await queue(book_id), [entry.id]);

    const { data: confirmed } = await ledger.POST(
      "/api/ledger/v1/books/{book_id}/directives/{directive_id}/confirm",
      { params: { path: { book_id, directive_id: entry.id } } }
    );

    assert.equal((confirmed as { flag: string }).flag, "*");
    assert.deepEqual(await queue(book_id), []);
  });

  it("edits a transaction in place, keeping its ID", async () => {
    const book_id = await newBook("edit");
    const entry = await create(book_id, staged("Coffee"));

    const { data: updated } = await ledger.PUT(
      "/api/ledger/v1/books/{book_id}/directives/{directive_id}",
      {
        params: { path: { book_id, directive_id: entry.id } },
        ...beancount(staged("Coffee", "5.25")),
      }
    );

    assert.equal((updated as { id: string }).id, entry.id);
    assert.match((updated as { text: string }).text, /5\.25 USD/);
  });

  it("deletes a transaction", async () => {
    const book_id = await newBook("delete");
    const entry = await create(book_id, staged("Coffee"));
    const path = { params: { path: { book_id, directive_id: entry.id } } };

    const deleted = await ledger.DELETE(
      "/api/ledger/v1/books/{book_id}/directives/{directive_id}",
      path
    );
    const fetched = await ledger.GET(
      "/api/ledger/v1/books/{book_id}/directives/{directive_id}",
      path
    );

    assert.equal(deleted.response.status, 204);
    assert.equal(fetched.response.status, 404);
  });

  it("rejects text that isn't exactly one well-formed directive", async () => {
    const book_id = await newBook("malformed");

    for (const text of ["not beancount", staged("One") + "\n" + staged("Two")]) {
      const { response } = await ledger.POST("/api/ledger/v1/books/{book_id}/directives", {
        params: { path: { book_id } },
        ...beancount(text),
      });
      assert.equal(response.status, 422, text);
    }
  });

  it("reports validation problems against the directive that caused them", async () => {
    const book_id = await newBook("problems");
    const bad = await create(
      book_id,
      '2024-03-02 * "Typo"\n  Expenses:Food  5 USD\n  Assets:Bank:Checking  -4 USD\n'
    );

    const { data: problems } = await ledger.GET("/api/ledger/v1/books/{book_id}/problems", {
      params: { path: { book_id } },
    });

    assert.deepEqual(
      (problems as { directive_id: string }[]).map((p) => p.directive_id),
      [bad.id]
    );
  });

  it("answers BQL queries over the booked book", async () => {
    const book_id = await newBook("query");
    await create(book_id, staged("Coffee"));
    await create(book_id, staged("Muffin", "3.00"));

    const { data } = await ledger.POST("/api/ledger/v1/books/{book_id}/query", {
      params: { path: { book_id } },
      ...beancount("SELECT sum(position) WHERE account ~ 'Food'"),
    });

    assert.deepEqual((data as { rows: unknown }).rows, [[["7.50 USD"]]]);
  });
});

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { beancount, ledger, newBook, purchase, stackIsUp, stage, stagedText } from "./support.ts";

async function queue(book_id: string) {
  const { data } = await ledger.GET("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id }, query: { flag: "!" } },
  });
  return (data ?? []).map((t) => t.id);
}

function patch(
  book_id: string,
  directive_id: string,
  body: Record<string, unknown> & { updatedAt: string }
) {
  return ledger.PATCH("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
    params: { path: { book_id, directive_id } },
    body,
  });
}

describe("reviewing staged transactions (JSON)", () => {
  before(stackIsUp);

  it("stages, lists, and confirms a transaction", async () => {
    const book_id = await newBook("review");
    const entry = await stage(book_id, "Coffee");

    assert.equal(entry.flag, "!");
    assert.deepEqual(entry.postings[0]?.units, { number: "4.50", currency: "USD" });
    assert.deepEqual(await queue(book_id), [entry.id]);

    const { data: confirmed } = await patch(book_id, entry.id, {
      flag: "*",
      updatedAt: entry.updatedAt,
    });

    assert.equal(confirmed?.flag, "*");
    assert.deepEqual(await queue(book_id), []);
  });

  it("patches only the fields given, and moves the version forward", async () => {
    const book_id = await newBook("patch");
    const entry = await stage(book_id, "Coffee");

    const { data } = await patch(book_id, entry.id, {
      narration: "Latte",
      updatedAt: entry.updatedAt,
    });

    assert.equal(data?.narration, "Latte");
    assert.equal(data?.flag, "!");
    assert.deepEqual(data?.postings, entry.postings);
    assert.ok(data!.updatedAt > entry.updatedAt);
  });

  it("refuses an edit made against an old version", async () => {
    const book_id = await newBook("stale");
    const entry = await stage(book_id, "Coffee");
    await patch(book_id, entry.id, { flag: "*", updatedAt: entry.updatedAt });

    const late = await patch(book_id, entry.id, { narration: "Latte", updatedAt: entry.updatedAt });

    assert.equal(late.response.status, 409);
    const { data: stored } = await ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      {
        params: { path: { book_id, directive_id: entry.id } },
      }
    );
    assert.equal(stored?.flag, "*");
    assert.equal(stored?.narration, "Coffee");
  });

  it("replaces a whole transaction in place, keeping its ID", async () => {
    const book_id = await newBook("edit");
    const entry = await stage(book_id, "Coffee");

    const { data: updated } = await ledger.PUT(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      {
        params: { path: { book_id, directive_id: entry.id } },
        body: { ...purchase("Coffee", "5.25"), flag: "*", updatedAt: entry.updatedAt },
      }
    );

    assert.equal(updated?.id, entry.id);
    assert.equal(updated?.flag, "*");
    assert.deepEqual(updated?.postings[0]?.units, { number: "5.25", currency: "USD" });
  });

  it("deletes a transaction, given its version", async () => {
    const book_id = await newBook("delete");
    const entry = await stage(book_id, "Coffee");
    const path = { book_id, directive_id: entry.id };

    const unversioned = await ledger.DELETE(
      "/api/ledger/v1/books/{book_id}/directives/{directive_id}",
      {
        params: { path, query: {} as { updatedAt: string } },
      }
    );
    const deleted = await ledger.DELETE(
      "/api/ledger/v1/books/{book_id}/directives/{directive_id}",
      {
        params: { path, query: { updatedAt: entry.updatedAt } },
      }
    );
    const fetched = await ledger.GET("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
      params: { path },
    });

    assert.equal(unversioned.response.status, 422);
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
    await patch(book_id, bad.id, {
      postings: [
        { account: "Expenses:Food", units: { number: "5", currency: "USD" } },
        { account: "Assets:Bank:Checking", units: { number: "-4", currency: "USD" } },
      ],
      updatedAt: bad.updatedAt,
    });

    const { data: problems } = await ledger.GET("/api/ledger/v1/books/{book_id}/problems", {
      params: { path: { book_id } },
    });

    assert.deepEqual(
      problems?.map((p) => p.directiveId),
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
      {
        params: { path: { book_id, directive_id: written?.id ?? "" } },
      }
    );
    const staged = await stage(book_id, "Muffin");
    const { data: asText } = await ledger.GET(
      "/api/ledger/v1/books/{book_id}/directives/{directive_id}",
      {
        params: { path: { book_id, directive_id: staged.id } },
      }
    );

    assert.equal(asJson?.narration, "Coffee");
    assert.equal(asJson?.updatedAt, written?.updatedAt);
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

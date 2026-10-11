import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { OPENING, beancount, ledger, newBook, stackIsUp, uniqueBook } from "./support.ts";

describe("books", () => {
  before(stackIsUp);

  it("creates an empty book, and refuses to create it twice", async () => {
    const book_id = uniqueBook("empty");

    const created = await ledger.PUT("/api/ledger/v1/books/{book_id}", {
      params: { path: { book_id } },
    });
    const again = await ledger.PUT("/api/ledger/v1/books/{book_id}", {
      params: { path: { book_id } },
    });
    const { data: books } = await ledger.GET("/api/ledger/v1/books");

    assert.equal(created.response.status, 201);
    assert.equal(again.response.status, 409);
    assert.ok(books?.some((b) => b.id === book_id));
  });

  it("imports Beancount text and exports it back with a stable ID on every directive", async () => {
    const book_id = uniqueBook("import");

    const { data: applied } = await ledger.POST("/api/ledger/v1/books/{book_id}/import", {
      params: { path: { book_id } },
      ...beancount(OPENING),
    });
    const { data: exported } = await ledger.GET("/api/ledger/v1/books/{book_id}/export", {
      params: { path: { book_id } },
      parseAs: "text",
    });

    assert.deepEqual(applied, { put: 2, deleted: 0 });
    assert.match(exported ?? "", /open Assets:Bank:Checking/);
    assert.equal((exported ?? "").match(/^ {2}id: "[0-9a-f]{32}"$/gm)?.length, 2);
  });

  it("re-importing an export changes nothing", async () => {
    const book_id = await newBook("reimport");
    const path = { params: { path: { book_id } }, parseAs: "text" as const };
    const { data: first } = await ledger.GET("/api/ledger/v1/books/{book_id}/export", path);

    await ledger.POST("/api/ledger/v1/books/{book_id}/import", {
      params: { path: { book_id } },
      ...beancount(first ?? ""),
    });
    const { data: second } = await ledger.GET("/api/ledger/v1/books/{book_id}/export", path);

    assert.equal(second, first);
  });

  it("lists the chart of accounts: top-level and implicit nodes, opened leaves", async () => {
    const book_id = await newBook("accounts");

    const { data } = await ledger.GET("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id } },
    });

    const summary = data?.map(
      (a) => `${a.name} ${a.type} ${a.kind}${a.implicit ? " implicit" : ""}`
    );
    assert.deepEqual(summary, [
      "Assets asset node implicit",
      "Assets:Bank asset node implicit",
      "Assets:Bank:Checking asset leaf",
      "Equity equity node implicit",
      "Expenses expense node implicit",
      "Expenses:Food expense leaf",
      "Income income node implicit",
      "Liabilities liability node implicit",
    ]);
  });

  it("creates accounts under nodes only, and never posts to nodes", async () => {
    const book_id = await newBook("create-account");
    const create = (name: string, kind: "leaf" | "node" = "leaf") =>
      ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
        params: { path: { book_id } },
        body: { name, kind },
      });

    const leaf = await create("Assets:Bank:Savings");
    const underLeaf = await create("Expenses:Food:Snacks");
    const node = await create("Expenses:Utilities", "node");
    const again = await create("Expenses:Utilities", "node");
    const toNode = await ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id } },
      body: {
        date: "2024-03-01",
        flag: "!",
        narration: "Power bill",
        postings: [
          { account: "Expenses:Utilities", units: { number: "10", currency: "USD" } },
          { account: "Assets:Bank:Checking" },
        ],
      },
    });

    assert.equal(leaf.response.status, 201);
    assert.equal(leaf.data?.kind, "leaf");
    assert.equal(underLeaf.response.status, 422);
    assert.equal(node.data?.kind, "node");
    assert.equal(again.response.status, 409);
    assert.equal(toNode.response.status, 422);
  });

  it("answers 404 for a book that doesn't exist", async () => {
    const { response } = await ledger.GET("/api/ledger/v1/books/{book_id}/export", {
      params: { path: { book_id: uniqueBook("missing") } },
    });

    assert.equal(response.status, 404);
  });
});

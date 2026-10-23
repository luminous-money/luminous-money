import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { ledger, newBook, stackIsUp, stage } from "./support.ts";

async function backup(since?: number) {
  const { data } = await ledger.GET("/api/ledger/v1/backup", {
    params: { query: since === undefined ? {} : { since } },
  });
  assert.ok(data);
  return data;
}

describe("backups", () => {
  before(stackIsUp);

  it("carries only what changed since the cursor", async () => {
    const book_id = await newBook("backup");
    const full = await backup();
    assert.match(full.chunks[book_id] ?? "", /open Expenses:Food/);

    const entry = await stage(book_id, "Coffee");
    const increment = await backup(full.cursor);

    // Other books may change concurrently on a shared stack; this book's chunk is what matters.
    const chunk = increment.chunks[book_id] ?? "";
    assert.ok(increment.cursor > full.cursor);
    assert.ok(chunk.includes(entry.id));
    assert.doesNotMatch(chunk, /open Expenses:Food/);
  });

  it("carries deletions as tombstones", async () => {
    const book_id = await newBook("tombstone");
    const entry = await stage(book_id, "Coffee");
    const before = await backup();

    await ledger.DELETE("/api/ledger/v1/books/{book_id}/directives/{directive_id}", {
      params: {
        path: { book_id, directive_id: entry.id },
        query: { updated_at: entry.updated_at },
      },
    });
    const increment = await backup(before.cursor);

    assert.match(
      increment.chunks[book_id] ?? "",
      new RegExp(`custom "luminous-money" "deleted" "${entry.id}"`)
    );
  });
});

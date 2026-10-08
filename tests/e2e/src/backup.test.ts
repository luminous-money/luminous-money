import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { beancount, ledger, newBook, stackIsUp, staged } from "./support.ts";

type Backup = { since: number; cursor: number; chunks: Record<string, string> };

async function backup(since?: number): Promise<Backup> {
  const { data } = await ledger.GET("/api/ledger/v1/backup", {
    params: { query: since === undefined ? {} : { since } },
  });
  return data as Backup;
}

describe("backups", () => {
  before(stackIsUp);

  it("carries only what changed since the cursor", async () => {
    const book_id = await newBook("backup");
    const full = await backup();
    assert.match(full.chunks[book_id] ?? "", /open Expenses:Food/);

    const { data: entry } = await ledger.POST("/api/ledger/v1/books/{book_id}/directives", {
      params: { path: { book_id } },
      ...beancount(staged("Coffee")),
    });
    const increment = await backup(full.cursor);

    // Other books may change concurrently on a shared stack; this book's chunk is what matters.
    const chunk = increment.chunks[book_id] ?? "";
    assert.ok(increment.cursor > full.cursor);
    assert.ok(chunk.includes((entry as { id: string }).id));
    assert.doesNotMatch(chunk, /open Expenses:Food/);
  });

  it("carries deletions as tombstones", async () => {
    const book_id = await newBook("tombstone");
    const { data: entry } = await ledger.POST("/api/ledger/v1/books/{book_id}/directives", {
      params: { path: { book_id } },
      ...beancount(staged("Coffee")),
    });
    const directive_id = (entry as { id: string }).id;
    const before = await backup();

    await ledger.DELETE("/api/ledger/v1/books/{book_id}/directives/{directive_id}", {
      params: { path: { book_id, directive_id } },
    });
    const increment = await backup(before.cursor);

    assert.match(
      increment.chunks[book_id] ?? "",
      new RegExp(`custom "fava-beans" "deleted" "${directive_id}"`)
    );
  });
});

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, OPENING, newUser, stackIsUp } from "./support.ts";

type BookInfo = { id: string; name: string; updated_at: string; time_zone: string | null };

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function create(user: Awaited<ReturnType<typeof newUser>>, body: object) {
  const response = await user.app("/books", json({ time_zone: "America/Chicago", ...body }));
  return { status: response.status, book: (await response.json()) as BookInfo };
}

describe("M6: books", () => {
  before(stackIsUp);

  it("are created with their time zone, listed with it, and named uniquely per user", async () => {
    const me = await newUser();
    const other = await newUser();

    const created = await create(me, { name: "Household" });
    const twice = await create(me, { name: "household" });
    const badZone = await create(me, { name: "Elsewhere", time_zone: "Mars/Olympus" });
    const theirs = await create(other, { name: "Household" });
    const listed = (await (await me.app("/books")).json()) as BookInfo[];

    assert.equal(created.status, 201);
    assert.equal(created.book.time_zone, "America/Chicago");
    assert.equal(twice.status, 422);
    assert.equal(badZone.status, 422);
    assert.equal(theirs.status, 201);
    assert.deepEqual(
      listed.map((b) => [b.name, b.time_zone]),
      [["Household", "America/Chicago"]]
    );
    assert.equal((await fetch(`${BASE_URL}/api/app/v1/books`)).status, 401);
  });

  it("are created from an export as a copy, and not at all from text that doesn't parse", async () => {
    const me = await newUser();
    const original = await create(me, { name: "Original", text: OPENING });
    const exported = await me.ledger.GET("/api/ledger/v1/books/{book_id}/export", {
      params: { path: { book_id: original.book.id } },
      parseAs: "text",
    });

    const copy = await create(me, { name: "Restored", text: exported.data });
    const broken = await create(me, { name: "Broken", text: "2024-01-01 open\n" });
    const accounts = await me.ledger.GET("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: copy.book.id } },
    });
    const listed = (await (await me.app("/books")).json()) as BookInfo[];

    assert.equal(copy.status, 201);
    assert.equal(copy.book.name, "Restored");
    assert.ok(accounts.data?.some((a) => a.name === "Assets:Bank:Checking"));
    assert.equal(broken.status, 422);
    assert.deepEqual(
      listed.map((b) => b.name),
      ["Original", "Restored"]
    );
  });

  it("are deleted against the version read, with everything in them, and backups carry it", async () => {
    const me = await newUser();
    const other = await newUser();
    const { book } = await create(me, { name: "Doomed", text: OPENING });
    await create(me, { name: "Kept" });
    await me.app(`/books/${book.id}/stars/${encodeURIComponent("Assets:Bank:Checking")}`, {
      method: "PUT",
    });
    const { data: before } = await me.ledger.GET("/api/ledger/v1/backup");
    const remove = (who: typeof me, version: string) =>
      who.app(`/books/${book.id}?updated_at=${encodeURIComponent(version)}`, { method: "DELETE" });

    assert.equal((await remove(me, "stale")).status, 409);
    assert.equal((await remove(other, book.updated_at)).status, 404);
    assert.equal((await remove(me, book.updated_at)).status, 204);

    const listed = (await (await me.app("/books")).json()) as BookInfo[];
    const { data: after } = await me.ledger.GET("/api/ledger/v1/backup", {
      params: { query: { since: before!.cursor } },
    });
    assert.deepEqual(
      listed.map((b) => b.name),
      ["Kept"]
    );
    assert.equal((await me.app(`/books/${book.id}/stars`)).status, 404);
    assert.equal(
      (
        await me.ledger.GET("/api/ledger/v1/books/{book_id}", {
          params: { path: { book_id: book.id } },
        })
      ).response.status,
      404
    );
    assert.deepEqual(after?.deleted_books, [book.id]);
    assert.match(after?.chunks[book.id] ?? "", /custom "fava-beans" "deleted"/);
    assert.equal((await create(me, { name: "Doomed" })).status, 201);
  });
});

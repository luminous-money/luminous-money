/** M3 through the real stack: schedules stage their occurrences, an import matches one, and
 * edits are versioned and never backfill. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { newUser, stackIsUp } from "./support.ts";

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

type Schedule = {
  id: string;
  updated_at: string;
  generated_through: string | null;
  next: { date: string } | null;
};

async function setUp() {
  const user = await newUser();
  const { data: book } = await user.ledger.POST("/api/ledger/v1/books", { body: { name: "Mine" } });
  for (const name of ["Assets:Bank:Checking", "Expenses:Rent"]) {
    await user.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book!.id } },
      body: { name, kind: "leaf", opening_balance: null },
    });
  }
  const json = (method: string, path: string, body?: unknown) =>
    user.app(`/books/${book!.id}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { user, book: book!.id, json };
}

const rent = (start: string) => ({
  name: "Rent",
  rule: { every: 1, unit: "month", days: [], start, until: null, weekend: "keep" },
  template: {
    payee: "Landlord",
    narration: "Rent",
    tags: [],
    links: [],
    meta: {},
    postings: [
      { account: "Assets:Bank:Checking", units: { number: "-1500.00", currency: "USD" } },
      { account: "Expenses:Rent", units: null },
    ],
  },
});

describe("schedules", () => {
  before(stackIsUp);

  it("stage their due occurrences as pending, marked transactions, once", async () => {
    const { user, book, json } = await setUp();
    const start = day(-40); // two occurrences are due: 40 days ago, and a month after

    const created = await json("POST", "/schedules", rent(start));
    const schedule = (await created.json()) as Schedule;
    await json("POST", "/schedules/run");

    assert.equal(created.status, 201);
    const { data: staged } = await user.ledger.GET("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book }, query: { flag: "!" } },
    });
    assert.equal(staged!.length, 2);
    assert.equal(staged![0]!.date, start);
    assert.deepEqual(staged![0]!.meta, { schedule: schedule.id, "schedule-date": start });
    const marks = (await (await json("GET", "/schedules/occurrences")).json()) as Record<
      string,
      string
    >;
    assert.deepEqual(new Set(Object.values(marks)), new Set([schedule.id]));
    assert.ok(schedule.next && schedule.next.date > day(0));
  });

  it("stage transactions an import then matches", async () => {
    const { user, book, json } = await setUp();
    await json("POST", "/schedules", rent(day(-3)));
    await json("PUT", `/profiles/${encodeURIComponent("Assets:Bank:Checking")}`, [
      {
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
      },
    ]);
    const form = new FormData();
    form.set("account", "Assets:Bank:Checking");
    form.set(
      "file",
      new Blob([`Date,Description,Amount\n${mdy(day(-2))},RENT PAYMENT,-1500.00\n`]),
      "f.csv"
    );

    const imported = (await (
      await user.app(`/books/${book}/imports`, { method: "POST", body: form })
    ).json()) as { rows: { outcome: string }[] };

    assert.deepEqual(
      imported.rows.map((r) => r.outcome),
      ["matched"]
    );
  });

  it("are edited with versions, never backfill, and leave what they staged when deleted", async () => {
    const { user, book, json } = await setUp();
    const schedule = (await (await json("POST", "/schedules", rent(day(5)))).json()) as Schedule;

    const edited = await json("PATCH", `/schedules/${schedule.id}`, {
      updated_at: schedule.updated_at,
      rule: rent(day(-90)).rule, // started three months ago: nothing past is staged
    });
    const stale = await json("PATCH", `/schedules/${schedule.id}`, {
      updated_at: schedule.updated_at,
      name: "Flat",
    });
    const current = (await edited.json()) as Schedule;

    assert.equal(edited.status, 200);
    assert.equal(stale.status, 409);
    const { data: all } = await user.ledger.GET("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book } },
    });
    assert.equal(all!.length, 0);
    assert.ok(current.next && current.next.date >= day(0));

    const removed = await json(
      "DELETE",
      `/schedules/${schedule.id}?updated_at=${encodeURIComponent(current.updated_at)}`
    );
    assert.equal(removed.status, 204);
    assert.equal((await json("GET", `/schedules/${schedule.id}`)).status, 404);
  });

  it("refuse a template that can't be staged, and are the owner's alone", async () => {
    const { book, json } = await setUp();
    const bad = rent(day(0));
    bad.template.postings[1]!.account = "Expenses:Nope";

    assert.equal((await json("POST", "/schedules", bad)).status, 422);
    assert.equal((await (await newUser()).app(`/books/${book}/schedules`)).status, 404);
  });
});

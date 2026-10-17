/** M3 through the real stack: schedules stage their occurrences, an import matches one, and
 * edits are versioned and never backfill. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { newUser, stackIsUp } from "./support.ts";

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

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

type Schedule = {
  id: string;
  auto_confirm: boolean;
  updated_at: string;
  last_applied: string | null;
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

  it("stage their due occurrences as unconfirmed, marked transactions, once", async () => {
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

  it("match within a split's tolerance, and the bank's amount wins on confirm", async () => {
    const { user, book, json } = await setUp();
    const tolerant = rent(day(-3));
    (tolerant.template.postings[0] as Record<string, unknown>).tolerance = "25.00";
    await json("POST", "/schedules", tolerant);
    await json("PUT", `/profiles/${encodeURIComponent("Assets:Bank:Checking")}`, [PROFILE]);
    const form = new FormData();
    form.set("account", "Assets:Bank:Checking");
    form.set(
      "file",
      new Blob([`Date,Description,Amount\n${mdy(day(-2))},RENT,-1512.50\n`]),
      "f.csv"
    );
    const imported = (await (
      await user.app(`/books/${book}/imports`, { method: "POST", body: form })
    ).json()) as { batch: { id: string }; rows: { outcome: string; transaction_id: string }[] };
    assert.equal(imported.rows[0]!.outcome, "matched");

    await json("POST", `/imports/${imported.batch.id}/rows/2/confirm`);

    const { data: paid } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      { params: { path: { book_id: book, directive_id: imported.rows[0]!.transaction_id } } }
    );
    assert.equal(paid!.postings[0]!.units!.number, "-1512.50");
  });

  it("confirm automatically, and editing restages today's unconfirmed occurrence", async () => {
    const { user, book, json } = await setUp();
    const auto = (await (
      await json("POST", "/schedules", { ...rent(day(0)), name: "Auto", auto_confirm: true })
    ).json()) as Schedule;
    const pending = (await (await json("POST", "/schedules", rent(day(0)))).json()) as Schedule;

    await json("PATCH", `/schedules/${pending.id}`, {
      updated_at: pending.updated_at,
      template: { ...rent(day(0)).template, payee: "New landlord" },
    });

    const { data: all } = await user.ledger.GET("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book } },
    });
    assert.deepEqual(all!.map((t) => [t.flag, t.payee]).sort(), [
      ["!", "New landlord"],
      ["*", "Landlord"],
    ]);
    assert.ok(auto.auto_confirm);
  });

  it("use the book's time zone, set and read in its settings", async () => {
    const { json } = await setUp();

    assert.equal(
      ((await (await json("GET", "/settings")).json()) as { time_zone: null }).time_zone,
      null
    );
    assert.equal((await json("PUT", "/settings", { time_zone: "America/Chicago" })).status, 200);
    assert.equal((await json("PUT", "/settings", { time_zone: "Mars/Olympus" })).status, 422);
    const { time_zone, week_start } = (await (await json("GET", "/settings")).json()) as {
      time_zone: string;
      week_start: number;
    };
    assert.deepEqual({ time_zone, week_start }, { time_zone: "America/Chicago", week_start: 1 });
  });
});

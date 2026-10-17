import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const ON = "2026-10-15";
const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const TEXT = `option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Liabilities:Card USD
2026-01-01 open Expenses:Housing:Rent
2026-01-01 open Expenses:Food:Groceries
2026-01-01 open Expenses:Food:Restaurants
2026-01-01 open Income:Salary

2026-01-02 * "Opening"
  Assets:Bank:Checking  10000.00 USD
  Equity:Opening-Balances
${months
  .map(
    (m) => `
${m}-01 * "Landlord" "Rent"
  Assets:Bank:Checking  -2000.00 USD
  Expenses:Housing:Rent
${m}-05 * "Grocer" "Groceries"
  Liabilities:Card  -300.00 USD
  Expenses:Food:Groceries
${m}-20 * "Cafe" "Dinner"
  Liabilities:Card  -60.00 USD
  Expenses:Food:Restaurants
${m}-15 * "Employer" "Pay"
  Income:Salary  -5000.00 USD
  Assets:Bank:Checking`
  )
  .join("\n")}

2026-10-01 * "Landlord" "Rent"
  Assets:Bank:Checking  -2000.00 USD
  Expenses:Housing:Rent
2026-10-03 * "Grocer" "Groceries"
  Liabilities:Card  -45.10 USD
  Expenses:Food:Groceries
`;

async function setUp() {
  const me = await newUser();
  const created = await me.app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mine", time_zone: "America/Chicago", text: TEXT }),
  });
  const { id: book } = (await created.json()) as { id: string };
  const report = async <T>(name: string, query = "") =>
    (await (await me.app(`/books/${book}/reports/${name}?on=${ON}${query}`)).json()) as T;
  const ledger = (path: string, init: RequestInit = {}) =>
    fetch(`${BASE_URL}/api/ledger/v1/books/${book}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${me.token}`, "content-type": "application/json" },
    });
  return { book, report, ledger };
}

describe("M12: reports", () => {
  before(stackIsUp);

  it("measures this month's spending against the budget and a simulated month", async () => {
    const { report, ledger } = await setUp();
    await ledger(`/budgets/Expenses`, {
      method: "PUT",
      body: JSON.stringify({ start: "2026-10-01", amount: "3000", unit: "month" }),
    });
    const spending = await report<{
      spent: number;
      budget: number;
      actual: number[];
      projection: number[];
      projected_end: number;
    }>("spending");

    assert.equal(spending.spent, 2045.1);
    assert.equal(spending.budget, 3000);
    assert.equal(spending.actual.length, 15);
    assert.equal(spending.projection.length, 31);
    assert.ok(spending.projected_end >= 2000);
  });

  it("has cash flow, a breakdown to drill into, the largest, net worth and typical periods", async () => {
    const { report } = await setUp();

    const flow = await report<{ months: { month: string; income: number; expenses: number }[] }>(
      "cash-flow"
    );
    assert.deepEqual(flow.months[0], {
      month: "2026-05",
      income: 5000,
      expenses: 2360,
      net: 2640,
      partial: false,
    });

    type Slices = { slices: { label: string; amount: number; more: boolean }[] };
    const spent = await report<Slices>("breakdown");
    assert.deepEqual(
      spent.slices.map((s) => [s.label, s.amount, s.more]),
      [
        ["Housing", 2000, true],
        ["Food", 360, true],
      ]
    );
    const food = await report<Slices>("breakdown", "&of=Expenses:Food");
    assert.deepEqual(
      food.slices.map((s) => s.label),
      ["Groceries", "Restaurants"]
    );

    const largest = await report<{ transactions: { payee: string; amount: number }[] }>("largest");
    assert.deepEqual(
      largest.transactions.map((t) => [t.payee, t.amount]),
      [
        ["Landlord", 2000],
        ["Grocer", 45.1],
      ]
    );

    const worth = await report<{ months: { net: number }[] }>("net-worth", "&months=2");
    assert.equal(worth.months.length, 2);

    const typical = await report<{ month: { median: number } }>(
      "typical",
      "&account=Expenses:Food"
    );
    assert.equal(typical.month.median, 180); // 6 of the last 12 months had $360 of food: between
  });
});

describe("the journal", () => {
  before(stackIsUp);

  it("is every account's transactions, newest first, paged", async () => {
    const { ledger } = await setUp();
    const page = (await (await ledger("/journal?limit=2")).json()) as {
      rows: { date: string; payee: string }[];
      next_cursor: string;
      prev_cursor: string | null;
    };
    assert.deepEqual(
      page.rows.map((r) => [r.date, r.payee]),
      [
        ["2026-10-03", "Grocer"],
        ["2026-10-01", "Landlord"],
      ]
    );
    assert.equal(page.prev_cursor, null);
    const next = (await (await ledger(`/journal?limit=2&cursor=${page.next_cursor}`)).json()) as {
      rows: { date: string }[];
    };
    assert.equal(next.rows[0]!.date, "2026-09-20");
  });
});

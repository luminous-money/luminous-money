import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const ON = "2026-10-15";
const TEXT = `option "operating_currency" "USD"
2025-01-01 open Assets:Bank:Checking USD
2025-01-01 open Expenses:Travel
2025-01-01 open Expenses:Food

2025-01-02 * "Opening"
  Assets:Bank:Checking  10000.00 USD
  Equity:Opening-Balances

2025-04-03 * "Airline" "Flights" #trip-2025 #reimbursable
  Assets:Bank:Checking  -600.00 USD
  Expenses:Travel

2025-04-09 * "Trattoria" "Dinner" #trip-2025
  Assets:Bank:Checking  -90.00 USD
  Expenses:Food

2026-10-03 * "Grocer" "Groceries"
  Assets:Bank:Checking  -40.00 USD
  Expenses:Food
`;

async function setUp() {
  const me = await newUser();
  const created = await me.app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mine", time_zone: "America/Chicago", text: TEXT }),
  });
  const { id: book } = (await created.json()) as { id: string };
  const ledger = (path: string, init: RequestInit = {}) =>
    fetch(`${BASE_URL}/api/ledger/v1/books/${book}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${me.token}`, "content-type": "application/json" },
    });
  const report = async <T>(name: string, query = "") =>
    (await (await me.app(`/books/${book}/reports/${name}?on=${ON}${query}`)).json()) as T;
  return { ledger, report };
}

type Row = { id: string; payee: string | null; tags: string[]; updated_at: string };

describe("M17: tags", () => {
  before(stackIsUp);

  it("lists a book's tags and filters its journal by every tag given", async () => {
    const { ledger } = await setUp();
    const tags = (await (await ledger("/tags")).json()) as { name: string; transactions: number }[];
    assert.deepEqual(
      tags.map((t) => [t.name, t.transactions]),
      [
        ["reimbursable", 1],
        ["trip-2025", 2],
      ]
    );

    const journal = async (query: string) =>
      ((await (await ledger(`/journal?${query}`)).json()) as { rows: Row[] }).rows;
    assert.deepEqual(
      (await journal("tag=trip-2025")).map((r) => r.payee),
      ["Trattoria", "Airline"]
    );
    assert.deepEqual(
      (await journal("tag=trip-2025&tag=reimbursable")).map((r) => r.payee),
      ["Airline"]
    );
    const ledgerRows = (
      (await (await ledger("/accounts/Assets:Bank:Checking/ledger?tag=reimbursable")).json()) as {
        rows: Row[];
      }
    ).rows;
    assert.deepEqual(
      ledgerRows.map((r) => r.tags),
      [["reimbursable", "trip-2025"]]
    );
  });

  it("tags and untags a transaction by PATCH, and refuses a tag Beancount wouldn't take", async () => {
    const { ledger } = await setUp();
    const [groceries] = ((await (await ledger("/journal")).json()) as { rows: Row[] }).rows;
    const patch = (body: object) =>
      ledger(`/transactions/${groceries!.id}`, { method: "PATCH", body: JSON.stringify(body) });

    const tagged = await patch({ updated_at: groceries!.updated_at, tags: ["household"] });
    assert.equal(tagged.status, 200);
    const saved = (await tagged.json()) as Row;
    assert.deepEqual(saved.tags, ["household"]);
    assert.match(await (await ledger("/export")).text(), /"Groceries" #household/);

    assert.equal((await patch({ updated_at: saved.updated_at, tags: ["two words"] })).status, 422);
    const untagged = (await (
      await patch({ updated_at: saved.updated_at, tags: [] })
    ).json()) as Row;
    assert.deepEqual(untagged.tags, []);
  });

  it("reports only the tagged transactions: the breakdown of all time and the largest", async () => {
    const { report } = await setUp();
    const breakdown = await report<{ total: number; slices: { label: string; amount: number }[] }>(
      "breakdown",
      "&side=expenses&window=total&tag=trip-2025"
    );
    assert.deepEqual(
      breakdown.slices.map((s) => [s.label, s.amount]),
      [
        ["Travel", 600],
        ["Food", 90],
      ]
    );
    const largest = await report<{ transactions: { payee: string }[] }>(
      "largest",
      "&tag=trip-2025&tag=reimbursable"
    );
    assert.deepEqual(
      largest.transactions.map((t) => t.payee),
      ["Airline"]
    );
    const thisMonth = await report<{ transactions: { payee: string }[] }>("largest");
    assert.deepEqual(
      thisMonth.transactions.map((t) => t.payee),
      ["Grocer"]
    );
  });
});

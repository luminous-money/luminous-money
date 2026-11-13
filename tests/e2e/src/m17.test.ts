import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const ON = "2026-10-15";
// Tags are a split's (its posting's `tags:`): the receipt's gift is tagged, its groceries aren't.
const TEXT = `option "operating_currency" "USD"
2025-01-01 open Assets:Bank:Checking USD
2025-01-01 open Expenses:Travel
2025-01-01 open Expenses:Food
2025-01-01 open Expenses:Gifts

2025-01-02 * "Opening"
  Assets:Bank:Checking  10000.00 USD
  Equity:Opening-Balances

2025-04-03 * "Airline" "Flights"
  Assets:Bank:Checking  -600.00 USD
  Expenses:Travel
    tags: "#trip-2025 #reimbursable"

2025-04-09 * "Trattoria" "Dinner"
  Assets:Bank:Checking  -90.00 USD
  Expenses:Food
    tags: "#trip-2025"

2025-04-10 * "Mercato" "Food and a gift"
  Assets:Bank:Checking  -75.00 USD
  Expenses:Food  50.00 USD
  Expenses:Gifts  25.00 USD
    tags: "#trip-2025 #gift"

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

type Posting = { account: string; units?: unknown; tags?: string[] };
type Row = { id: string; payee: string | null; tags: string[]; updated_at: string };
type Transaction = Row & { postings: Posting[] };

describe("M17: tags, per split", () => {
  before(stackIsUp);

  it("lists a book's tags and filters its journal by a split with every tag given", async () => {
    const { ledger } = await setUp();
    const tags = (await (await ledger("/tags")).json()) as { name: string; transactions: number }[];
    assert.deepEqual(
      tags.map((t) => [t.name, t.transactions]),
      [
        ["gift", 1],
        ["reimbursable", 1],
        ["trip-2025", 3],
      ]
    );

    const journal = async (query: string) =>
      ((await (await ledger(`/journal?${query}`)).json()) as { rows: Row[] }).rows;
    assert.deepEqual(
      (await journal("tag=trip-2025")).map((r) => r.payee),
      ["Mercato", "Trattoria", "Airline"]
    );
    assert.deepEqual(
      (await journal("tag=trip-2025&tag=reimbursable")).map((r) => r.payee),
      ["Airline"]
    );
    // The bank's ledger keeps a row whose other split has the tag, and says every tag it has.
    const ledgerRows = (
      (await (await ledger("/accounts/Assets:Bank:Checking/ledger?tag=gift")).json()) as {
        rows: Row[];
      }
    ).rows;
    assert.deepEqual(
      ledgerRows.map((r) => [r.payee, r.tags]),
      [["Mercato", ["gift", "trip-2025"]]]
    );
  });

  it("tags and untags a split by PATCH, and refuses a tag Beancount wouldn't take", async () => {
    const { ledger } = await setUp();
    const [{ id }] = ((await (await ledger("/journal")).json()) as { rows: Row[] }).rows;
    const groceries = (await (await ledger(`/transactions/${id}`)).json()) as Transaction;
    const patch = (body: object) =>
      ledger(`/transactions/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    const tagging = (tags: string[]) =>
      groceries.postings.map((p, i) => (i === 1 ? { ...p, tags } : p));

    const tagged = await patch({
      updated_at: groceries.updated_at,
      postings: tagging(["household"]),
    });
    assert.equal(tagged.status, 200);
    const saved = (await tagged.json()) as Transaction;
    assert.deepEqual(
      saved.postings.map((p) => p.tags),
      [[], ["household"]]
    );
    assert.match(
      await (await ledger("/export")).text(),
      /Expenses:Food[^\n]*\n {4}tags: "#household"/
    );

    const bad = { updated_at: saved.updated_at, postings: tagging(["two words"]) };
    assert.equal((await patch(bad)).status, 422);
    // A transaction has no tags of its own any more.
    assert.equal((await patch({ updated_at: saved.updated_at, tags: ["household"] })).status, 422);
    const untagged = (await (
      await patch({ updated_at: saved.updated_at, postings: tagging([]) })
    ).json()) as Transaction;
    assert.deepEqual(
      untagged.postings.map((p) => p.tags),
      [[], []]
    );
  });

  it("reports only the tagged splits: the breakdown of all time and the largest", async () => {
    const { report } = await setUp();
    type Breakdown = { total: number; slices: { label: string; amount: number }[] };
    const breakdown = await report<Breakdown>(
      "breakdown",
      "&side=expenses&window=total&tag=trip-2025"
    );
    assert.deepEqual(
      breakdown.slices.map((s) => [s.label, s.amount]),
      [
        ["Travel", 600],
        ["Food", 90],
        ["Gifts", 25], // the gift, not the food bought with it
      ]
    );
    const gifts = await report<Breakdown>("breakdown", "&side=expenses&window=total&tag=gift");
    assert.equal(gifts.total, 25);
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

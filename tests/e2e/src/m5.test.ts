/** M5 through the real stack: holdings and value, trades, revalued assets, prices. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

const BROKERAGE = (bought: string) => `option "operating_currency" "USD"
option "booking_method" "FIFO"
2020-01-01 open Assets:Broker
2020-01-01 open Assets:Broker:Cash USD
2020-01-01 open Assets:Broker:VTI VTI
2020-01-01 open Assets:Bank USD
2020-01-01 commodity VTI
  price: "USD:ledger.price_sources.fixed/VTI"
${bought} * "Fund"
  Assets:Bank        -5000.00 USD
  Assets:Broker:Cash
${bought} * "Buy VTI"
  Assets:Broker:VTI   10 VTI {200.00 USD}
  Assets:Broker:Cash
${day(-1)} price VTI 230.00 USD
`;

async function setUp() {
  const user = await newUser();
  const { data: book } = await user.ledger.POST("/api/ledger/v1/books", {
    body: { name: "Invest" },
  });
  const id = book!.id;
  const imported = await fetch(`${BASE_URL}/api/ledger/v1/books/${id}/import`, {
    method: "POST",
    headers: { authorization: `Bearer ${user.token}`, "content-type": "text/plain" },
    body: BROKERAGE(day(-400)),
  });
  assert.equal(imported.status, 200);
  const ledger = (method: string, path: string, body?: unknown) =>
    fetch(`${BASE_URL}/api/ledger/v1/books/${id}${path}`, {
      method,
      headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { user, book: id, ledger };
}

describe("investments", () => {
  before(stackIsUp);

  it("value a brokerage, with cost basis and unrealized gain", async () => {
    const { ledger } = await setUp();

    const holdings = (await (await ledger("GET", "/accounts/Assets:Broker/holdings")).json()) as {
      value: { number: string };
      gain: { number: string };
      holdings: { commodity: string; units: string; cost: { number: string } | null }[];
    };
    const [summary] = (await (
      await ledger("GET", "/accounts/summary?account=Assets:Broker")
    ).json()) as { value: { number: string }; gain: { number: string } }[];

    assert.deepEqual([holdings.value.number, holdings.gain.number], ["5300.00", "300.00"]);
    assert.deepEqual(
      holdings.holdings.map((h) => [h.commodity, h.units, h.cost?.number ?? null]),
      [
        ["USD", "3000.00", null],
        ["VTI", "10", "2000.00"],
      ]
    );
    assert.deepEqual([summary!.value.number, summary!.gain.number], ["5300.00", "300.00"]);
  });

  it("sell long-term lots with the gain split by term, and refuse an oversell", async () => {
    const { ledger } = await setUp();
    const sale = {
      kind: "sell",
      date: day(0),
      commodity: "VTI",
      units: "4",
      price: "250.00",
      fees: "1.00",
    };

    const preview = (await (
      await ledger("POST", "/accounts/Assets:Broker/trades/preview", sale)
    ).json()) as {
      lots: { term: string; gain: { number: string } }[];
    };
    const written = await ledger("POST", "/accounts/Assets:Broker/trades", sale);
    const oversell = await ledger("POST", "/accounts/Assets:Broker/trades", {
      ...sale,
      units: "7",
    });

    assert.deepEqual(
      preview.lots.map((l) => [l.term, l.gain.number]),
      [["long", "200.00"]]
    );
    assert.equal(written.status, 201);
    assert.equal(oversell.status, 422);
    const [gains] = (await (
      await ledger(
        "GET",
        `/accounts/summary?account=${encodeURIComponent("Income:Capital-Gains:Long-Term")}`
      )
    ).json()) as { balance: { number: string }[] }[];
    assert.equal(gains!.balance[0]!.number, "-200.00");
  });

  it("revalue a house against unrealized gains, and fetch prices from a commodity's source", async () => {
    const { user, book, ledger } = await setUp();
    await ledger("POST", "/accounts", {
      name: "Assets:Property:House",
      kind: "leaf",
      opening_balance: { amount: "400000.00", currency: "USD", date: day(-400) },
      revalue_every: 350,
    });

    const revalued = await ledger("POST", "/accounts/Assets:Property:House/revalue", {
      date: day(0),
      value: { number: "425000.00", currency: "USD" },
    });
    const [house] = (await (
      await ledger("GET", "/accounts/summary?account=Assets:Property:House")
    ).json()) as { value: { number: string }; revalued_on: string; stale: boolean }[];
    const fetched = (await (
      await user.app(`/books/${book}/prices/fetch`, { method: "POST" })
    ).json()) as {
      result: { fetched: { commodity: string; price: { number: string } }[] };
    };

    assert.equal(revalued.status, 201);
    assert.deepEqual(
      [house!.value.number, house!.revalued_on, house!.stale],
      ["425000.00", day(0), false]
    );
    assert.deepEqual(
      fetched.result.fetched.map((f) => [f.commodity, f.price.number]),
      [["VTI", "100"]]
    );
  });

  it("set an account's booking method and list commodities", async () => {
    const { ledger } = await setUp();
    const accounts = (await (await ledger("GET", "/accounts")).json()) as {
      name: string;
      updated_at: string;
    }[];
    const vti = accounts.find((a) => a.name === "Assets:Broker:VTI")!;

    const set = await ledger("PATCH", "/accounts/Assets:Broker:VTI", {
      updated_at: vti.updated_at,
      booking: "HIFO",
    });
    const stale = await ledger("PATCH", "/accounts/Assets:Broker:VTI", {
      updated_at: vti.updated_at,
      booking: "LIFO",
    });
    const commodities = (await (await ledger("GET", "/commodities")).json()) as {
      currency: string;
      price_source: string;
    }[];

    assert.equal(((await set.json()) as { booking: string }).booking, "HIFO");
    assert.equal(stale.status, 409);
    assert.deepEqual(
      commodities.map((c) => [c.currency, c.price_source]),
      [["VTI", "USD:ledger.price_sources.fixed/VTI"]]
    );
  });
});

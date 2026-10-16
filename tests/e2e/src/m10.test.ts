import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const TEXT = `option "operating_currency" "USD"
2024-01-01 open Assets:Bank:Checking USD
2024-01-01 open Assets:Bank:Savings USD
2024-01-01 open Expenses:Food:Coffee
2024-01-01 open Expenses:Food:Groceries
2024-01-01 open Expenses:Fun
2024-01-01 open Equity:Opening-Balances

2024-01-02 * "Opening balance"
  Assets:Bank:Checking  500.00 USD
  Equity:Opening-Balances

2024-02-01 * "Coffee"
  Assets:Bank:Checking  -4.50 USD
  Expenses:Food:Coffee

2024-02-02 * "Groceries"
  Assets:Bank:Checking  -40.00 USD
  Expenses:Food:Groceries
`;

type Tree = {
  name: string;
  total: { number: string }[];
  value: { number: string } | null;
  close: string | null;
}[];

async function setUp() {
  const me = await newUser();
  const created = await me.app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mine", time_zone: "America/Chicago", text: TEXT }),
  });
  const { id: book } = (await created.json()) as { id: string };
  const app = (path: string, method = "GET", body?: unknown) =>
    me.app(`/books/${book}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const tree = async () =>
    (await (
      await fetch(`${BASE_URL}/api/ledger/v1/books/${book}/accounts/tree`, {
        headers: { authorization: `Bearer ${me.token}` },
      })
    ).json()) as Tree;
  return { me, book, app, tree };
}

describe("M10: the chart of accounts", () => {
  before(stackIsUp);

  it("rolls balances up the tree, one figure per node", async () => {
    const { tree } = await setUp();
    const byName = new Map((await tree()).map((a) => [a.name, a]));
    assert.equal(byName.get("Expenses:Food")!.value!.number, "44.50");
    assert.equal(byName.get("Assets")!.value!.number, "455.50");
  });

  it("renames through the app, and what the app keeps by name follows", async () => {
    const { app, tree } = await setUp();
    await app(`/stars/${encodeURIComponent("Expenses:Food:Coffee")}`, "PUT");
    await app("/rules", "POST", {
      name: "Cafe",
      conditions: { account: null, key: null, contains: "CAFE", min: null, max: null },
      account: "Expenses:Food:Coffee",
      payee: null,
      auto_confirm: false,
    });

    const renamed = await app(`/accounts/${encodeURIComponent("Expenses:Food")}/rename`, "POST", {
      to: "Expenses:Eating",
    });

    assert.equal(renamed.status, 200);
    const names = (await tree()).map((a) => a.name);
    assert.ok(names.includes("Expenses:Eating:Coffee") && !names.includes("Expenses:Food:Coffee"));
    assert.deepEqual(await (await app("/stars")).json(), ["Expenses:Eating:Coffee"]);
    const [rule] = (await (await app("/rules")).json()) as { account: string }[];
    assert.equal(rule!.account, "Expenses:Eating:Coffee");

    const onto = await app(`/accounts/${encodeURIComponent("Expenses:Fun")}/rename`, "POST", {
      to: "Expenses:Eating",
    });
    assert.equal(onto.status, 422);
    const system = await app(
      `/accounts/${encodeURIComponent("Equity:Opening-Balances")}/rename`,
      "POST",
      {
        to: "Equity:Start",
      }
    );
    assert.equal(system.status, 422);
  });

  it("deletes a node into one substitute, keeping every other balance", async () => {
    const { app, tree } = await setUp();
    const before = (await tree()).find((a) => a.name === "Assets:Bank:Checking")!.total;

    const refused = await app(`/accounts/${encodeURIComponent("Expenses:Food")}`, "DELETE");
    assert.equal(refused.status, 422);
    const deleted = await app(
      `/accounts/${encodeURIComponent("Expenses:Food")}?substitute=${encodeURIComponent("Expenses:Fun")}`,
      "DELETE"
    );

    assert.deepEqual(await deleted.json(), [
      "Expenses:Food",
      "Expenses:Food:Coffee",
      "Expenses:Food:Groceries",
    ]);
    const after = await tree();
    assert.equal(after.find((a) => a.name === "Expenses:Fun")!.total[0]!.number, "44.50");
    assert.deepEqual(after.find((a) => a.name === "Assets:Bank:Checking")!.total, before);
  });

  it("archives with a closing transfer, and unarchives", async () => {
    const { app, tree } = await setUp();
    const archived = await app(
      `/accounts/${encodeURIComponent("Assets:Bank:Checking")}/archive`,
      "POST",
      {
        transfer_to: "Assets:Bank:Savings",
      }
    );

    assert.deepEqual(await archived.json(), ["Assets:Bank:Checking"]);
    const byName = new Map((await tree()).map((a) => [a.name, a]));
    assert.ok(byName.get("Assets:Bank:Checking")!.close);
    assert.equal(byName.get("Assets:Bank:Savings")!.total[0]!.number, "455.50");
    await app(`/accounts/${encodeURIComponent("Assets:Bank:Checking")}/unarchive`, "POST", {});
    assert.equal((await tree()).find((a) => a.name === "Assets:Bank:Checking")!.close, null);
  });
});

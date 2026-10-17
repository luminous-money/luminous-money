import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const TEXT = `option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Expenses:Housing:Rent
2026-01-01 open Expenses:Food:Groceries
2026-01-01 open Expenses:Food:Coffee
2026-01-01 open Expenses:Fun

2026-10-01 * "Rent"
  Assets:Bank:Checking  -2000.00 USD
  Expenses:Housing:Rent
2026-10-03 * "Groceries"
  Assets:Bank:Checking  -120.00 USD
  Expenses:Food:Groceries
2026-10-05 ! "Coffee"
  Assets:Bank:Checking  -4.50 USD
  Expenses:Food:Coffee
`;

type Status = {
  lines: {
    account: string;
    spent: { number: string };
    unconfirmed: { number: string };
    other: { budget: { number: string }; spent: { number: string } } | null;
  }[];
  summary: { budget: { number: string }; spent: { number: string } } | null;
};

async function setUp() {
  const me = await newUser();
  const created = await me.app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mine", time_zone: "America/Chicago", text: TEXT }),
  });
  const { id: book } = (await created.json()) as { id: string };
  const call =
    (base: "ledger" | "app") =>
    (path: string, method = "GET", body?: unknown) =>
      fetch(`${BASE_URL}/api/${base}/v1/books/${book}${path}`, {
        method,
        headers: { authorization: `Bearer ${me.token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
  const ledger = call("ledger");
  const budget = (account: string, amount: string, unit = "month") =>
    ledger(`/budgets/${encodeURIComponent(account)}`, "PUT", { start: "2026-10-01", amount, unit });
  const status = async () =>
    (await (await ledger("/budgets/status?on=2026-10-15")).json()) as Status;
  return { book, ledger, app: call("app"), budget, status };
}

describe("M11: budgets", () => {
  before(stackIsUp);

  it("splits a node's budget across accounts under it, the rest its Other", async () => {
    const { budget, status } = await setUp();
    assert.equal((await budget("Expenses", "10500")).status, 200);
    await budget("Expenses:Housing", "5000");

    const { lines, summary } = await status();
    const expenses = lines.find((l) => l.account === "Expenses")!;
    assert.equal(expenses.spent.number, "2124.50");
    assert.equal(expenses.unconfirmed.number, "4.50");
    assert.deepEqual(
      [expenses.other!.budget.number, expenses.other!.spent.number],
      ["5500.00", "124.50"]
    );
    assert.deepEqual([summary!.budget.number, summary!.spent.number], ["10500.00", "2124.50"]);
  });

  it("refuses a budget higher than one above it, per year", async () => {
    const { budget } = await setUp();
    await budget("Expenses:Food", "600");
    const refused = await budget("Expenses:Food:Groceries", "150", "week");
    assert.equal(refused.status, 422);
    assert.match(
      ((await refused.json()) as { detail: string }).detail,
      /more than Expenses:Food's/
    );
  });

  it("drops a merged account's budget, and archiving rests it", async () => {
    const { budget, status, app } = await setUp();
    await budget("Expenses:Food:Coffee", "30");
    await budget("Expenses:Fun", "50");

    const merged = await app(
      `/accounts/${encodeURIComponent("Expenses:Food:Coffee")}?substitute=${encodeURIComponent("Expenses:Fun")}`,
      "DELETE"
    );
    assert.equal(merged.status, 200);
    assert.deepEqual(
      (await status()).lines.map((l) => l.account),
      ["Expenses:Fun"]
    );
    await app(`/accounts/${encodeURIComponent("Expenses:Fun")}/archive`, "POST", {
      date: "2026-10-10",
    });
    assert.deepEqual((await status()).lines, []);
  });

  it("keeps the day weeks start in the book's settings, versioned", async () => {
    const { app } = await setUp();
    const read = (await (await app("/settings")).json()) as {
      week_start: number;
      updated_at: string;
    };
    assert.equal(read.week_start, 1);

    const changed = await app("/settings", "PATCH", { updated_at: read.updated_at, week_start: 0 });
    const stale = await app("/settings", "PATCH", { updated_at: read.updated_at, week_start: 6 });

    assert.equal(((await changed.json()) as { week_start: number }).week_start, 0);
    assert.equal(stale.status, 409);
  });
});

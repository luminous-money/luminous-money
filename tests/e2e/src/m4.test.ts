/** M4 through the real stack: imports categorized by history and by rules, acceptance tracked,
 * "Suggest categories", and rules re-applied. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { newUser, stackIsUp } from "./support.ts";

const CHECKING = "Assets:Bank:Checking";
const usd = (number: string) => ({ number, currency: "USD" });
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

async function setUp() {
  const user = await newUser();
  const { data: book } = await user.ledger.POST("/api/ledger/v1/books", { body: { name: "Mine" } });
  const id = book!.id;
  for (const name of [CHECKING, "Expenses:Food:Coffee", "Expenses:Food:Tea"]) {
    await user.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: id } },
      body: { name, kind: "leaf", opening_balance: null },
    });
  }
  const json = async (method: string, path: string, body?: unknown) =>
    user.app(`/books/${id}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  await json("PUT", `/profiles/${encodeURIComponent(CHECKING)}`, [PROFILE]);
  const add = (narration: string, flag: string, other: string, payee: string | null = null) =>
    user.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: id } },
      body: {
        date: "2024-02-01",
        flag,
        payee,
        narration,
        postings: [{ account: CHECKING, units: usd("-4.50") }, { account: other }],
      },
    });
  const upload = async (rows: string) => {
    const form = new FormData();
    form.set("account", CHECKING);
    form.set("file", new Blob([`Date,Description,Amount\n${rows}`]), "f.csv");
    const response = await user.app(`/books/${id}/imports`, { method: "POST", body: form });
    return (await response.json()) as {
      rows: {
        transaction_id: string;
        proposal: { categorizer: string; accounts: string[]; payee: string | null } | null;
      }[];
    };
  };
  const transaction = async (tid: string) =>
    (
      await user.ledger.GET("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
        params: { path: { book_id: id, directive_id: tid } },
      })
    ).data!;
  return { user, book: id, json, add, upload, transaction };
}

describe("categorization", () => {
  before(stackIsUp);

  it("history categorizes an import, and confirming it unchanged counts as accepted", async () => {
    const { book, json, add, upload, transaction, user } = await setUp();
    await add(
      "POS DEBIT 0398 CORNER CAFE #42 CHICAGO IL",
      "*",
      "Expenses:Food:Coffee",
      "Corner Cafe"
    );

    const imported = await upload("03/05/2024,CORNER CAFE #57 CHICAGO IL,-4.25\n");

    const row = imported.rows[0]!;
    assert.deepEqual(
      row.proposal && [row.proposal.categorizer, row.proposal.accounts, row.proposal.payee],
      ["history", ["Expenses:Food:Coffee"], "Corner Cafe"]
    );
    const staged = await transaction(row.transaction_id);
    assert.deepEqual(
      [staged.flag, staged.payee, staged.postings[1]!.account],
      ["!", "Corner Cafe", "Expenses:Food:Coffee"]
    );
    const proposals = (await (await json("GET", "/proposals")).json()) as Record<string, unknown>;
    assert.ok(proposals[row.transaction_id]);

    await user.ledger.PATCH("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
      params: { path: { book_id: book, directive_id: staged.id } },
      body: { flag: "*", updated_at: staged.updated_at },
    });
    const settled = await (await json("POST", `/proposals/${staged.id}/settle`)).json();

    assert.deepEqual(settled, { accepted: true, payee_accepted: true });
    const stats = (await (await json("GET", "/categorizers")).json()) as {
      name: string;
      accepted: number;
    }[];
    assert.deepEqual(
      stats.map((s) => [s.name, s.accepted]),
      [
        ["rules", 0],
        ["history", 1],
        ["items", 0],
      ]
    );
  });

  it("a rule settles first, and can confirm automatically", async () => {
    const { json, add, upload, transaction } = await setUp();
    await add("TEA HOUSE", "*", "Expenses:Food:Coffee"); // history would say coffee
    const created = await json("POST", "/rules", {
      name: "Tea",
      conditions: { account: CHECKING, key: null, contains: "tea", min: null, max: null },
      account: "Expenses:Food:Tea",
      payee: "Tea House",
      auto_confirm: true,
    });
    assert.equal(created.status, 201);

    const imported = await upload("03/05/2024,TEA HOUSE,-6.00\n");

    const staged = await transaction(imported.rows[0]!.transaction_id);
    assert.deepEqual(
      [staged.flag, staged.payee, staged.postings[1]!.account],
      ["*", "Tea House", "Expenses:Food:Tea"]
    );
    assert.equal(imported.rows[0]!.proposal!.categorizer, "rules");
  });

  it("suggests categories for unconfirmed transactions, and re-applies a new rule to untouched ones", async () => {
    const { json, add, transaction } = await setUp();
    await add("CORNER CAFE", "*", "Expenses:Food:Coffee");
    const { data: open } = await add("CORNER CAFE", "!", "Expenses:Uncategorized");
    const { data: tea } = await add("TEA HOUSE", "!", "Expenses:Uncategorized");

    const suggested = (await (await json("POST", "/suggest")).json()) as { suggested: number };
    assert.equal(suggested.suggested, 1);
    assert.equal((await transaction(open!.id)).postings[1]!.account, "Expenses:Food:Coffee");

    const rule = (await (
      await json("POST", "/rules", {
        name: "Tea",
        conditions: { account: null, key: "tea house", contains: null, min: null, max: null },
        account: "Expenses:Food:Tea",
        payee: null,
        auto_confirm: false,
      })
    ).json()) as { id: string; covers: number };
    assert.equal(rule.covers, 1);
    const applied = (await (await json("POST", `/rules/${rule.id}/apply`)).json()) as {
      applied: number;
    };

    assert.equal(applied.applied, 1);
    assert.equal((await transaction(tea!.id)).postings[1]!.account, "Expenses:Food:Tea");
  });

  it("refuse a rule without conditions, and are the owner's alone", async () => {
    const { book, json } = await setUp();
    const bare = await json("POST", "/rules", {
      name: "Nothing",
      conditions: { account: null, key: null, contains: null, min: null, max: null },
      account: "Expenses:Food:Tea",
      payee: null,
      auto_confirm: false,
    });

    assert.equal(bare.status, 422);
    assert.equal((await (await newUser()).app(`/books/${book}/rules`)).status, 404);
  });
});

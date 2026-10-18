/** M15 through the real stack: dividing a bank-linked account into parts, the bank's
 * transactions landing in its main part, and the whole still reconciled with the bank. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { newUser, stackIsUp } from "./support.ts";

type User = Awaited<ReturnType<typeof newUser>>;
const CHECKING = "Assets:Bank:Checking";
const FAKE = process.env.SIMPLEFIN_FAKE_URL ?? "http://simplefin-fake:8080";
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

const json = (user: User, path: string, method = "GET", body?: unknown) =>
  user.app(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const control = async (path: string, method: string, body: unknown) =>
  (
    await fetch(`${FAKE}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  ).json() as Promise<{ user: string; setup_token: string }>;
const enc = encodeURIComponent;

describe("M15: divided accounts", () => {
  before(stackIsUp);

  it("divides a bank-linked account: the bank's land in its main part, the whole reconciles", async () => {
    const user = await newUser();
    const created = await json(user, "/books", "POST", {
      name: "Mine",
      time_zone: "America/Chicago",
    });
    const { id: book } = (await created.json()) as { id: string };
    const bank = await control("/control/users", "POST", {});
    await control(`/control/users/${bank.user}/accounts/chk`, "PUT", {
      name: "Everyday Checking",
      institution: "Fake Bank",
      balance: "1975.00",
    });
    await control(`/control/users/${bank.user}/accounts/chk/transactions`, "POST", [
      {
        id: "t1",
        posted: NOW - 20 * DAY,
        amount: "-25.00",
        description: "Coffee",
        memo: "COFFEE",
        payee: "Cafe",
      },
      {
        id: "t2",
        posted: NOW - 10 * DAY,
        amount: "1000.00",
        description: "Payroll",
        memo: "PAYROLL",
        payee: "Acme",
      },
    ]);
    const connection = (await (
      await json(user, "/simplefin/connections", "POST", { setup_token: bank.setup_token })
    ).json()) as { id: string };
    const link = {
      connection_id: connection.id,
      account_id: "chk",
      account: CHECKING,
      mode: "new",
    };
    assert.equal((await json(user, `/books/${book}/simplefin/links`, "POST", link)).status, 201);

    // Divide it: General (its history) and Padding, with 500.00 of it.
    const accounts = async () =>
      (
        await user.ledger.GET("/api/ledger/v1/books/{book_id}/accounts/tree", {
          params: { path: { book_id: book } },
        })
      ).data!;
    const before = (await accounts()).find((a) => a.name === CHECKING)!;
    const divided = await json(user, `/books/${book}/accounts/${enc(CHECKING)}/divide`, "POST", {
      main: "General",
      parts: [{ name: "Padding", amount: "500.00" }],
      date: new Date((NOW - 5 * DAY) * 1000).toISOString().slice(0, 10),
      updated_at: before.updated_at,
    });
    assert.equal(divided.status, 200);
    const tree = await accounts();
    const total = (name: string) => tree.find((a) => a.name === name)!.total[0]?.number;
    assert.deepEqual(
      [total(CHECKING), total(`${CHECKING}:General`), total(`${CHECKING}:Padding`)],
      ["1975.00", "1475.00", "500.00"]
    );

    // The bank's next transaction lands in General; the move between parts isn't "Not at the bank".
    await control(`/control/users/${bank.user}/accounts/chk`, "PUT", {
      name: "Everyday Checking",
      institution: "Fake Bank",
      balance: "1935.00",
    });
    await control(`/control/users/${bank.user}/accounts/chk/transactions`, "POST", [
      {
        id: "t3",
        posted: NOW - 2 * DAY,
        amount: "-40.00",
        description: "Groceries",
        memo: "GROCER",
        payee: "Grocer",
      },
    ]);
    await json(user, `/simplefin/connections/${connection.id}/sync`, "POST", {});
    const { data: unconfirmed } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions",
      {
        params: { path: { book_id: book }, query: { flag: "!" } },
      }
    );
    const groceries = unconfirmed!.find((t) => t.narration === "GROCER")!;
    assert.equal(groceries.postings[0]!.account, `${CHECKING}:General`);
    const status = (await (await json(user, `/books/${book}/simplefin/status`)).json()) as Record<
      string,
      { not_at_bank: string[]; comparison: { off_by: string | null } }
    >;
    assert.equal(status[CHECKING]!.comparison.off_by, null);
    assert.deepEqual(status[CHECKING]!.not_at_bank, []);

    // All confirmed: the whole is reconciled with the bank after the next sync.
    for (const t of unconfirmed!)
      await user.ledger.PATCH("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
        params: { path: { book_id: book, directive_id: t.id } },
        body: { flag: "*", updated_at: t.updated_at },
      });
    await json(user, `/simplefin/connections/${connection.id}/sync`, "POST", {});
    const { data: history } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/accounts/{account}/reconciliations",
      { params: { path: { book_id: book, account: CHECKING } } }
    );
    assert.equal(history!.reconciliations[0]?.automatic, true);
    assert.equal(history!.reconciliations[0]?.balance.number, "1935.00");
  });

  it("a rule lands what it matches in another part", async () => {
    const user = await newUser();
    const created = await json(user, "/books", "POST", {
      name: "Ours",
      time_zone: "UTC",
      text: `option "operating_currency" "USD"
2026-01-01 open ${CHECKING} USD
2026-01-01 open Income:Interest
`,
    });
    const { id: book } = (await created.json()) as { id: string };
    const [checking] = (
      await user.ledger.GET("/api/ledger/v1/books/{book_id}/accounts", {
        params: { path: { book_id: book } },
      })
    ).data!.filter((a) => a.name === CHECKING);
    await json(user, `/books/${book}/accounts/${enc(CHECKING)}/divide`, "POST", {
      main: "General",
      parts: [{ name: "Padding", amount: "0" }],
      date: "2026-01-02",
      updated_at: checking!.updated_at,
    });
    const rule = await json(user, `/books/${book}/rules`, "POST", {
      name: "Interest",
      conditions: { account: CHECKING, key: null, contains: "interest", min: null, max: null },
      account: "Income:Interest",
      payee: "Bank",
      part: `${CHECKING}:Padding`,
      auto_confirm: false,
    });
    assert.equal(rule.status, 201);
    await json(user, `/books/${book}/profiles/${enc(CHECKING)}`, "PUT", [
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
    form.set("account", CHECKING);
    form.set(
      "file",
      new Blob(
        ["Date,Description,Amount\n02/01/2026,INTEREST PAID,1.25\n02/02/2026,COFFEE,-4.00\n"],
        {
          type: "text/csv",
        }
      ),
      "feb.csv"
    );
    assert.equal(
      (await user.app(`/books/${book}/imports`, { method: "POST", body: form })).status,
      201
    );

    const { data: staged } = await user.ledger.GET("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book }, query: { flag: "!" } },
    });
    const landed = Object.fromEntries(staged!.map((t) => [t.narration, t.postings[0]!.account]));
    assert.deepEqual(landed, {
      "INTEREST PAID": `${CHECKING}:Padding`,
      COFFEE: `${CHECKING}:General`,
    });
  });
});

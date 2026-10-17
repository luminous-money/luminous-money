/** M14 through the real stack: reconciling a file-fed account with its statement, divided
 * accounts, and a bank-fed account reconciled automatically after a sync. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { newUser, stackIsUp } from "./support.ts";

type User = Awaited<ReturnType<typeof newUser>>;
const CHECKING = "Assets:Bank:Checking";
const FAKE = process.env.SIMPLEFIN_FAKE_URL ?? "http://simplefin-fake:8080";
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

const PROFILE = {
  delimiter: ",",
  skip: 0,
  header: true,
  columns: ["Date", "Description", "Amount", "Balance"],
  date: { column: 0, format: "MM/DD/YYYY" },
  amount: { kind: "signed", column: 2, negate: false },
  description: 1,
  payee: null,
  id: null,
  balance: 3,
};

const json = (user: User, path: string, method = "GET", body?: unknown) =>
  user.app(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function bookWith(user: User, text: string) {
  const created = await json(user, "/books", "POST", {
    name: "Ours",
    time_zone: "America/Chicago",
    text,
  });
  return ((await created.json()) as { id: string }).id;
}

const enc = encodeURIComponent;

describe("M14: reconciliation", () => {
  before(stackIsUp);

  it("reconciles a file-fed account: the file's balance prefilled, its rows ticked", async () => {
    const user = await newUser();
    const book = await bookWith(
      user,
      `option "operating_currency" "USD"\n2026-01-01 open ${CHECKING} USD\n2026-01-01 open Expenses:Food\n`
    );
    await json(user, `/books/${book}/profiles/${enc(CHECKING)}`, "PUT", [PROFILE]);
    const form = new FormData();
    form.set("account", CHECKING);
    form.set(
      "file",
      new Blob(
        [
          "Date,Description,Amount,Balance\n" +
            "01/05/2026,Coffee,-12.00,-12.00\n" +
            "01/09/2026,Payroll,500.00,488.00\n",
        ],
        { type: "text/csv" }
      ),
      "jan.csv"
    );
    const imported = (await (
      await user.app(`/books/${book}/imports`, { method: "POST", body: form })
    ).json()) as { balance_check: { file: string; books: string } };
    assert.deepEqual(
      [imported.balance_check.file, imported.balance_check.books],
      ["488.00", "488.00"]
    );

    const view = (await (await json(user, `/books/${book}/reconcile/${enc(CHECKING)}`)).json()) as {
      prefill: { statement_date: string; balance: string; source: string };
      ticked: string[];
      state: { transactions: { id: string }[] };
    };
    assert.deepEqual(view.prefill, {
      statement_date: "2026-01-09",
      balance: "488.00",
      source: "file",
    });
    assert.equal(view.ticked.length, 2);

    const short = await json(user, `/books/${book}/reconcile/${enc(CHECKING)}`, "POST", {
      statement_date: "2026-01-31",
      balance: "500.00",
      transactions: view.ticked,
    });
    assert.equal(short.status, 422);
    const done = await json(user, `/books/${book}/reconcile/${enc(CHECKING)}`, "POST", {
      statement_date: "2026-01-31",
      balance: "488.00",
      transactions: view.ticked,
    });
    assert.equal(done.status, 201);
    // Imported unconfirmed, confirmed with it; the ledger has it, and the export carries it.
    const { data: ledger } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/accounts/{account}/ledger",
      { params: { path: { book_id: book, account: CHECKING }, query: { reconciled: false } } }
    );
    assert.deepEqual(ledger!.rows, []);
    const exported = await user.ledger.GET("/api/ledger/v1/books/{book_id}/export", {
      params: { path: { book_id: book } },
      parseAs: "text",
    });
    assert.match(exported.data as unknown as string, /balance Assets:Bank:Checking +488\.00 USD/);
  });

  it("saves for later, then a divided account reconciles as one", async () => {
    const user = await newUser();
    const book = await bookWith(
      user,
      `option "operating_currency" "USD"
2026-01-01 open Assets:PNC
  kind: "node"
2026-01-01 open Assets:PNC:General USD
2026-01-01 open Assets:PNC:Padding USD
2026-01-01 open Income:Salary
2026-01-02 * "Pay"
  Assets:PNC:General  1000.00 USD
  Income:Salary
2026-01-03 * "Set aside"
  Assets:PNC:General  -400.00 USD
  Assets:PNC:Padding
`
    );
    const pnc = "Assets:PNC";
    const [node] = (await (
      await user.ledger.GET("/api/ledger/v1/books/{book_id}/accounts", {
        params: { path: { book_id: book } },
      })
    ).data!.filter((a) => a.name === pnc))!;
    assert.equal(
      (
        await json(user, `/books/${book}/accounts/${enc(pnc)}/divided`, "POST", {
          divided: true,
          updated_at: node!.updated_at,
        })
      ).status,
      200
    );
    // Its parts aren't reconciled themselves.
    assert.equal(
      (await json(user, `/books/${book}/reconcile/${enc(`${pnc}:General`)}`)).status,
      422
    );

    const view = (await (
      await json(user, `/books/${book}/reconcile/${enc(pnc)}?through=2026-01-31`)
    ).json()) as {
      state: { transactions: { id: string }[]; internal: number };
    };
    assert.equal(view.state.internal, 1); // the transfer within it
    const [pay] = view.state.transactions;
    const draft = await json(user, `/books/${book}/reconcile/${enc(pnc)}/draft`, "PUT", {
      statement_date: "2026-01-31",
      balance: "1000.00",
      ticked: [pay!.id],
      updated_at: null,
    });
    assert.equal(draft.status, 200);
    const again = (await (await json(user, `/books/${book}/reconcile/${enc(pnc)}`)).json()) as {
      ticked: string[];
      draft: { statement_date: string };
    };
    assert.deepEqual([again.ticked, again.draft.statement_date], [[pay!.id], "2026-01-31"]);

    const done = await json(user, `/books/${book}/reconcile/${enc(pnc)}`, "POST", {
      statement_date: "2026-01-31",
      balance: "1000.00",
      transactions: [pay!.id],
    });
    assert.equal(done.status, 201);
    assert.equal(
      (
        (await (await json(user, `/books/${book}/reconcile/${enc(pnc)}`)).json()) as {
          draft: unknown;
        }
      ).draft,
      null
    );
  });

  it("reconciles a bank-fed account automatically once it's all confirmed", async () => {
    const user = await newUser();
    const created = await json(user, "/books", "POST", {
      name: "Mine",
      time_zone: "America/Chicago",
    });
    const { id: book } = (await created.json()) as { id: string };
    const control = async (path: string, method: string, body: unknown) =>
      (
        await fetch(`${FAKE}${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json() as Promise<{ user: string; setup_token: string }>;
    const bank = await control("/control/users", "POST", {});
    await control(`/control/users/${bank.user}/accounts/chk`, "PUT", {
      name: "Everyday Checking",
      institution: "Fake Bank",
      balance: "975.00",
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

    // The books agree with the bank, but nothing's confirmed yet: no reconciliation.
    const status = (await (await json(user, `/books/${book}/simplefin/status`)).json()) as Record<
      string,
      { comparison: { off_by: string | null } }
    >;
    assert.equal(status[CHECKING]!.comparison.off_by, null);
    const history = async () =>
      (
        await user.ledger.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/reconciliations", {
          params: { path: { book_id: book, account: CHECKING } },
        })
      ).data!.reconciliations;
    await json(user, `/simplefin/connections/${connection.id}/sync`, "POST", {});
    assert.deepEqual(await history(), []);

    const { data: unconfirmed } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions",
      {
        params: { path: { book_id: book }, query: { flag: "!" } },
      }
    );
    for (const t of unconfirmed!)
      await user.ledger.PATCH("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
        params: { path: { book_id: book, directive_id: t.id } },
        body: { flag: "*", updated_at: t.updated_at },
      });
    await json(user, `/simplefin/connections/${connection.id}/sync`, "POST", {});

    const [reconciled] = await history();
    assert.equal(reconciled?.automatic, true);
    assert.equal(reconciled?.balance.number, "975.00");
  });
});

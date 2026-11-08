import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { newUser, stackIsUp } from "./support.ts";

const FAKE = process.env.SIMPLEFIN_FAKE_URL ?? "http://simplefin-fake:8080";
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const ACCOUNT = "Assets:Fidelity:Joint";

async function fake(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${FAKE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

// The e2e ledger's prices come from the fixed source: 100 a share, any day.
const holding = (symbol: string, shares: string, averageCost: number) => ({
  id: `h-${symbol}`,
  symbol,
  description: `${symbol} fund`,
  shares,
  cost_basis: "0.00",
  purchase_price: String(averageCost),
  market_value: (Number(shares) * (symbol === "SPAXX" ? 1 : 100)).toFixed(2),
  currency: "USD",
});
const CORE = "FIDELITY GOVERNMENT MONEY MARKET (SPAXX)";

/** A Fidelity brokerage at the fake: 10 ACME held before its history and 2 bought; 60 FXAIX
 * less 10 sold; a deposit, a dividend, and a sweep beside each. */
async function fidelity(institution = "Fidelity Investments") {
  const { user, setup_token } = (await fake("/control/users", "POST")) as {
    user: string;
    setup_token: string;
  };
  const holdings = [
    holding("SPAXX", "1905.00", 1),
    holding("ACME", "12", 80),
    holding("FXAIX", "50", 90),
  ];
  await fake(`/control/users/${user}/accounts/brk`, "PUT", {
    name: "Joint WROS (1234)",
    institution,
    balance: "8105.00",
    holdings,
  });
  const rows: [number, string, string][] = [
    [40, "1000.00", "Electronic Funds Transfer Received (Cash)"],
    [40, "-1000.00", `PURCHASE INTO CORE ACCOUNT ${CORE} MORNING TRADE`],
    [35, "-200.00", "YOU BOUGHT ACME CORP COM (ACME) (Cash)"],
    [34, "200.00", `REDEMPTION FROM CORE ACCOUNT ${CORE} (Cash)`],
    [30, "1000.00", "YOU SOLD FIDELITY 500 INDEX FUND (FXAIX) (Cash)"],
    [29, "-1000.00", `PURCHASE INTO CORE ACCOUNT ${CORE} (Cash)`],
    [10, "5.00", `DIVIDEND RECEIVED ${CORE} (Cash)`],
    [10, "-5.00", `REINVESTMENT ${CORE} (Cash)`],
  ];
  await fake(
    `/control/users/${user}/accounts/brk/transactions`,
    "POST",
    rows.map(([days, amount, text], i) => ({
      id: `r${i}`,
      posted: NOW - days * DAY,
      amount,
      description: text,
      memo: "",
      payee: "Fidelity",
    }))
  );
  return { user, setup_token };
}

async function setUp() {
  const me = await newUser();
  const created = await me.app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mine", time_zone: "America/Chicago" }),
  });
  const { id: book } = (await created.json()) as { id: string };
  const send = (path: string, body: unknown, method = "POST") =>
    me.app(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { me, book, send };
}

type Status = Record<
  string,
  {
    link_id: string;
    updated_at: string;
    reader: string | null;
    dividends: string;
    activity: { sweeps: number; dividends: number; trades: number } | null;
    comparison: { off_by: string | null } | null;
  }
>;

describe("Brokerage activity: a brokerage's rows read as what they are", () => {
  before(stackIsUp);

  it("links a Fidelity brokerage with its sweeps left out, dividends confirmed, trades booked and positions as they were", async () => {
    const { me, book, send } = await setUp();
    const { setup_token } = await fidelity();
    const connection = (await (await send("/simplefin/connections", { setup_token })).json()) as {
      id: string;
      accounts: { account_id: string; reader: string | null }[];
    };
    assert.equal(connection.accounts[0]!.reader, "Fidelity");
    const link = { connection_id: connection.id, account_id: "brk", account: ACCOUNT, mode: "new" };
    const preview = (await (await send(`/books/${book}/simplefin/links/preview`, link)).json()) as {
      reader: string;
      opening: { amount: string };
    };
    assert.deepEqual([preview.reader, preview.opening.amount], ["Fidelity", "100.00"]);
    assert.equal((await send(`/books/${book}/simplefin/links`, link)).status, 201);

    const holdings = (
      await me.ledger.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/holdings", {
        params: { path: { book_id: book, account: ACCOUNT } },
      })
    ).data!;
    const units = Object.fromEntries(holdings.holdings.map((h) => [h.commodity, Number(h.units)]));
    assert.deepEqual(units, { FXAIX: 50, ACME: 12, USD: 1905 });
    const journal = (
      await me.ledger.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/ledger", {
        params: { path: { book_id: book, account: `${ACCOUNT}:Cash` } },
      })
    ).data!;
    const narrations = journal.rows.map((r) => r.narration ?? "");
    assert.ok(!narrations.some((n) => /CORE ACCOUNT|REINVESTMENT/.test(n)), "no sweeps");
    const dividend = journal.rows.find((r) => r.narration?.startsWith("DIVIDEND"))!;
    assert.deepEqual([dividend.flag, dividend.counterpart], ["*", "Income:Dividends"]);
    // The sale books its gain by the account's method (FIFO, from the opening lot at $90).
    const sale = journal.rows.find((r) => r.narration?.startsWith("YOU SOLD"))!;
    const sold = (
      await me.ledger.GET("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
        params: { path: { book_id: book, directive_id: sale.id } },
      })
    ).data!;
    assert.deepEqual(
      sold.postings.map((p) => [p.account, p.units?.number]),
      [
        [`${ACCOUNT}:FXAIX`, "-10"],
        [`${ACCOUNT}:Cash`, "1000.00"],
        ["Income:Capital-Gains:Short-Term", "-100.00"],
      ]
    );

    const status = (await (await me.app(`/books/${book}/simplefin/status`)).json()) as Status;
    const mine = status[ACCOUNT]!;
    assert.equal(mine.reader, "Fidelity");
    assert.deepEqual(
      [mine.activity!.sweeps, mine.activity!.dividends, mine.activity!.trades],
      [4, 1, 2]
    );
    assert.equal(mine.comparison!.off_by, null);

    // Dividends elsewhere, against the version read; a stale one is refused.
    const path = `/books/${book}/simplefin/links/${mine.link_id}`;
    const chosen = await send(
      path,
      { dividends: "Income:Fidelity-Dividends", updated_at: mine.updated_at },
      "PATCH"
    );
    assert.equal(chosen.status, 200);
    assert.equal(
      (await send(path, { dividends: null, updated_at: mine.updated_at }, "PATCH")).status,
      409
    );
    const after = (await (await me.app(`/books/${book}/simplefin/status`)).json()) as Status;
    assert.equal(after[ACCOUNT]!.dividends, "Income:Fidelity-Dividends");
  });

  it("reads a brokerage again: what came in as cash is rebuilt, and a transfer kept", async () => {
    const { me, book, send } = await setUp();
    // Linked when its rows weren't read (another institution's name): all cash.
    const { user, setup_token } = await fidelity("Somewhere Else");
    const connection = (await (await send("/simplefin/connections", { setup_token })).json()) as {
      id: string;
      accounts: { reader: string | null }[];
    };
    assert.equal(connection.accounts[0]!.reader, null);
    const link = { connection_id: connection.id, account_id: "brk", account: ACCOUNT, mode: "new" };
    assert.equal((await send(`/books/${book}/simplefin/links`, link)).status, 201);
    await fake(`/control/users/${user}/accounts/brk`, "PUT", {
      institution: "Fidelity Investments",
    });
    await send(`/simplefin/connections/${connection.id}/sync`, {});
    const status = (await (await me.app(`/books/${book}/simplefin/status`)).json()) as Status;
    const id = status[ACCOUNT]!.link_id;

    const preview = (await (
      await send(`/books/${book}/simplefin/links/${id}/reread/preview`, {})
    ).json()) as { read: Record<string, number>; opening: { cash: string }; deleted: number };
    assert.equal(preview.read.sweep, 4);
    assert.equal(preview.opening.cash, "100.00");
    const done = await send(`/books/${book}/simplefin/links/${id}/reread`, {});
    assert.equal(done.status, 200);

    const holdings = (
      await me.ledger.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/holdings", {
        params: { path: { book_id: book, account: ACCOUNT } },
      })
    ).data!;
    const units = Object.fromEntries(holdings.holdings.map((h) => [h.commodity, Number(h.units)]));
    assert.deepEqual(units, { FXAIX: 50, ACME: 12, USD: 1905 });
    const journal = (
      await me.ledger.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/ledger", {
        params: { path: { book_id: book, account: `${ACCOUNT}:Cash` } },
      })
    ).data!;
    assert.ok(!journal.rows.some((r) => /CORE ACCOUNT/.test(r.narration ?? "")));
    assert.equal(journal.rows.filter((r) => r.narration?.startsWith("Electronic Funds")).length, 1);
  });

  it("brings a transfer of assets into an IRA in as shares at the bank's average cost, its dividends apart", async () => {
    const { me, book, send } = await setUp();
    const { user, setup_token } = (await fake("/control/users", "POST")) as {
      user: string;
      setup_token: string;
    };
    await fake(`/control/users/${user}/accounts/ira`, "PUT", {
      name: "Traditional IRA (5678)",
      institution: "Fidelity Investments",
      balance: "1943.00",
      holdings: [
        holding("SPAXX", "43.00", 1),
        { ...holding("SPAXX", "0", 1), id: "h-empty" }, // an empty core position
        holding("AAPL", "10", 120),
        // A unit trust without a symbol: named by its description; its transfer, by its CUSIP.
        {
          ...holding("", "9", 80),
          id: "h-ut",
          description: "XT UNIT 98765 EXAMPLE GROWTH PORT",
        },
      ],
    });
    const rows: [number, string, string][] = [
      [20, "1000.00", "TRANSFER OF ASSETS ACAT RECEIVE APPLE INC (AAPL) (Cash)"],
      [20, "900.00", "TRANSFER OF ASSETS ACAT RECEIVE 12345Z678 (Cash)"],
      [20, "40.00", "TRANSFER OF ASSETS ACAT RECEIVE (Cash)"],
      [20, "-40.00", `PURCHASE INTO CORE ACCOUNT ${CORE} (Cash)`],
      [18, "2.00", "TRANSFER OF ASSETS ACAT RES.CREDIT (Cash)"],
      [5, "1.00", `DIVIDEND RECEIVED ${CORE} (Cash)`],
    ];
    await fake(
      `/control/users/${user}/accounts/ira/transactions`,
      "POST",
      rows.map(([days, amount, text], i) => ({
        id: `i${i}`,
        posted: NOW - days * DAY,
        amount,
        description: text,
        memo: "",
        payee: "Fidelity",
      }))
    );
    const connection = (await (await send("/simplefin/connections", { setup_token })).json()) as {
      id: string;
    };
    const account = "Assets:Fidelity:Retirement:IRA";
    const link = { connection_id: connection.id, account_id: "ira", account, mode: "new" };
    assert.equal((await send(`/books/${book}/simplefin/links`, link)).status, 201);

    const holdings = (
      await me.ledger.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/holdings", {
        params: { path: { book_id: book, account } },
      })
    ).data!;
    const units = Object.fromEntries(holdings.holdings.map((h) => [h.commodity, Number(h.units)]));
    assert.deepEqual(units, { AAPL: 10, "XT-UNIT-98765-EXAMPLE": 9, USD: 43 });
    const aapl = holdings.holdings.find((h) => h.commodity === "AAPL")!;
    assert.equal(Number(aapl.cost!.number), 1200); // 10 at the bank's average cost, $120
    const journal = (
      await me.ledger.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/ledger", {
        params: { path: { book_id: book, account: `${account}:Cash` } },
      })
    ).data!;
    const dividend = journal.rows.find((r) => r.narration?.startsWith("DIVIDEND"))!;
    assert.equal(dividend.counterpart, "Income:Retirement:Dividends");
    const fromBroker = journal.rows.filter((r) => /ACAT (RECEIVE|RES)/.test(r.narration ?? ""));
    assert.deepEqual(
      fromBroker.map((r) => [r.flag, r.counterpart]),
      [
        ["!", "Equity:Opening-Balances"],
        ["!", "Equity:Opening-Balances"],
      ]
    );
  });
});

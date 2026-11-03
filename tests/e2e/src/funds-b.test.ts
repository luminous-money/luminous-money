/** Funds B, step 1, through the real stack: Kael's walkthrough (a brokerage divided among four
 * funds, shares moved, a buy with a fund's cash, a sale that needs a fund), a trade with its
 * lines, an IRA with Retirement as its default fund, and Notifications. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const CASH = "Assets:Brokerage:Fidelity:Cash";
const FXAIX = "Assets:Brokerage:Fidelity:FXAIX";
const VTI = "Assets:Brokerage:Fidelity:VTI";
const IRA = "Assets:Retirement:Roth-IRA";
const TEXT = `option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open ${CASH} USD
2026-01-01 open ${FXAIX}
2026-01-01 open ${VTI}
2026-01-01 open ${IRA}:Cash USD
2026-01-01 open ${IRA}:FXAIX
2026-01-01 open Income:Dividends
2026-01-01 open Income:Capital-Gains
2026-01-01 open Equity:Opening-Balances

2026-01-01 * "Opening balance"
  ${CASH}  6000.00 USD
  ${FXAIX}  200 FXAIX {150.00 USD}
  ${VTI}  50 VTI {250.00 USD}
  Equity:Opening-Balances

2026-01-01 * "Opening balance"
  ${IRA}:Cash  500.00 USD
  ${IRA}:FXAIX  20 FXAIX {100.00 USD}
  Equity:Opening-Balances

2026-01-01 * "Opening balance"
  Assets:Bank:Checking  3000.00 USD
  Equity:Opening-Balances

2026-11-01 price FXAIX 200.00 USD
2026-11-01 price VTI 300.00 USD
`;
const amount = (number: string, currency = "USD") => ({ number, currency });
const line = (fund: string, number: string, currency = "USD") => ({
  fund,
  amount: amount(number, currency),
});
const move = (to: string, number: string, currency = "USD", from = "Unallocated") => ({
  date: "2026-11-02",
  from_fund: from,
  to_fund: to,
  amount: amount(number, currency),
});
const sale = (units: string, proceeds: string, flag = "!") => ({
  date: "2026-11-04",
  flag,
  narration: `Sold ${units} VTI`,
  postings: [
    {
      account: VTI,
      units: amount(`-${units}`, "VTI"),
      cost: { number: "250.00", currency: "USD" },
    },
    { account: CASH, units: amount(proceeds) },
    { account: "Income:Capital-Gains" },
  ],
});

type User = Awaited<ReturnType<typeof newUser>>;
type Holding = { amount: { number: string; currency: string } };
type Funds = {
  funds: { name: string; value: { number: string }; holdings: Holding[]; accounts: string[] }[];
  unallocated_holdings: Holding[];
  defaults: { id: string; account: string; fund: string | null; updated_at: string }[];
};

const send = (user: User, url: string, method = "GET", body?: unknown) =>
  fetch(url, {
    method,
    headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function setUp() {
  const me = await newUser();
  const created = await me.app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mine", time_zone: "America/Chicago", text: TEXT }),
  });
  const { id: book } = (await created.json()) as { id: string };
  const ledger = (path: string, method = "GET", body?: unknown) =>
    send(me, `${BASE_URL}/api/ledger/v1/books/${book}${path}`, method, body);
  const app = (path: string, method = "GET", body?: unknown) =>
    send(me, `${BASE_URL}/api/app/v1/books/${book}${path}`, method, body);
  for (const name of ["Emergency", "Wedding", "Special Home Improvement", "Retirement"]) {
    const made = await ledger("/funds", "POST", { name });
    assert.equal(made.status, 201, await made.clone().text());
  }
  const held = async () => {
    const listing = (await (await ledger("/funds?on=2026-11-02")).json()) as Funds;
    const of = (holdings: Holding[]) =>
      Object.fromEntries(holdings.map((h) => [h.amount.currency, h.amount.number]));
    const byFund: Record<string, Record<string, string>> = Object.fromEntries(
      listing.funds.map((f) => [f.name, of(f.holdings)])
    );
    byFund["Unallocated"] = of(listing.unallocated_holdings);
    return Object.assign(byFund, { listing }) as Record<string, Record<string, string>> & {
      listing: Funds;
    };
  };
  return { book, ledger, app, held };
}

describe("Funds B: shares in funds", () => {
  before(stackIsUp);

  it("Kael's walkthrough: dividing a brokerage, moving shares, a buy and a sale", async () => {
    const { ledger, app, held } = await setUp();
    const moved = await ledger("/fund-moves/batch", "POST", {
      moves: [
        move("Emergency", "4000.00"),
        move("Emergency", "100", "FXAIX"),
        move("Wedding", "50", "FXAIX"),
        move("Wedding", "50", "VTI"),
        move("Special Home Improvement", "40", "FXAIX"),
      ],
    });
    assert.equal(moved.status, 201, await moved.clone().text());
    let now = await held();
    assert.deepEqual(now["Emergency"], { USD: "4000.00", FXAIX: "100" });
    assert.deepEqual(now["Wedding"], { FXAIX: "50", VTI: "50" });
    assert.equal(now.listing.funds.find((f) => f.name === "Wedding")!.value.number, "25000.00");
    assert.deepEqual(now.Unallocated, { USD: "5500.00", FXAIX: "30" });

    // More shares than a fund has can't be moved.
    const tooMany = await ledger("/fund-moves", "POST", move("Emergency", "60", "VTI", "Wedding"));
    assert.equal(tooMany.status, 422);
    assert.match(await tooMany.text(), /Wedding has 50 VTI, not 60 VTI/);

    // A buy with Emergency's cash: Emergency gives the dollars and gets the shares.
    const bought = await ledger("/transactions", "POST", {
      date: "2026-11-03",
      flag: "*",
      narration: "Bought 10 VTI",
      funds: [line("Emergency", "-3000.00"), line("Emergency", "10", "VTI")],
      postings: [
        { account: CASH, units: amount("-3000.00") },
        { account: VTI, units: amount("10", "VTI"), cost: { number: "300.00", currency: "USD" } },
      ],
    });
    assert.equal(bought.status, 201, await bought.clone().text());
    now = await held();
    assert.deepEqual(now["Emergency"], { USD: "1000.00", FXAIX: "100", VTI: "10" });

    // An unmarked sale of shares every fund holds: refused by hand ...
    const byHand = await ledger("/transactions", "POST", sale("20", "6100.00", "*"));
    assert.equal(byHand.status, 422);
    assert.match(await byHand.text(), /say which fund's VTI it is/);
    // ... kept when it came in by itself, and waiting in Notifications.
    const staged = await ledger("/transactions?staging=true", "POST", sale("20", "6100.00"));
    assert.equal(staged.status, 201);
    const { id, updated_at } = (await staged.json()) as { id: string; updated_at: string };
    const queue = (await (await app("/notifications")).json()) as {
      transaction_id: string;
      dismissable: boolean;
      detail: string;
    }[];
    assert.deepEqual(
      queue.map((n) => [n.transaction_id, n.dismissable]),
      [[id, false]]
    );
    assert.match(queue[0]!.detail, /takes 20 VTI from Unallocated/);
    // Confirming it unfixed is refused; saving it with Wedding's shares clears it.
    const confirmed = await ledger(`/transactions/${id}`, "PATCH", { updated_at, flag: "*" });
    assert.equal(confirmed.status, 422);
    const fixed = await ledger(`/transactions/${id}`, "PATCH", {
      updated_at,
      flag: "*",
      funds: [line("Wedding", "-20", "VTI"), line("Wedding", "6100.00")],
    });
    assert.equal(fixed.status, 200, await fixed.clone().text());
    assert.deepEqual(await (await app("/notifications")).json(), []);
    now = await held();
    assert.deepEqual(now["Wedding"], { USD: "6100.00", FXAIX: "50", VTI: "30" });
  });

  it("a trade carries its lines; an IRA's default fund holds it", async () => {
    const { ledger, held } = await setUp();
    await ledger("/fund-moves", "POST", move("Wedding", "3000.00"));
    const traded = await ledger(
      `/accounts/${encodeURIComponent("Assets:Brokerage:Fidelity")}/trades`,
      "POST",
      {
        kind: "buy",
        date: "2026-11-03",
        commodity: "VTI",
        units: "10",
        price: "300",
        cash_account: CASH,
        holding_account: VTI,
        funds: [line("Wedding", "-3000.00"), line("Wedding", "10", "VTI")],
      }
    );
    assert.equal(traded.status, 201, await traded.clone().text());
    assert.deepEqual((await held())["Wedding"], { VTI: "10" });

    const preview = await ledger("/fund-defaults/preview", "POST", {
      account: IRA,
      fund: "Retirement",
      date: "2026-01-01",
      delete: false,
    });
    assert.equal(preview.status, 200);
    assert.equal(
      ((await preview.json()) as { changes: { fund: string; value: { number: string } }[] })
        .changes[0]!.value.number,
      "4500.00"
    );
    const made = await ledger("/fund-defaults", "POST", {
      account: IRA,
      fund: "Retirement",
      date: "2026-01-01",
    });
    assert.equal(made.status, 201, await made.clone().text());
    // A contribution from checking: Retirement gets it, with nothing marked.
    await ledger("/transactions", "POST", {
      date: "2026-11-06",
      flag: "*",
      narration: "Contribution",
      postings: [
        { account: "Assets:Bank:Checking", units: amount("-500.00") },
        { account: `${IRA}:Cash`, units: amount("500.00") },
      ],
    });
    const now = await held();
    assert.deepEqual(now["Retirement"], { USD: "1000.00", FXAIX: "20" });
    assert.deepEqual(now.listing.funds.find((f) => f.name === "Retirement")!.accounts, [IRA]);
  });
});

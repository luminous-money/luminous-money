import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeSimplefin } from "@luminous-money/simplefin-fake";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDb } from "../db.js";
import { bankComparison } from "../reconcile.js";
import { FakeLedger } from "../testing.js";
import { cashLikeIn, fidelity, isRetirement, readerFor } from "./activity.js";
import { activityOf, fitHistory, readRows } from "./brokerage.js";
import { claim } from "./client.js";
import { Sealer } from "./crypto.js";
import { costOf, describedAs, positions } from "./holdings.js";
import { plan } from "./link.js";
import { planReread } from "./reread.js";
import { SimplefinStore } from "./store.js";
import { request, syncConnection, type SimplefinDeps } from "./sync.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ORIGIN = "http://bridge.test";
const NOW = Date.parse("2026-10-15T17:00:00Z") / 1000;
const DAY = 86400;
const at = (date: string) => Date.parse(`${date}T15:00:00Z`) / 1000;
const ACCOUNT = "Assets:Fidelity:Joint";
const CASH = `${ACCOUNT}:Cash`;

let fake: ReturnType<typeof createFakeSimplefin>;
let db: AppDb;
let ledger: FakeLedger;
let deps: SimplefinDeps;
let clock = NOW;

const control = async (path: string, method = "GET", body?: unknown) =>
  (
    await fake.fetch(`${ORIGIN}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  ).json() as Promise<Record<string, unknown>>;

const holding = (symbol: string, shares: string, price: number, averageCost?: number) => ({
  id: `h-${symbol || "unnamed"}`,
  symbol,
  description: symbol ? `${symbol} fund` : "XT UNIT 98765 EXAMPLE GROWTH PORT",
  shares,
  // Fidelity's cost basis is always zero; its purchase price is the average cost.
  cost_basis: "0.00",
  purchase_price: averageCost === undefined ? null : String(averageCost),
  market_value: (Number(shares) * price).toFixed(2),
  currency: "USD",
  created: null,
});

const SPAXX = (cash: string) => holding("SPAXX", cash, 1);

type BankRow = { id: string; date: string; amount: string; text: string };

/** A Fidelity brokerage at the fake bank, with its history; connected. */
async function brokerage(
  rows: BankRow[],
  holdings: ReturnType<typeof holding>[],
  { institution = "Fidelity Investments", name = "Joint WROS (1234)" } = {}
) {
  const { user, setup_token } = (await control("/control/users", "POST")) as {
    user: string;
    setup_token: string;
  };
  await put(user, holdings, { institution, name });
  await post(user, rows);
  const access = await claim(setup_token, deps.policy, fake.fetch);
  const connection = deps.store.addConnection("u", deps.sealer.seal(access), "bridge.test", 400);
  await request(deps, connection, { balancesOnly: true });
  return { user, connection: deps.store.connection("u", connection.id)! };
}

const total = (holdings: ReturnType<typeof holding>[]) =>
  holdings.reduce((n, h) => n + Number(h.market_value), 0).toFixed(2);

const put = (
  user: string,
  holdings: ReturnType<typeof holding>[],
  extra: Record<string, unknown> = {}
) =>
  control(`/control/users/${user}/accounts/brk`, "PUT", {
    balance: total(holdings),
    balance_date: clock,
    holdings,
    ...extra,
  });

const post = (user: string, rows: BankRow[]) =>
  control(
    `/control/users/${user}/accounts/brk/transactions`,
    "POST",
    rows.map((r) => ({
      id: r.id,
      posted: at(r.date),
      transacted_at: at(r.date),
      amount: r.amount,
      description: r.text,
      memo: "",
      payee: "Fidelity",
    }))
  );

const link = async (
  connection: Awaited<ReturnType<typeof brokerage>>["connection"],
  account = ACCOUNT
) => {
  const planned = await plan(deps, {
    user: "u",
    connection,
    accountId: "brk",
    book: "b",
    account,
    mode: "new",
  });
  await planned.apply();
  return planned.preview;
};

const units = (account: string, currency: string) =>
  ledger.transactions
    .flatMap((t) => t.postings)
    .filter((p) => p.account === account && p.units?.currency === currency)
    .reduce((n, p) => n + Number(p.units!.number), 0);

const byText = (text: string) => ledger.transactions.filter((t) => t.narration?.startsWith(text));

const CORE = "FIDELITY GOVERNMENT MONEY MARKET (SPAXX)";
const HISTORY: BankRow[] = [
  {
    id: "eft",
    date: "2026-09-01",
    amount: "1000.00",
    text: "Electronic Funds Transfer Received (Cash)",
  },
  {
    id: "s1",
    date: "2026-09-01",
    amount: "-1000.00",
    text: `PURCHASE INTO CORE ACCOUNT ${CORE} MORNING TRADE`,
  },
  {
    id: "buy",
    date: "2026-09-02",
    amount: "-400.00",
    text: "YOU BOUGHT ACME CORP COM (ACME) (Cash)",
  },
  {
    id: "s2",
    date: "2026-09-03",
    amount: "400.00",
    text: `REDEMPTION FROM CORE ACCOUNT ${CORE} (Cash)`,
  },
  {
    id: "sell",
    date: "2026-09-10",
    amount: "300.00",
    text: "YOU SOLD FIDELITY 500 INDEX FUND (FXAIX) (Cash)",
  },
  {
    id: "s3",
    date: "2026-09-11",
    amount: "-300.00",
    text: `PURCHASE INTO CORE ACCOUNT ${CORE} (Cash)`,
  },
  { id: "div", date: "2026-09-30", amount: "5.00", text: `DIVIDEND RECEIVED ${CORE} (Cash)` },
  { id: "s4", date: "2026-09-30", amount: "-5.00", text: `REINVESTMENT ${CORE} (Cash)` },
];
// Today: 10 ACME from before the history and 2 bought; 60 FXAIX less 10 sold; the cash.
const TODAY = [SPAXX("1005.00"), holding("ACME", "12", 200, 150), holding("FXAIX", "50", 30, 25)];

beforeEach(() => {
  clock = NOW;
  fake = createFakeSimplefin({ origin: ORIGIN });
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addBook("b");
  db.setTimeZone("b", "America/Chicago", "u");
  ledger.sourcePrices.set("ACME 2026-09-02", 200);
  ledger.sourcePrices.set("FXAIX 2026-09-10", 30);
  deps = {
    db,
    store: new SimplefinStore(db.db),
    sealer: new Sealer(KEY),
    policy: { hosts: ["bridge.test"], allowInsecure: true },
    ledgerFor: () => ledger,
    categorizers: [],
    fetcher: fake.fetch,
    clock: () => clock,
  };
});

describe("reading Fidelity's rows", () => {
  const read = (text: string) => fidelity.read(text, cashLikeIn([SPAXX("100.00")]));

  it("tells each kind of row by its words, and the security it names", () => {
    expect(read(`PURCHASE INTO CORE ACCOUNT ${CORE} MORNING TRADE`)).toEqual({
      kind: "sweep",
      security: "SPAXX",
    });
    expect(read(`REDEMPTION FROM CORE ACCOUNT ${CORE} (Cash)`).kind).toBe("sweep");
    expect(read(`REINVESTMENT ${CORE} (Cash)`).kind).toBe("sweep");
    expect(read("REINVESTMENT FIDELITY 500 INDEX FUND (FXAIX) (Cash)")).toEqual({
      kind: "buy",
      security: "FXAIX",
    });
    expect(read(`DIVIDEND RECEIVED ${CORE} (Cash)`)).toEqual({
      kind: "dividend",
      security: "SPAXX",
    });
    expect(read("YOU BOUGHT ACME CORP COM (ACME) (Cash)")).toEqual({
      kind: "buy",
      security: "ACME",
    });
    expect(read("YOU SOLD FIDELITY 500 INDEX FUND (FXAIX) (Margin)")).toEqual({
      kind: "sell",
      security: "FXAIX",
    });
    expect(read("TRANSFER OF ASSETS ACAT RECEIVE APPLE INC (AAPL) (Cash)")).toEqual({
      kind: "shares-in",
      security: "AAPL",
    });
    expect(read("TRANSFER OF ASSETS ACAT RECEIVE 12345Z678 (Cash)")).toEqual({
      kind: "shares-in",
      security: "12345Z678",
    });
    expect(read("TRANSFER OF ASSETS ACAT RECEIVE (Cash)")).toEqual({
      kind: "cash-in",
      security: null,
    });
    expect(read("TRANSFER OF ASSETS ACAT RES.CREDIT (Cash)")).toEqual({
      kind: "cash-in",
      security: null,
    });
    expect(read("DIRECT DEPOSIT EXAMPLE CO Payment (Cash)").kind).toBe("other");
    expect(read("LONG-TERM CAP GAIN FIDELITY 500 (FXAIX) (Cash)").kind).toBe("other");
    // A core purchase naming something that isn't cash isn't a sweep.
    expect(read("PURCHASE INTO CORE ACCOUNT SOMETHING (XYZ)").kind).toBe("other");
  });

  it("has a reader only for the institutions it knows", () => {
    expect(readerFor("Fidelity Investments")?.name).toBe("Fidelity");
    expect(readerFor("Vanguard")).toBeUndefined();
  });

  it("knows a retirement account by its name, the bank's or the book's", () => {
    expect(isRetirement("Assets:Fidelity:Retirement:ROTH-IRA")).toBe(true);
    expect(isRetirement("Assets:Fidelity:Joint", "Traditional IRA (5678)")).toBe(true);
    expect(isRetirement("Assets:Fidelity:Joint", "Joint WROS (1234)")).toBe(false);
  });
});

describe("the snapshot's holdings", () => {
  it("cost from the average purchase price; no position without shares; a description names one without a symbol", () => {
    const unnamed = holding("", "100", 9, 8);
    const held = positions([
      SPAXX("0"),
      holding("SPAXX", "0", 1),
      holding("ACME", "2", 200, 150),
      unnamed,
    ]);
    expect([...held.keys()]).toEqual(["ACME", "XT-UNIT-98765-EXAMPLE"]);
    expect(costOf(held.get("ACME")!)).toBe(300);
    expect(describedAs("Balanced Growth Portfolio 2050")).toBe("BALANCED-GROWTH");
  });

  it("a CUSIP names the one position without a symbol", () => {
    const snapshot = { holdings: [holding("", "100", 9, 8), SPAXX("5")] } as never;
    const [row] = readRows(
      fidelity,
      [
        {
          line: 1,
          id: "x",
          date: "2026-09-22",
          amount: "900.00",
          description: "TRANSFER OF ASSETS ACAT RECEIVE 12345Z678 (Cash)",
          payee: null,
          balance: null,
          error: null,
        },
      ],
      snapshot
    );
    expect(row).toMatchObject({
      activity: { kind: "shares-in" },
      commodity: "XT-UNIT-98765-EXAMPLE",
    });
  });
});

describe("fitting a history to today's shares", () => {
  it("opens what the trades leave, and fits estimates that leave next to nothing", () => {
    const fitted = fitHistory(
      [
        { key: "a", commodity: "ACME", units: 2.05 },
        { key: "b", commodity: "FXAIX", units: -10 },
        { key: "c", commodity: "AAPL", units: 9.8 },
        { key: "d", commodity: "AAPL", units: 0.3 },
      ],
      new Map([
        ["ACME", 12],
        ["FXAIX", 50],
        ["AAPL", 10],
        ["MSFT", 4],
      ])
    );
    expect(Object.fromEntries(fitted.opening)).toEqual({ ACME: 9.95, FXAIX: 60, MSFT: 4 });
    // AAPL: the history explains it all (within 5%): the estimates take up the difference.
    expect(fitted.units.get("c")! + fitted.units.get("d")!).toBeCloseTo(10, 9);
    expect(fitted.units.get("c")).toBeCloseTo(9.703, 3);
  });
});

describe("a Fidelity brokerage's history, when linked", () => {
  it("leaves sweeps out, confirms dividends, books trades, and opens positions as they were", async () => {
    const { connection } = await brokerage(HISTORY, TODAY);
    const preview = await link(connection);
    // Today's cash, less what the rows did to it (sweeps and all, none).
    expect(preview).toMatchObject({
      kind: "brokerage",
      reader: "Fidelity",
      opening: { amount: "100.00", date: "2026-08-31" },
    });

    expect(units(CASH, "USD")).toBeCloseTo(1005, 6);
    expect(units(`${ACCOUNT}:ACME`, "ACME")).toBeCloseTo(12, 9);
    expect(units(`${ACCOUNT}:FXAIX`, "FXAIX")).toBeCloseTo(50, 9);
    // No transaction for a sweep; each is kept as left out, so it never comes again.
    expect(byText("PURCHASE INTO CORE")).toEqual([]);
    expect(byText("REINVESTMENT")).toEqual([]);
    const left = db.importedBefore("b", CASH, ["id:sfin:s1", "id:sfin:s4"]);
    expect(left.size).toBe(2);

    const [dividend] = byText("DIVIDEND RECEIVED");
    expect(dividend).toMatchObject({ flag: "*" });
    expect(dividend!.postings.map((p) => p.account)).toEqual([CASH, "Income:Dividends"]);

    const [buy] = byText("YOU BOUGHT");
    expect(buy!.flag).toBe("!");
    expect(buy!.postings.map((p) => [p.account, p.units?.number])).toEqual([
      [`${ACCOUNT}:ACME`, "2"],
      [CASH, "-400.00"],
    ]);
    expect(buy!.meta!["brokerage-note"]).toMatch(/Shares estimated: 2 ACME at \$200\.00, fitted/);
    const [sale] = byText("YOU SOLD");
    expect(sale!.postings[0]).toMatchObject({
      account: `${ACCOUNT}:FXAIX`,
      units: { number: "-10" },
    });

    // The opening lots: before the history, at what today's cost leaves after the buy.
    const opening = ledger.transactions.find(
      (t) => t.narration === "Opening balance" && t.postings[0]!.account === `${ACCOUNT}:ACME`
    )!;
    expect(opening.postings[0]).toMatchObject({
      units: { number: "10", currency: "ACME" },
      cost: { total: "1400", date: "2026-08-31", label: "estimated" },
    });
    // The deposit goes through the usual pipeline, for review.
    expect(byText("Electronic Funds Transfer")[0]!.postings[1]!.account).toBe(
      "Income:Uncategorized"
    );

    const link_ = deps.store.links(connection.id)[0]!;
    expect(activityOf(deps, link_)).toEqual({
      sweeps: 4,
      dividends: 1,
      trades: 2,
      transfers_in: 0,
      other: 1,
    });
    // The books' cash agrees with the bank's (its core counted as cash).
    expect(await bankComparison(db, deps.store, ledger, link_)).toMatchObject({ off_by: null });
  });

  it("sends a retirement account's dividends apart, and a transfer of assets in as shares", async () => {
    const { connection } = await brokerage(
      [
        {
          id: "a",
          date: "2026-09-22",
          amount: "1800.00",
          text: "TRANSFER OF ASSETS ACAT RECEIVE APPLE INC (AAPL) (Cash)",
        },
        {
          id: "u",
          date: "2026-09-22",
          amount: "880.00",
          text: "TRANSFER OF ASSETS ACAT RECEIVE 12345Z678 (Cash)",
        },
        {
          id: "c",
          date: "2026-09-22",
          amount: "40.00",
          text: "TRANSFER OF ASSETS ACAT RECEIVE (Cash)",
        },
        {
          id: "s",
          date: "2026-09-22",
          amount: "-40.00",
          text: `PURCHASE INTO CORE ACCOUNT ${CORE} (Cash)`,
        },
        {
          id: "r",
          date: "2026-09-24",
          amount: "3.00",
          text: "TRANSFER OF ASSETS ACAT RES.CREDIT (Cash)",
        },
        { id: "d", date: "2026-09-30", amount: "1.00", text: `DIVIDEND RECEIVED ${CORE} (Cash)` },
      ],
      [SPAXX("44.00"), holding("AAPL", "10", 185, 120), holding("", "100", 9, 8)],
      { name: "Traditional IRA (5678)" }
    );
    ledger.sourcePrices.set("AAPL 2026-09-22", 182);
    await link(connection, "Assets:Fidelity:IRA");

    expect(byText("DIVIDEND RECEIVED")[0]!.postings[1]!.account).toBe(
      "Income:Retirement:Dividends"
    );
    // Shares in, against Opening Balances at the bank's average cost: no cash.
    const [aapl] = byText("TRANSFER OF ASSETS ACAT RECEIVE APPLE");
    expect(aapl!.postings.map((p) => [p.account, p.units?.number, p.units?.currency])).toEqual([
      ["Assets:Fidelity:IRA:AAPL", "10", "AAPL"],
      ["Equity:Opening-Balances", "-1200.00", "USD"],
    ]);
    expect(units("Assets:Fidelity:IRA:XT-UNIT-98765-EXAMPLE", "XT-UNIT-98765-EXAMPLE")).toBe(100);
    // Cash from the old broker: for review, against Opening Balances.
    const cashIn = byText("TRANSFER OF ASSETS ACAT R").filter((t) =>
      t.postings[0]!.account.endsWith(":Cash")
    );
    expect(cashIn.map((t) => [t.flag, t.postings[1]!.account])).toEqual([
      ["!", "Equity:Opening-Balances"],
      ["!", "Equity:Opening-Balances"],
    ]);
    // No position opened before the history: it all came by transfer.
    expect(
      ledger.transactions.filter(
        (t) => t.narration === "Opening balance" && !t.postings[0]!.account.endsWith(":Cash")
      )
    ).toEqual([]);
    expect(units("Assets:Fidelity:IRA:Cash", "USD")).toBeCloseTo(44, 6);
  });
});

describe("a Fidelity brokerage, synced each day", () => {
  it("takes a trade's shares from the snapshot, trues up an estimate, and waits before staging what nothing explains", async () => {
    const { user, connection } = await brokerage(HISTORY, TODAY);
    await link(connection);
    const sync = async (date: string, rows: BankRow[], holdings: ReturnType<typeof holding>[]) => {
      clock = at(date) + 7200;
      await post(user, rows);
      await put(user, holdings);
      await syncConnection(deps, deps.store.connection("u", connection.id)!);
    };

    // A buy the snapshot shows: its shares exactly.
    await sync(
      "2026-10-16",
      [
        {
          id: "b2",
          date: "2026-10-16",
          amount: "-610.00",
          text: "YOU BOUGHT ACME CORP COM (ACME) (Cash)",
        },
      ],
      [SPAXX("395.00"), holding("ACME", "15", 203, 160), holding("FXAIX", "50", 30, 25)]
    );
    const [, b2] = byText("YOU BOUGHT");
    expect(b2!.postings[0]!.units).toMatchObject({ number: "3" });
    expect(b2!.meta!["brokerage-note"]).toBeUndefined();

    // One it doesn't show yet: estimated from the day's price, then trued up when it does.
    await sync(
      "2026-10-17",
      [
        {
          id: "b3",
          date: "2026-10-17",
          amount: "-206.00",
          text: "YOU BOUGHT ACME CORP COM (ACME) (Cash)",
        },
      ],
      [SPAXX("189.00"), holding("ACME", "15", 203, 160), holding("FXAIX", "50", 30, 25)]
    );
    const estimated = byText("YOU BOUGHT").at(-1)!;
    expect(estimated.meta!["brokerage-estimate"]).toBeDefined();
    expect(Number(estimated.postings[0]!.units!.number)).toBeCloseTo(206 / 203, 3);
    await sync(
      "2026-10-18",
      [],
      [SPAXX("189.00"), holding("ACME", "16", 206, 163), holding("FXAIX", "50", 30, 25)]
    );
    const trued = byText("YOU BOUGHT").at(-1)!;
    expect(trued.postings[0]!.units).toMatchObject({ number: "1" });
    expect(trued.postings[1]!.units).toMatchObject({ number: "-206.00" });
    expect(trued.meta!["brokerage-note"]).toMatch(/from the bank's holdings/);
    expect(db.importedBefore("b", CASH, ["id:sfin:b3"]).size).toBe(1);

    // Shares gone with no row to say why: staged only once seen on three days.
    const fewer = [
      SPAXX("189.00"),
      holding("ACME", "16", 206, 163),
      holding("FXAIX", "45", 30, 25),
    ];
    await sync("2026-10-19", [], fewer);
    await sync("2026-10-20", [], fewer);
    expect(byText("Sold 5 FXAIX")).toEqual([]);
    await sync("2026-10-21", [], fewer);
    expect(byText("Sold 5 FXAIX")).toHaveLength(1);
    expect(units(`${ACCOUNT}:FXAIX`, "FXAIX")).toBeCloseTo(45, 9);
  });
});

describe("reading a brokerage again", () => {
  it("rebuilds what came in as cash, keeping transfers and what you made of anything else", async () => {
    // Linked before its rows were read: everything came in as cash.
    const { user, connection } = await brokerage(HISTORY, TODAY, { institution: "Somewhere" });
    await link(connection);
    expect(byText("PURCHASE INTO CORE")).toHaveLength(2);
    const deposit = byText("Electronic Funds Transfer")[0]!;
    deposit.postings[1]!.account = "Income:Rewards"; // categorized by hand
    // Now its institution is read.
    await put(user, TODAY, { institution: "Fidelity Investments" });
    await request(deps, deps.store.connection("u", connection.id)!, { balancesOnly: true });

    const link_ = deps.store.links(connection.id)[0]!;
    const planned = await planReread(deps, link_);
    expect(planned.preview).toMatchObject({
      rows: 8,
      read: { sweep: 4, dividend: 1, buy: 1, sell: 1, other: 0 },
      kept: 1,
      opening: { date: "2026-08-31", cash: "100.00" },
    });
    await planned.apply();

    expect(byText("PURCHASE INTO CORE")).toEqual([]);
    expect(byText("Electronic Funds Transfer")[0]!.postings[1]!.account).toBe("Income:Rewards");
    expect(units(CASH, "USD")).toBeCloseTo(1005, 6);
    expect(units(`${ACCOUNT}:ACME`, "ACME")).toBeCloseTo(12, 9);
    expect(units(`${ACCOUNT}:FXAIX`, "FXAIX")).toBeCloseTo(50, 9);
    expect(byText("DIVIDEND RECEIVED")[0]!.flag).toBe("*");
    // Read again, it's as if linked so: again, nothing changes but the IDs.
    const again = await planReread(deps, deps.store.links(connection.id)[0]!);
    expect(again.preview).toMatchObject({ kept: 1, read: { sweep: 4 } });
  });
});

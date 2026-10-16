import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeSimplefin } from "@fava-beans/simplefin-fake";
import { beforeEach, describe, expect, it } from "vitest";

import { AppDb } from "../db.js";
import { FakeLedger } from "../testing.js";
import { claim, parseAccountSet, SimplefinProblem } from "./client.js";
import { Sealer } from "./crypto.js";
import { cashOf, positions } from "./holdings.js";
import { plan } from "./link.js";
import { DAILY_BUDGET, SimplefinStore } from "./store.js";
import {
  backfill,
  OutOfRequests,
  request,
  rowsOf,
  syncConnection,
  type SimplefinDeps,
} from "./sync.js";
import { checkUrl, isPrivateAddress } from "./urls.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ORIGIN = "http://bridge.test";
const NOW = Date.parse("2026-10-15T17:00:00Z") / 1000;
const DAY = 86400;
const CHECKING = "Assets:Bank:Checking";
const at = (date: string) => Date.parse(`${date}T15:00:00Z`) / 1000;

let fake: ReturnType<typeof createFakeSimplefin>;
let db: AppDb;
let ledger: FakeLedger;
let deps: SimplefinDeps;

const control = async (path: string, method = "GET", body?: unknown) =>
  (
    await fake.fetch(`${ORIGIN}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  ).json() as Promise<Record<string, unknown>>;

/** A fake bank user with a checking account and some posted transactions; connected. */
async function connected(
  transactions: { id: string; date: string; amount: string; memo?: string }[],
  balance = "1500.00",
  holdings: unknown[] = []
) {
  const { user, setup_token } = (await control("/control/users", "POST")) as {
    user: string;
    setup_token: string;
  };
  await control(`/control/users/${user}/accounts/chk`, "PUT", {
    name: "Everyday Checking",
    institution: "Fake Bank",
    balance,
    balance_date: NOW,
    holdings,
  });
  await control(
    `/control/users/${user}/accounts/chk/transactions`,
    "POST",
    transactions.map((t) => ({
      id: t.id,
      posted: at(t.date),
      transacted_at: at(t.date),
      amount: t.amount,
      description: t.memo ?? `Purchase ${t.id}`,
      memo: t.memo ?? `POS ${t.id.toUpperCase()}`,
      payee: `Shop ${t.id}`,
    }))
  );
  const access = await claim(setup_token, deps.policy, fake.fetch);
  const connection = deps.store.addConnection("u", deps.sealer.seal(access), "bridge.test", 400);
  await request(deps, connection, { balancesOnly: true });
  return { user, connection: deps.store.connection("u", connection.id)! };
}

const tx = (date: string, amount: string, flag = "*", narration = "mine") =>
  ledger.addTransaction({
    date,
    flag,
    payee: null,
    narration,
    tags: [],
    links: [],
    meta: {},
    postings: [
      { account: CHECKING, units: { number: amount, currency: "USD" } },
      { account: "Expenses:Food", units: null },
    ],
  });

const balanceOf = (account: string) =>
  ledger.transactions
    .flatMap((t) => t.postings)
    .filter((p) => p.account === account && p.units?.currency === "USD")
    .reduce((n, p) => n + Number(p.units!.number), 0);

beforeEach(() => {
  fake = createFakeSimplefin({ origin: ORIGIN });
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addBook("b");
  db.setTimeZone("b", "America/Chicago", "u");
  deps = {
    db,
    store: new SimplefinStore(db.db),
    sealer: new Sealer(KEY),
    policy: { hosts: ["bridge.test"], allowInsecure: true },
    ledgerFor: () => ledger,
    categorizers: [],
    fetcher: fake.fetch,
    clock: () => NOW,
  };
});

describe("credentials and URLs", () => {
  it("seals with a fresh nonce each time, and only the same key opens", () => {
    const sealer = new Sealer(KEY);
    const a = sealer.seal("https://u:p@bridge/simplefin");
    expect(a).not.toBe(sealer.seal("https://u:p@bridge/simplefin"));
    expect(sealer.open(a)).toBe("https://u:p@bridge/simplefin");
    expect(() => new Sealer(Buffer.alloc(32, 9).toString("base64")).open(a)).toThrow(/different/);
  });

  it("fetches only https, from allowed hosts, never private addresses", async () => {
    const policy = { hosts: ["beta-bridge.simplefin.org"], allowInsecure: false };
    const resolve = async (host: string) =>
      host === "beta-bridge.simplefin.org" ? ["203.0.113.9"] : [];
    await expect(checkUrl("http://beta-bridge.simplefin.org/x", policy, resolve)).rejects.toThrow(
      /https/
    );
    await expect(checkUrl("https://evil.example/x", policy, resolve)).rejects.toThrow(
      /isn't a SimpleFIN/
    );
    await expect(
      checkUrl("https://beta-bridge.simplefin.org/x", policy, async () => ["10.0.0.5"])
    ).rejects.toThrow(/private/);
    await expect(
      checkUrl("https://beta-bridge.simplefin.org/x", policy, resolve)
    ).resolves.toBeDefined();
    expect(
      ["127.0.0.1", "192.168.1.4", "::1", "fd00::1", "::ffff:10.1.1.1"].every(isPrivateAddress)
    ).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("claims a setup token once; the second time says it may be someone else's", async () => {
    const { setup_token } = (await control("/control/users", "POST")) as { setup_token: string };
    const access = await claim(setup_token, deps.policy, fake.fetch);
    expect(access).toMatch(/^http:\/\/user\w+:\w+@bridge\.test\/simplefin$/);
    await expect(claim(setup_token, deps.policy, fake.fetch)).rejects.toThrow(SimplefinProblem);
    await expect(claim("not base64 at all!", deps.policy, fake.fetch)).rejects.toThrow(
      /setup token/
    );
  });
});

describe("reading SimpleFIN", () => {
  it("reads both error shapes, payees, memos, holdings, and pending", () => {
    const old = parseAccountSet({
      errors: ["Connection to Fake Bank may need attention"],
      accounts: [
        {
          org: { name: "Fake Bank" },
          id: "a",
          name: "A",
          currency: "USD",
          balance: "1.00",
          "balance-date": 1,
          transactions: [
            {
              id: "t",
              posted: 0,
              amount: "-1",
              description: "D",
              payee: "P",
              memo: "M",
              pending: true,
            },
          ],
          holdings: [
            { id: "h", symbol: "AAPL", shares: "2", market_value: "400", cost_basis: "100" },
          ],
        },
      ],
    });
    expect(old.errors).toEqual([
      { code: "gen.", message: "Connection to Fake Bank may need attention", account_id: null },
    ]);
    expect(old.accounts[0]).toMatchObject({
      institution: "Fake Bank",
      transactions: [{ payee: "P", memo: "M", pending: true }],
    });
    expect(old.accounts[0]!.holdings[0]).toMatchObject({
      symbol: "AAPL",
      shares: "2",
      market_value: "400",
    });
    const current = parseAccountSet({
      errlist: [{ code: "con.auth", msg: "log in", account_id: "a" }],
      accounts: [],
    });
    expect(current.errors).toEqual([{ code: "con.auth", message: "log in", account_id: "a" }]);
  });

  it("dates rows when they happened in the book's time zone, with the bank's raw text", () => {
    const rows = rowsOf(
      [
        {
          id: "1",
          posted: at("2026-03-02"),
          transacted_at: Date.parse("2026-03-01T03:00:00Z") / 1000,
          amount: "-4.50",
          description: "Coffee",
          payee: "Cafe",
          memo: "POS CAFE #12",
          pending: false,
        },
      ],
      "America/Chicago"
    );
    expect(rows[0]).toMatchObject({
      date: "2026-02-28",
      description: "POS CAFE #12",
      payee: "Cafe",
      id: "sfin:1",
    });
  });
});

describe("fetching", () => {
  it("stops at the daily budget", async () => {
    const { connection } = await connected([]);
    for (let i = 1; i < DAILY_BUDGET; i++) await request(deps, connection, { balancesOnly: true });
    await expect(request(deps, connection, { balancesOnly: true })).rejects.toThrow(OutOfRequests);
  });

  it("backfills 90-day windows until two in a row are empty", async () => {
    const { user, connection } = await connected([
      { id: "a", date: "2026-10-01", amount: "-10.00" },
      { id: "b", date: "2026-05-01", amount: "-20.00" },
    ]);
    expect(await backfill(deps, connection, "chk")).toBe(true);
    expect(deps.store.transactions(connection.id, "chk").map((t) => t.id)).toEqual(["b", "a"]);
    // balances-only, then: Jul–Oct (a), Apr–Jul (b), Jan–Apr (empty), Oct–Jan (empty)
    expect(((await control(`/control/users/${user}`)) as { requests: number }).requests).toBe(5);
  });
});

describe("linking", () => {
  const HISTORY = [
    { id: "a", date: "2026-08-01", amount: "-40.00" },
    { id: "b", date: "2026-08-15", amount: "2000.00" },
    { id: "c", date: "2026-09-10", amount: "-60.00" },
  ];

  it("a new account opens the day before the bank's history, at the reported balance less it", async () => {
    const { connection } = await connected(HISTORY, "2400.00");
    const input = {
      user: "u",
      connection,
      accountId: "chk",
      book: "b",
      account: CHECKING,
      mode: "new" as const,
    };

    const planned = await plan(deps, input);
    expect(planned.preview).toMatchObject({
      kind: "cash",
      history_complete: true,
      added: 3,
      opening: { date: "2026-07-31", amount: "500.00" },
    });
    await planned.apply();

    expect(ledger.accountList.find((a) => a.name === CHECKING)).toMatchObject({
      as_of: "2026-07-31",
    });
    expect(balanceOf(CHECKING)).toBe(2400);
    expect(ledger.transactions.filter((t) => t.flag === "!")).toHaveLength(3);
    // The next sync's 5-day overlap re-sends c: it's a duplicate, so nothing comes in.
    expect(await syncConnection(deps, deps.store.connection("u", connection.id)!)).toEqual([]);
  });

  it("reconciling keeps your matching work, re-pends the rest, and the bank's balance holds", async () => {
    ledger.addAccount(CHECKING, { as_of: "2026-01-01", currencies: ["USD"] });
    ledger.addAccount("Expenses:Food", { type: "expense" });
    const opening = ledger.addTransaction({
      date: "2026-01-01",
      flag: "*",
      payee: null,
      narration: "Opening balance",
      tags: [],
      links: [],
      meta: {},
      postings: [
        { account: CHECKING, units: { number: "1000.00", currency: "USD" } },
        { account: "Equity:Opening-Balances", units: null },
      ],
    });
    const old = tx("2026-03-01", "-100.00"); // before the bank's history: left alone
    const groceries = tx("2026-08-02", "-40.00", "*", "groceries"); // the bank's a
    const pay = tx("2026-08-15", "2000.00", "!", "pay"); // the bank's b, still pending
    const stray = tx("2026-09-20", "-15.00", "*", "cash I never spent"); // not at the bank
    const { connection } = await connected(HISTORY, "2400.00");
    const input = {
      user: "u",
      connection,
      accountId: "chk",
      book: "b",
      account: CHECKING,
      mode: "reconcile" as const,
    };

    const planned = await plan(deps, input);
    expect(planned.preview).toMatchObject({
      matched: 2,
      added: 1,
      not_at_bank: 1,
      opening: { date: "2026-01-01", amount: "600.00", was: "1000.00" },
    });
    await planned.apply();

    const flag = (t: { id: string }) => ledger.transactions.find((x) => x.id === t.id)!.flag;
    expect([flag(groceries), flag(pay), flag(stray), flag(old)]).toEqual(["*", "*", "!", "*"]);
    expect(ledger.transactions.find((t) => t.id === groceries.id)!.narration).toBe("groceries");
    expect(ledger.transactions.find((t) => t.id === opening.id)!.postings[0]!.units!.number).toBe(
      "600.00"
    );
    expect(ledger.transactions.find((t) => t.narration === "POS C")).toMatchObject({ flag: "!" });
    // Once the stray is dealt with, the books' balance is the bank's.
    expect(balanceOf(CHECKING) - -15).toBe(2400);
  });

  it("starting over deletes the account's transactions and links as new", async () => {
    ledger.addAccount(CHECKING, { as_of: "2026-01-01", currencies: ["USD"] });
    tx("2026-08-02", "-40.00");
    const transfer = tx("2026-08-03", "-500.00");
    transfer.postings[1]!.account = "Assets:Bank:Savings";
    const { connection } = await connected(HISTORY, "2400.00");
    const input = {
      user: "u",
      connection,
      accountId: "chk",
      book: "b",
      account: CHECKING,
      mode: "start-over" as const,
    };

    const planned = await plan(deps, input);
    expect(planned.preview).toMatchObject({ deleted: 2, deleted_elsewhere: 1, added: 3 });
    await planned.apply();

    expect(balanceOf(CHECKING)).toBe(2400);
    expect(ledger.transactions.some((t) => t.id === transfer.id)).toBe(false);
  });

  it("from a date, only what's new comes in, reconciling nothing", async () => {
    ledger.addAccount(CHECKING, { currencies: ["USD"] });
    const { connection } = await connected(HISTORY, "2400.00");
    const input = {
      user: "u",
      connection,
      accountId: "chk",
      book: "b",
      account: CHECKING,
      mode: "from-date" as const,
      from: "2026-08-10",
    };

    await (await plan(deps, input)).apply();

    expect(ledger.transactions.map((t) => t.postings[0]!.units!.number).sort()).toEqual([
      "-60.00",
      "2000.00",
    ]);
  });

  it("refuses a second link to either side", async () => {
    const { connection } = await connected(HISTORY);
    const input = {
      user: "u",
      connection,
      accountId: "chk",
      book: "b",
      account: CHECKING,
      mode: "new" as const,
    };
    await (await plan(deps, input)).apply();
    await expect(plan(deps, { ...input, account: "Assets:Bank:Other" })).rejects.toThrow(
      /already linked/
    );
  });
});

describe("brokerages", () => {
  const HOLDINGS = [
    { id: "h1", symbol: "VTI", shares: "10", cost_basis: "2000.00", market_value: "3000.00" },
    { id: "h2", symbol: "SPAXX", shares: "250.00", market_value: "250.00" },
  ];

  it("count money-market core positions as cash", () => {
    const holdings = HOLDINGS.map((h) => ({
      ...h,
      currency: "USD",
      description: null,
      purchase_price: null,
      created: null,
      cost_basis: h.cost_basis ?? null,
    }));
    expect([...positions(holdings).keys()]).toEqual(["VTI"]);
    expect(cashOf("3250.00", holdings)).toBe("250.00");
  });

  it("a new brokerage opens its cash and one lot per position; a later buy pairs with its cash side", async () => {
    const { user, connection } = await connected(
      [{ id: "d", date: "2026-09-01", amount: "500.00", memo: "DEPOSIT" }],
      "3250.00",
      HOLDINGS
    );
    const input = {
      user: "u",
      connection,
      accountId: "chk",
      book: "b",
      account: "Assets:Fidelity",
      mode: "new" as const,
    };
    const planned = await plan(deps, input);
    expect(planned.preview).toMatchObject({ kind: "brokerage", opening: { amount: "-250.00" } });
    await planned.apply();
    expect(ledger.accountList.map((a) => a.name)).toEqual(
      expect.arrayContaining(["Assets:Fidelity:Cash", "Assets:Fidelity:VTI"])
    );
    expect(ledger.prices.at(-1)).toMatchObject({ commodity: "VTI", price: { number: "300" } });

    // The bank reports a buy: cash out, and two more shares.
    await control(`/control/users/${user}/accounts/chk/transactions`, "POST", [
      {
        id: "e",
        posted: NOW - 3600,
        transacted_at: NOW - 3600,
        amount: "-610.00",
        description: "YOU BOUGHT VTI",
        memo: "YOU BOUGHT VTI",
      },
    ]);
    await control(`/control/users/${user}/accounts/chk`, "PUT", {
      balance: "3240.00",
      holdings: [
        { ...HOLDINGS[0], shares: "12", cost_basis: "2610.00", market_value: "3600.00" },
        HOLDINGS[1],
      ],
    });
    await syncConnection(deps, deps.store.connection("u", connection.id)!);

    const buy = ledger.transactions.find((t) => t.narration === "YOU BOUGHT VTI")!;
    expect(buy.flag).toBe("!");
    expect(buy.postings.map((p) => [p.account, p.units?.number, p.units?.currency])).toEqual([
      ["Assets:Fidelity:VTI", "2", "VTI"],
      ["Assets:Fidelity:Cash", "-610.00", "USD"],
    ]);
  });
});

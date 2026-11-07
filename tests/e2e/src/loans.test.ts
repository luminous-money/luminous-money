/** Loans through the real stack: declared from the start (backfilled, the bank's copy filled in,
 * payments before the books from Opening Balances), from today (then an extra payment, an
 * escrow change and the lender's figure), its schedule following it, and a schedule read by the
 * fake AI. Dates are relative to today, since the stack stages what's due by its own today. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const CHECKING = "Assets:Bank:Checking";
const MORTGAGE = "Liabilities:Loans:Mortgage";
const INTEREST = "Expenses:Housing:Mortgage-Interest";
const ESCROW = "Assets:Escrow:Mortgage";
const OPENING = "Equity:Opening-Balances";
const usd = (number: string) => ({ number, currency: "USD" });

type User = Awaited<ReturnType<typeof newUser>>;
type Payment = {
  nominal: string;
  number: number | null;
  interest: string;
  principal: string;
  total: string;
  follows_table: boolean;
};
type Loan = {
  id: string;
  updated_at: string;
  schedule_id: string;
  others: { name: string; account: string; amount: string; from: string }[];
  rebases: { difference: string; transaction_id: string }[];
  status: {
    owed: string;
    next: Payment | null;
    ahead: Payment[];
    paid: { nominal: string; transaction_id: string }[];
  };
};
type Posting = { account: string; units: { number: string } | null };
type Transaction = { id: string; flag: string; postings: Posting[] };

/** The 1st of the month `n` months from this one (negative: before). */
function monthFrom(n: number): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
}

const send = (user: User, url: string, method = "GET", body?: unknown) =>
  fetch(url, {
    method,
    headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** A book whose checking opened a year ago with a balance. */
async function setUp() {
  const me = await newUser();
  const opened = monthFrom(-12);
  const text = `option "operating_currency" "USD"
${opened} open ${CHECKING} USD
${opened} open ${MORTGAGE} USD
${opened} open ${INTEREST}
${opened} open ${ESCROW} USD
${opened} open Expenses:Uncategorized

${opened} * "Opening"
  ${CHECKING}  50000.00 USD
  ${OPENING}
`;
  const created = await me.app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Loans", time_zone: "America/Chicago", text }),
  });
  const { id: book } = (await created.json()) as { id: string };
  const ledger = (path: string, method = "GET", body?: unknown) =>
    send(me, `${BASE_URL}/api/ledger/v1/books/${book}${path}`, method, body);
  const app = (path: string, method = "GET", body?: unknown) =>
    send(me, `${BASE_URL}/api/app/v1/books/${book}${path}`, method, body);
  const transaction = async (id: string) =>
    (await (await ledger(`/transactions/${id}`)).json()) as Transaction;
  const owed = async () => {
    const [summary] = (await (
      await ledger(`/accounts/summary?account=${encodeURIComponent(MORTGAGE)}`)
    ).json()) as { balance: { number: string }[] }[];
    return summary!.balance[0]?.number ?? "0";
  };
  return { me, book, ledger, app, transaction, owed, opened };
}

/** A $300,000 mortgage at 3.75% for 30 years, its table worked out by the server. */
const loanIn = (first: string, history: object, more: object = {}) => ({
  name: "Mortgage",
  payee: "Big Bank Mortgage",
  accounts: { liability: MORTGAGE, paying: CHECKING, interest: INTEREST, asset: null },
  table: {
    from: first,
    source: "terms",
    terms: { amount: "300000.00", rate: "3.75", payments: 360, first, payment: null },
    rate: "3.75",
    payment: "1389.35",
    rows: [],
  },
  others: [{ name: "Escrow", account: ESCROW, amount: "450.00", from: first }],
  history,
  ...more,
});

describe("Loans", () => {
  before(stackIsUp);

  it("from the start: borrowed, every payment since (escrow and all), those before the books from Opening Balances, the bank's copy filled in", async () => {
    const { app, ledger, transaction, owed, opened } = await setUp();
    // Last month's payment came in from the bank, uncategorized.
    const lastMonth = monthFrom(-1);
    const bank = await ledger("/transactions", "POST", {
      date: lastMonth.replace(/-01$/, "-02"),
      flag: "!",
      payee: "BIG BANK MTG",
      narration: "",
      postings: [
        { account: CHECKING, units: usd("-1839.35") },
        { account: "Expenses:Uncategorized", units: null },
      ],
    });
    assert.equal(bank.status, 201, await bank.clone().text());
    const { id: bankId } = (await bank.json()) as { id: string };

    const first = monthFrom(-24);
    const response = await app(
      "/loans",
      "POST",
      loanIn(first, { kind: "start", on: monthFrom(-25), against: OPENING, confirm: true })
    );
    assert.equal(response.status, 201, await response.clone().text());
    const loan = (await response.json()) as Loan;

    const paid = loan.status.paid;
    assert.ok(paid.length >= 24 && paid.length <= 25, `${paid.length} payments`);
    assert.equal(loan.status.next?.follows_table, true);
    assert.equal(loan.status.next?.number, paid.length + 1);

    // The first, before checking's books began, came from Opening Balances, escrow and all.
    const early = await transaction(paid[0]!.transaction_id);
    assert.deepEqual(
      early.postings.map((p) => [p.account, p.units?.number]),
      [
        [OPENING, "-1839.35"],
        [MORTGAGE, "451.85"],
        [INTEREST, "937.50"],
        [ESCROW, "450.00"],
      ]
    );
    // One since checking opened has escrow, from checking.
    const later = await transaction(paid.find((p) => p.nominal > opened)!.transaction_id);
    assert.deepEqual(
      later.postings.map((p) => p.account),
      [CHECKING, MORTGAGE, INTEREST, ESCROW]
    );
    // Last month's is the bank's, filled in.
    assert.equal(paid.find((p) => p.nominal === lastMonth)?.transaction_id, bankId);
    const filled = await transaction(bankId);
    assert.ok(filled.postings.some((p) => p.account === ESCROW));
    assert.ok(!filled.postings.some((p) => p.account === "Expenses:Uncategorized"));

    // What's owed is the table's, after the last payment staged.
    assert.equal(await owed(), `-${loan.status.owed}`);
  });

  it("with a match tolerance, the bank's different amount is the payment, escrow taking up the difference", async () => {
    const { app, ledger } = await setUp();
    // Last month's came in $10.65 more than the loan says: an escrow change not in the books.
    const lastMonth = monthFrom(-1);
    const bank = await ledger("/transactions", "POST", {
      date: lastMonth.replace(/-01$/, "-02"),
      flag: "!",
      payee: "BIG BANK MTG",
      narration: "",
      postings: [
        { account: CHECKING, units: usd("-1850.00") },
        { account: "Expenses:Uncategorized", units: null },
      ],
    });
    assert.equal(bank.status, 201, await bank.clone().text());
    const { id: bankId } = (await bank.json()) as { id: string };

    const response = await app(
      "/loans",
      "POST",
      loanIn(
        monthFrom(-2),
        { kind: "start", on: monthFrom(-3), against: OPENING, confirm: true },
        { tolerance: "25.00" }
      )
    );
    assert.equal(response.status, 201, await response.clone().text());
    const loan = (await response.json()) as Loan;
    assert.equal(loan.status.paid.find((p) => p.nominal === lastMonth)?.transaction_id, bankId);

    // Every other payment put 450.00 in escrow; the bank's, 460.65.
    const [summary] = (await (
      await ledger(`/accounts/summary?account=${encodeURIComponent(ESCROW)}`)
    ).json()) as { balance: { number: string }[] }[];
    const others = (loan.status.paid.length - 1) * 450;
    assert.equal(summary!.balance[0]?.number, (others + 460.65).toFixed(2));
  });

  it("from today, then an extra payment, an escrow change and the lender's figure", async () => {
    const { app, owed } = await setUp();
    const first = monthFrom(-6);
    const made = await app(
      "/loans",
      "POST",
      loanIn(first, { kind: "today", on: monthFrom(0), owed: "296000.00", against: OPENING })
    );
    assert.equal(made.status, 201, await made.clone().text());
    let loan = (await made.json()) as Loan;
    assert.equal(await owed(), "-296000.00");
    assert.deepEqual(loan.status.paid, []);
    assert.equal(loan.status.next?.nominal, monthFrom(1));
    assert.equal(loan.status.next?.follows_table, false); // the lender's figure, not the table's
    assert.equal(loan.status.next?.total, "1839.35");

    const before = loan.status.next!;
    const extra = await app(`/loans/${loan.id}/extra`, "POST", {
      date: monthFrom(0),
      amount: "10000.00",
    });
    assert.equal(extra.status, 200, await extra.clone().text());
    loan = (await extra.json()) as Loan;
    assert.equal(loan.status.owed, "286000.00");
    assert.equal(loan.status.next?.total, "1839.35");
    assert.ok(Number(loan.status.next!.interest) < Number(before.interest));

    const changed = await app(`/loans/${loan.id}`, "PATCH", {
      updated_at: loan.updated_at,
      others: [
        ...loan.others,
        { name: "Escrow", account: ESCROW, amount: "482.17", from: monthFrom(1) },
      ],
    });
    assert.equal(changed.status, 200, await changed.clone().text());
    loan = (await changed.json()) as Loan;
    assert.equal(loan.status.next?.total, "1871.52");

    const rebased = await app(`/loans/${loan.id}/rebase`, "POST", {
      updated_at: loan.updated_at,
      on: monthFrom(0),
      owed: "286012.40",
      account: "",
    });
    assert.equal(rebased.status, 200, await rebased.clone().text());
    loan = (await rebased.json()) as Loan;
    assert.equal(loan.status.owed, "286012.40");
    assert.equal(loan.rebases[0]?.difference, "12.40");

    // Its schedule is the loan's to change.
    const schedule = (await (await app(`/schedules/${loan.schedule_id}`)).json()) as {
      updated_at: string;
    };
    const edited = await app(`/schedules/${loan.schedule_id}`, "PATCH", {
      updated_at: schedule.updated_at,
      name: "Other",
    });
    assert.equal(edited.status, 422);
    assert.equal((await app(`/schedules/${loan.schedule_id}?updated_at=x`, "DELETE")).status, 422);
    assert.equal(
      (await app(`/loans/${loan.id}?updated_at=${encodeURIComponent(loan.updated_at)}`, "DELETE"))
        .status,
      204
    );
    assert.equal((await app(`/schedules/${loan.schedule_id}`)).status, 404);
  });

  it("New loan's setup: its accounts, what it bought at its cost, escrow at the lender's figure, a bill and spending, all in one request", async () => {
    const { app, ledger } = await setUp();
    const x = "123-Main-St";
    const accounts = {
      liability: `Liabilities:Loans:Mortgages:${x}`,
      interest: `Expenses:Financing:Interest:${x}`,
      asset: `Assets:Property:${x}`,
      escrow: `Assets:Escrow:${x}`,
      tax: `Expenses:Taxes:Property:${x}`,
      principal: `Expenses:Financing:Principal:${x}`,
    };
    const first = monthFrom(-3);
    const bill = {
      name: "123 Main St property tax",
      rule: {
        every: 6,
        unit: "month",
        days: [],
        start: monthFrom(4),
        until: null,
        weekend: "keep",
      },
      template: {
        payee: null,
        narration: "Property tax",
        tags: [],
        links: [],
        meta: {},
        postings: [
          { account: accounts.escrow, units: usd("-2550.00") },
          { account: accounts.tax, units: usd("2550.00") },
        ],
      },
    };
    const setup = {
      open: [
        { name: accounts.liability },
        { name: accounts.interest },
        { name: accounts.escrow },
        { name: accounts.tax },
        { name: accounts.principal },
        {
          name: accounts.asset,
          opening: { amount: "375000.00", date: monthFrom(-4) },
          revalue_every: 350,
        },
      ],
      escrow_balance: { account: accounts.escrow, amount: "1200.00", on: monthFrom(0) },
      bills: [bill],
      outflows: [{ account: accounts.liability, as: accounts.principal }],
    };
    const input = loanIn(
      first,
      { kind: "today", on: monthFrom(0), owed: "296000.00", against: OPENING },
      {
        name: "123 Main St mortgage",
        accounts: {
          liability: accounts.liability,
          paying: CHECKING,
          interest: accounts.interest,
          asset: accounts.asset,
        },
        others: [{ name: "Escrow", account: accounts.escrow, amount: "450.00", from: first }],
        setup,
      }
    );

    // Something wrong anywhere in it, and nothing's written.
    const bad = await app("/loans", "POST", {
      ...input,
      setup: { ...setup, outflows: [{ account: accounts.liability, as: "Expenses:Nope" }] },
    });
    assert.equal(bad.status, 422, await bad.clone().text());
    const chart = async () =>
      ((await (await ledger("/accounts")).json()) as { name: string }[]).map((a) => a.name);
    assert.ok(!(await chart()).includes(accounts.liability));

    const made = await app("/loans", "POST", input);
    assert.equal(made.status, 201, await made.clone().text());
    const loan = (await made.json()) as Loan & { status: { paid_from: { name: string }[] } };
    assert.equal(loan.status.owed, "296000.00");
    assert.deepEqual(
      loan.status.paid_from.map((p) => p.name),
      ["123 Main St property tax"]
    );

    const summary = (await (
      await ledger(
        `/accounts/summary?${[accounts.asset, accounts.escrow, accounts.liability].map((a) => `account=${encodeURIComponent(a)}`).join("&")}`
      )
    ).json()) as {
      name: string;
      balance: { number: string }[];
      revalue_every: number | null;
      outflow: string | null;
    }[];
    const of = (name: string) => summary.find((a) => a.name === name)!;
    assert.equal(of(accounts.asset).balance[0]?.number, "375000.00");
    assert.equal(of(accounts.asset).revalue_every, 350);
    assert.equal(of(accounts.escrow).balance[0]?.number, "1200.00");
    assert.equal(of(accounts.liability).outflow, accounts.principal);
  });

  it("refuses what doesn't fit, and a second opening for a liability that already owes", async () => {
    const { app } = await setUp();
    const first = monthFrom(-6);
    const today = { kind: "today", on: monthFrom(0), owed: "296000.00", against: OPENING };
    assert.equal((await app("/loans", "POST", { ...loanIn(first, today), name: "" })).status, 422);
    assert.equal((await app("/loans", "POST", loanIn(first, today))).status, 201);
    const again = await app("/loans", "POST", loanIn(first, today));
    assert.equal(again.status, 422);
    assert.match(((await again.json()) as { detail: string }).detail, /already says what's owed/);
  });

  it("reads a lender's schedule with the book's AI", async () => {
    const { me, book } = await setUp();
    const ai = (path: string, method = "GET", body?: unknown) =>
      send(me, `${BASE_URL}/api/ai/v1/books/${book}${path}`, method, body);
    const settings = (await (await ai("/settings")).json()) as { updated_at: string | null };
    await ai("/settings", "PATCH", {
      updated_at: settings.updated_at,
      enabled: true,
      provider: "fake",
    });

    const form = new FormData();
    form.set("file", new Blob(["%PDF-1.4 made up"], { type: "application/pdf" }), "schedule.pdf");
    const response = await fetch(`${BASE_URL}/api/app/v1/books/${book}/loans/read`, {
      method: "POST",
      headers: { authorization: `Bearer ${me.token}` },
      body: form,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const read = (await response.json()) as {
      rows: { balance: string }[];
      escrow: string | null;
      lender: string | null;
    };
    assert.equal(read.rows.length, 12);
    assert.equal(read.rows.at(-1)!.balance, "0.00");
    assert.equal(read.escrow, "100.00");
    assert.equal(read.lender, "Fake Lender");
  });

  it("outflows: a loan's principal and escrow count as spending, escrow's tax bill doesn't count again", async () => {
    const { app, ledger } = await setUp();
    const first = monthFrom(-2);
    const made = await app(
      "/loans",
      "POST",
      loanIn(first, { kind: "today", on: monthFrom(-3), owed: "300000.00", against: OPENING })
    );
    assert.equal(made.status, 201, await made.clone().text());
    // This month's tax bill, paid from escrow.
    const tax = await ledger("/accounts", "POST", {
      name: "Expenses:Housing:Property-Tax",
      kind: "leaf",
    });
    assert.equal(tax.status, 201, await tax.clone().text());
    const bill = await ledger("/transactions", "POST", {
      date: monthFrom(0),
      flag: "*",
      narration: "County tax bill",
      postings: [
        { account: ESCROW, units: usd("-600.00") },
        { account: "Expenses:Housing:Property-Tax", units: usd("600.00") },
      ],
    });
    assert.equal(bill.status, 201, await bill.clone().text());

    const spending = async (lens: string) => {
      const report = (await (
        await app(`/reports/cash-flow?on=${monthFrom(0)}&months=1${lens}`)
      ).json()) as { totals: { expenses: number } };
      return report.totals.expenses;
    };
    // As booked: this month's interest and the tax bill.
    const booked = await spending("");
    assert.equal(booked, await spending("&lens=expenses"));

    for (const [account, as_] of [
      [MORTGAGE, "Expenses:Housing:Mortgage-Principal"],
      [ESCROW, "Expenses:Housing:Mortgage-Escrow"],
    ] as const) {
      assert.equal((await ledger("/accounts", "POST", { name: as_, kind: "leaf" })).status, 201);
      const found = (await (await ledger("/accounts")).json()) as {
        name: string;
        updated_at: string;
      }[];
      const patched = await ledger(`/accounts/${account}`, "PATCH", {
        updated_at: found.find((a) => a.name === account)!.updated_at,
        outflow: as_,
      });
      assert.equal(patched.status, 200, await patched.clone().text());
    }
    // As outflows: the whole payment (principal, interest and escrow), and the tax bill masked.
    const outflows = await spending("");
    const expenses = await spending("&lens=expenses");
    assert.equal(expenses, booked);
    // This month's only spending is the payment: all of it, and the tax bill isn't counted again.
    assert.ok(Math.abs(outflows - 1839.35) < 0.01, `${outflows} vs ${booked}`);
    assert.ok(booked > 600 && booked < 1600, `${booked}`); // interest and the tax bill

    // Budgets count outflows too.
    const budget = await ledger("/budgets/Expenses:Housing", "PUT", {
      start: monthFrom(0),
      amount: "2500",
      unit: "month",
      every: 1,
      updated_at: null,
    });
    assert.equal(budget.status, 200, await budget.clone().text());
    const status = (await (await ledger(`/budgets/status?on=${monthFrom(0)}`)).json()) as {
      lines: { account: string; spent: { number: string } }[];
    };
    assert.equal(
      status.lines.find((l) => l.account === "Expenses:Housing")?.spent.number,
      "1839.35"
    );
  });
});

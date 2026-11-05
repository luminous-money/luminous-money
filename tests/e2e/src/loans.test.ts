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

  it("from the start: borrowed, every payment since, those before the books from Opening Balances, the bank's copy filled in", async () => {
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

    // The first, before checking's books began, came from Opening Balances: no escrow.
    const early = await transaction(paid[0]!.transaction_id);
    assert.deepEqual(
      early.postings.map((p) => [p.account, p.units?.number]),
      [
        [OPENING, "-1389.35"],
        [MORTGAGE, "451.85"],
        [INTEREST, "937.50"],
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
});

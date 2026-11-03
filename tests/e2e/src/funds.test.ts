/** Funds A through the real stack: Kael's four examples, the cap, moves, a rule's fund on an
 * import and a rename reaching it, and who may do what. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const PNC = "Assets:Bank:PNC";
const FIDELITY = "Assets:Fidelity:Cash";
const TEXT = `option "operating_currency" "USD"
2026-01-01 open ${PNC} USD
2026-01-01 open ${FIDELITY} USD
2026-01-01 open Expenses:Home:Maintenance
2026-01-01 open Income:Salary

2026-01-02 * "Opening"
  ${PNC}  10000.00 USD
  Equity:Opening-Balances
`;
const usd = (number: string) => ({ number, currency: "USD" });
const line = (fund: string, number: string) => ({ fund, amount: usd(number) });
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

type User = Awaited<ReturnType<typeof newUser>>;
type Fund = { name: string; value: { number: string }; entries: number; updated_at: string };
type Funds = { funds: Fund[]; net_worth: { number: string }; unallocated: { number: string } };
type Saved = {
  id: string;
  updated_at: string;
  funds: { fund: string; amount: { number: string } }[] | null;
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
  return { me, book, ...as(me, book) };
}

/** A user's calls on a book: the ledger's and the app's. */
function as(user: User, book: string) {
  const ledger = (path: string, method = "GET", body?: unknown) =>
    send(user, `${BASE_URL}/api/ledger/v1/books/${book}${path}`, method, body);
  const app = (path: string, method = "GET", body?: unknown) =>
    send(user, `${BASE_URL}/api/app/v1/books/${book}${path}`, method, body);
  const fund = async (name: string, more: object = {}) => {
    const response = await ledger("/funds", "POST", { name, ...more });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()) as Fund;
  };
  const add = async (
    from: string,
    to: string,
    amount: string,
    funds: object[],
    date = "2026-02-01"
  ) => {
    const response = await ledger("/transactions", "POST", {
      date,
      flag: "*",
      narration: `${from} to ${to}`,
      postings: [
        { account: from, units: usd(`-${amount}`) },
        { account: to, units: usd(amount) },
      ],
      funds,
    });
    return response;
  };
  const listing = async () => (await (await ledger("/funds")).json()) as Funds;
  const balances = async () =>
    Object.fromEntries((await listing()).funds.map((f) => [f.name, f.value.number]));
  return { ledger, app, fund, add, listing, balances };
}

describe("Funds A", () => {
  before(stackIsUp);

  it("Kael's four examples: a transfer for a fund, spending from one, a split paycheck, a move", async () => {
    const { fund, add, listing, balances, ledger } = await setUp();
    await fund("Emergency", { description: "Three months", target: usd("20000.00") });
    await fund("Special Home Maintenance and Repair");
    await fund("Wedding");

    // $2,000 from PNC to the brokerage, for Emergency.
    assert.equal((await add(PNC, FIDELITY, "2000.00", [line("Emergency", "2000.00")])).status, 201);
    // $500 from PNC on home maintenance, from Emergency.
    assert.equal(
      (await add(PNC, "Expenses:Home:Maintenance", "500.00", [line("Emergency", "-500.00")]))
        .status,
      201
    );
    // $1,000 of income: $500 for Emergency, $500 for Special Home Maintenance and Repair.
    const paycheck = await add("Income:Salary", PNC, "1000.00", [
      line("Emergency", "500.00"),
      line("Special Home Maintenance and Repair", "500.00"),
    ]);
    assert.equal(paycheck.status, 201);
    assert.deepEqual(
      ((await paycheck.json()) as Saved).funds?.map((l) => [l.fund, l.amount.number]),
      [
        ["Emergency", "500.00"],
        ["Special Home Maintenance and Repair", "500.00"],
      ]
    );
    // And by hand, between funds: Unallocated to Wedding.
    const moved = await ledger("/fund-moves", "POST", {
      date: "2026-02-02",
      from_fund: "Unallocated",
      to_fund: "Wedding",
      amount: usd("2500.00"),
      note: "Setting up",
    });
    assert.equal(moved.status, 201);

    assert.deepEqual(await balances(), {
      Emergency: "2000.00",
      "Special Home Maintenance and Repair": "500.00",
      Wedding: "2500.00",
    });
    const { net_worth, unallocated } = await listing();
    assert.deepEqual([net_worth.number, unallocated.number], ["10500.00", "5500.00"]);

    // In the books, as text: exports and backups carry them.
    const text = await (await ledger("/export")).text();
    assert.match(
      text,
      /funds: "Emergency \+500\.00 USD; Special Home Maintenance and Repair \+500\.00 USD"/
    );
    assert.match(text, /custom "fund-move" "Unallocated" "Wedding" 2500\.00 USD/);

    const history = (await (await ledger("/funds/Emergency/entries")).json()) as {
      entries: { amount: { number: string }; balance: { number: string } }[];
    };
    assert.deepEqual(
      history.entries.map((e) => [e.amount.number, e.balance.number]),
      [
        ["500.00", "2000.00"],
        ["-500.00", "1500.00"],
        ["2000.00", "2000.00"],
      ]
    );
  });

  it("refuses lines more than the transaction, or the wrong way, with what's wrong", async () => {
    const { fund, add } = await setUp();
    await fund("Emergency");
    const over = await add("Income:Salary", PNC, "1000.00", [line("Emergency", "1200.00")]);
    assert.equal(over.status, 422);
    assert.match(
      ((await over.json()) as { detail: string }).detail,
      /more than the 1,000\.00 USD that came in/
    );
    const wrongWay = await add(PNC, "Expenses:Home:Maintenance", "50.00", [
      line("Emergency", "50.00"),
    ]);
    assert.equal(wrongWay.status, 422);
    assert.match(
      ((await wrongWay.json()) as { detail: string }).detail,
      /comes from funds, not to them/
    );
    const unknown = await add("Income:Salary", PNC, "10.00", [line("Nope", "10.00")]);
    assert.equal(unknown.status, 422);
  });

  it("sets and clears a transaction's lines by PATCH, versioned", async () => {
    const { fund, add, ledger, balances } = await setUp();
    await fund("Emergency");
    const saved = (await (await add(PNC, FIDELITY, "300.00", [])).json()) as Saved;
    assert.equal(saved.funds, null);
    const patch = (body: object) => ledger(`/transactions/${saved.id}`, "PATCH", body);
    const set = await patch({ updated_at: saved.updated_at, funds: [line("Emergency", "300.00")] });
    assert.equal(set.status, 200);
    assert.equal((await balances()).Emergency, "300.00");
    assert.equal((await patch({ updated_at: saved.updated_at, funds: [] })).status, 409);
    const cleared = await patch({
      updated_at: ((await set.json()) as Saved).updated_at,
      funds: [],
    });
    assert.equal(cleared.status, 200);
    assert.equal((await balances()).Emergency, "0.00");
  });

  it("changes and deletes a move, and archives a fund by moving what's left", async () => {
    const { fund, ledger, balances, listing } = await setUp();
    await fund("Wedding");
    await fund("Vacation");
    const move = (await (
      await ledger("/fund-moves", "POST", {
        date: "2026-02-02",
        from_fund: "Unallocated",
        to_fund: "Wedding",
        amount: usd("100.00"),
      })
    ).json()) as { id: string; updated_at: string };
    const changed = await ledger(`/fund-moves/${move.id}`, "PATCH", {
      updated_at: move.updated_at,
      amount: usd("250.00"),
    });
    assert.equal(changed.status, 200);
    assert.equal((await balances()).Wedding, "250.00");
    assert.equal(
      (await ledger(`/fund-moves/${move.id}`, "PATCH", { updated_at: move.updated_at, note: "x" }))
        .status,
      409
    );

    const wedding = (await listing()).funds.find((f) => f.name === "Wedding")!;
    const early = await ledger("/funds/Wedding/archive", "POST", {
      updated_at: wedding.updated_at,
      date: "2026-02-01",
      to: "Vacation",
    });
    assert.equal(early.status, 422);
    const archived = await ledger("/funds/Wedding/archive", "POST", {
      updated_at: wedding.updated_at,
      date: "2026-02-03",
      to: "Vacation",
    });
    assert.equal(archived.status, 200);
    assert.deepEqual(await balances(), { Vacation: "250.00", Wedding: "0.00" });

    const { updated_at } = (await changed.json()) as { updated_at: string };
    assert.equal(
      (
        await ledger(
          `/fund-moves/${move.id}?updated_at=${encodeURIComponent(updated_at)}`,
          "DELETE"
        )
      ).status,
      204
    );
    assert.deepEqual(await balances(), { Vacation: "250.00", Wedding: "-250.00" });
  });

  it("a rule's fund on an import, and renaming the fund reaches the rule and the lines", async () => {
    const { me, book, fund, app, ledger, balances } = await setUp();
    const emergency = await fund("Emergency");
    await app(`/profiles/${encodeURIComponent(PNC)}`, "PUT", [PROFILE]);
    const rule = await app("/rules", "POST", {
      name: "Plumber",
      conditions: { account: PNC, key: null, contains: "plumb", min: null, max: null },
      account: "Expenses:Home:Maintenance",
      payee: "Plumber",
      fund: "emergency",
      auto_confirm: false,
    });
    assert.equal(rule.status, 201, await rule.clone().text());
    const { id: ruleId } = (await rule.json()) as { id: string };

    const form = new FormData();
    form.set("account", PNC);
    form.set(
      "file",
      new Blob(["Date,Description,Amount\n03/05/2026,ACE PLUMBING,-180.00\n"]),
      "f.csv"
    );
    const imported = (await (
      await me.app(`/books/${book}/imports`, { method: "POST", body: form })
    ).json()) as { rows: { transaction_id: string }[] };
    const staged = (await (
      await ledger(`/transactions/${imported.rows[0]!.transaction_id}`)
    ).json()) as Saved;
    // The whole amount, from the fund (money out), named as the fund is.
    assert.deepEqual(
      staged.funds?.map((l) => [l.fund, l.amount.number]),
      [["Emergency", "-180.00"]]
    );
    assert.equal((await balances()).Emergency, "-180.00");

    const renamed = await app("/funds/Emergency/rename", "POST", {
      to: "Rainy Day",
      updated_at: emergency.updated_at,
    });
    assert.equal(renamed.status, 200, await renamed.clone().text());
    const after = (await (await app(`/rules/${ruleId}`)).json()) as { fund: string | null };
    assert.equal(after.fund, "Rainy Day");
    const text = await (await ledger("/export")).text();
    assert.match(text, /funds: "Rainy Day -180\.00 USD"/);
    assert.doesNotMatch(text, /Emergency/);
  });

  it("a writer tags transactions and moves money; only a manager sets funds up", async () => {
    const { me, book, fund, add } = await setUp();
    await fund("Emergency");
    const writer = await newUser();
    const invite = (await (
      await me.app(`/books/${book}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "write", email: writer.email, label: "Writer" }),
      })
    ).json()) as { token: string };
    assert.equal(
      (await writer.app(`/invites/${invite.token}/accept`, { method: "POST" })).status,
      200
    );
    const theirs = as(writer, book);

    assert.equal(
      (await theirs.add(PNC, FIDELITY, "100.00", [line("Emergency", "100.00")])).status,
      201
    );
    const moved = await theirs.ledger("/fund-moves", "POST", {
      date: "2026-02-02",
      from_fund: "Emergency",
      to_fund: "Unallocated",
      amount: usd("40.00"),
    });
    assert.equal(moved.status, 201);
    assert.equal((await theirs.balances()).Emergency, "60.00");

    assert.equal((await theirs.ledger("/funds", "POST", { name: "Mine now" })).status, 403);
    const emergency = (await theirs.listing()).funds[0]!;
    assert.equal(
      (
        await theirs.ledger("/funds/Emergency", "PATCH", {
          updated_at: emergency.updated_at,
          description: "x",
        })
      ).status,
      403
    );
    assert.equal(
      (
        await theirs.app("/funds/Emergency/rename", "POST", {
          to: "Ours",
          updated_at: emergency.updated_at,
        })
      ).status,
      403
    );
    // The owner's own transaction can still be written as before.
    assert.equal((await add(PNC, FIDELITY, "1.00", [])).status, 201);
  });
});

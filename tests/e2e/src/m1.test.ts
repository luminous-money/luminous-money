/** M1 and M2 through the real stack: sessions, owned books, accounts with opening balances and
 * stars, ledgers and CSV imports. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

async function withAccount() {
  const user = await newUser();
  const { data: book } = await user.ledger.POST("/api/ledger/v1/books", { body: { name: "Mine" } });
  const { data: account } = await user.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book!.id } },
    body: {
      name: "Assets:Bank:PNC-Checking",
      kind: "leaf",
      opening_balance: { amount: "1000.00", currency: "USD", date: "2024-01-01" },
    },
  });
  return { user, book: book!, account: account! };
}

describe("sessions", () => {
  before(stackIsUp);

  it("log in with HttpOnly cookies, and log out", async () => {
    const user = await newUser();
    const response = await fetch(`${BASE_URL}/api/auth/v1/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email }),
    });
    const [access, refresh] = response.headers.getSetCookie();

    assert.match(access ?? "", /^fb_access=.*HttpOnly.*SameSite=Strict/i);
    assert.match(refresh ?? "", /^fb_refresh=.*Path=\/api\/auth\/v1\/token.*HttpOnly/i);
    const cookie = [access, refresh].map((c) => c!.split(";")[0]).join("; ");
    const me = await fetch(`${BASE_URL}/api/auth/v1/me`, { headers: { cookie } });
    assert.equal(((await me.json()) as { id: string }).id, user.id);
    const out = await fetch(`${BASE_URL}/api/auth/v1/token/revoke`, {
      method: "POST",
      headers: { cookie },
    });
    assert.match(out.headers.getSetCookie().join(), /Max-Age=0/);
    const after = await fetch(`${BASE_URL}/api/ledger/v1/books`, { headers: { cookie } });
    assert.equal(after.status, 401);
  });
});

describe("books belong to their users", () => {
  before(stackIsUp);

  it("are created by name, renamed with versions, and invisible to anyone else", async () => {
    const me = await newUser();
    const other = await newUser();
    const { data: book } = await me.ledger.POST("/api/ledger/v1/books", {
      body: { name: "Kael Personal" },
    });

    const renamed = await me.ledger.PATCH("/api/ledger/v1/books/{book_id}", {
      params: { path: { book_id: book!.id } },
      body: { name: "Kael (personal)", updated_at: book!.updated_at },
    });
    const stale = await me.ledger.PATCH("/api/ledger/v1/books/{book_id}", {
      params: { path: { book_id: book!.id } },
      body: { name: "Nope", updated_at: book!.updated_at },
    });
    const theirs = await other.ledger.GET("/api/ledger/v1/books/{book_id}", {
      params: { path: { book_id: book!.id } },
    });
    const { data: their_books } = await other.ledger.GET("/api/ledger/v1/books");

    assert.equal(renamed.data?.name, "Kael (personal)");
    assert.equal(stale.response.status, 409);
    assert.equal(theirs.response.status, 404);
    assert.deepEqual(their_books, []);
  });
});

describe("accounts, stars and ledgers", () => {
  before(stackIsUp);

  it("open with an opening balance, summarize with balances, and page their ledgers", async () => {
    const { user, book, account } = await withAccount();

    const { data: listed } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/accounts/summary",
      { params: { path: { book_id: book.id }, query: { account: [account.name] } } }
    );
    const { data: page } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/accounts/{account}/ledger",
      {
        params: { path: { book_id: book.id, account: account.name } },
      }
    );

    assert.equal(account.name, "Assets:Bank:PNC-Checking");
    assert.deepEqual(
      listed?.map((a) => [a.name, a.as_of, a.balance]),
      [[account.name, "2024-01-01", [{ number: "1000.00", currency: "USD" }]]]
    );
    assert.deepEqual(
      page?.rows.map((r) => [r.narration, r.counterpart, r.balance?.number]),
      [["Opening balance", "Equity:Opening-Balances", "1000.00"]]
    );
  });
});

describe("stars", () => {
  before(stackIsUp);

  it("are each user's own, and set and cleared by account", async () => {
    const { user, book, account } = await withAccount();
    const path = `/books/${book.id}/stars/${encodeURIComponent(account.name)}`;

    assert.deepEqual(await (await user.app(path, { method: "PUT" })).json(), [account.name]);
    assert.deepEqual(await (await user.app(`/books/${book.id}/stars`)).json(), [account.name]);
    assert.equal((await (await newUser()).app(`/books/${book.id}/stars`)).status, 404);
    assert.deepEqual(await (await user.app(path, { method: "DELETE" })).json(), []);
  });
});

const CSV = `Date,Description,Amount
03/01/2024,CORNER CAFE,-4.50
03/02/2024,ACME PAYROLL,2000.00
`;

describe("importing CSVs", () => {
  before(stackIsUp);

  const upload = (
    user: Awaited<ReturnType<typeof newUser>>,
    book: string,
    account: string,
    text = CSV
  ) => {
    const form = new FormData();
    form.set("account", account);
    form.set("file", new Blob([text], { type: "text/csv" }), "march.csv");
    return user.app(`/books/${book}/imports`, { method: "POST", body: form });
  };

  const saveProfile = (user: Awaited<ReturnType<typeof newUser>>, book: string, account: string) =>
    user.app(`/books/${book}/profiles/${encodeURIComponent(account)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
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
      ]),
    });

  it("needs a profile first, then matches what's already there, stages the rest, and skips duplicates", async () => {
    const { user, book, account } = await withAccount();
    const { data: manual } = await user.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book.id } },
      body: {
        date: "2024-03-02",
        flag: "*",
        narration: "Coffee, entered by hand",
        postings: [
          { account: account.name, units: { number: "-4.50", currency: "USD" } },
          { account: "Equity:Opening-Balances" },
        ],
      },
    });

    const first = await upload(user, book.id, account.name);
    assert.equal(first.status, 409);
    assert.equal(((await first.json()) as { code: string }).code, "no-profile");

    assert.equal((await saveProfile(user, book.id, account.name)).status, 200);

    const imported = (await (await upload(user, book.id, account.name)).json()) as {
      batch: { staged: number; matched: number };
      rows: {
        description: string;
        outcome: string;
        transaction_id: string;
        match: string | null;
        candidates: { transaction_id: string; days: number }[];
      }[];
    };
    assert.deepEqual([imported.batch.staged, imported.batch.matched], [1, 1]);
    const cafe = imported.rows.find((r) => r.description === "CORNER CAFE")!;
    assert.deepEqual(
      [cafe.outcome, cafe.transaction_id, cafe.match],
      ["matched", manual!.id, "proposed"]
    );
    assert.deepEqual(
      cafe.candidates.map((c) => [c.transaction_id, c.days]),
      [[manual!.id, 1]]
    );

    const again = (await (await upload(user, book.id, account.name)).json()) as {
      batch: { staged: number; duplicates: number };
    };
    assert.deepEqual([again.batch.staged, again.batch.duplicates], [0, 2]);

    const latest = (await (await user.app(`/books/${book.id}/imports/latest`)).json()) as Record<
      string,
      string
    >;
    assert.ok(latest[account.name]);
    const { data: staged } = await user.ledger.GET("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book.id }, query: { flag: "!" } },
    });
    assert.deepEqual(
      staged?.map((t) => t.postings[1]?.account),
      ["Income:Uncategorized"] // the coffee matched the one entered by hand: nothing added
    );
  });

  it("skips rows up to the opening balance, and starts earlier once it's moved back", async () => {
    const { user, book, account } = await withAccount();
    await saveProfile(user, book.id, account.name);
    const older = `Date,Description,Amount\n12/30/2023,OLD COFFEE,-3.00\n01/01/2024,NEW YEAR,-1.00\n`;
    const outcomes = async () =>
      (
        (await (await upload(user, book.id, account.name, older)).json()) as {
          rows: { outcome: string }[];
        }
      ).rows.map((r) => r.outcome);

    assert.deepEqual(await outcomes(), ["before-opening", "before-opening"]);

    const { data: transactions } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions",
      { params: { path: { book_id: book.id } } }
    );
    const opening = transactions!.find((t) => t.narration === "Opening balance")!;
    const moved = await user.ledger.PATCH(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      {
        params: { path: { book_id: book.id, directive_id: opening.id } },
        body: { date: "2023-12-01", updated_at: opening.updated_at },
      }
    );
    assert.equal(moved.response.status, 200);
    const { data: summary } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/accounts/summary",
      { params: { path: { book_id: book.id }, query: { account: [account.name] } } }
    );
    assert.deepEqual([summary![0]!.open, summary![0]!.as_of], ["2023-12-01", "2023-12-01"]);

    assert.deepEqual(await outcomes(), ["staged", "staged"]);
    const { data: problems } = await user.ledger.GET("/api/ledger/v1/books/{book_id}/problems", {
      params: { path: { book_id: book.id } },
    });
    assert.deepEqual(problems, []);
  });

  it("answers 404 for someone else's book", async () => {
    const { book, account } = await withAccount();
    const other = await newUser();

    assert.equal((await upload(other, book.id, account.name)).status, 404);
    assert.equal((await other.app(`/books/${book.id}/imports/latest`)).status, 404);
  });
});

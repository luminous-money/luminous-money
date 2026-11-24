import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { newUser, stackIsUp } from "./support.ts";

const FAKE = process.env.SIMPLEFIN_FAKE_URL ?? "http://simplefin-fake:8080";
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

async function fake(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${FAKE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

/** A bank at the fake, with one checking account and a few posted transactions. */
async function bank(balance = "1900.00") {
  const { user, setup_token } = (await fake("/control/users", "POST")) as {
    user: string;
    setup_token: string;
  };
  await fake(`/control/users/${user}/accounts/chk`, "PUT", {
    name: "Everyday Checking",
    institution: "Fake Bank",
    balance,
  });
  await fake(`/control/users/${user}/accounts/chk/transactions`, "POST", [
    {
      id: "t1",
      posted: NOW - 40 * DAY,
      amount: "-25.00",
      description: "Coffee",
      memo: "POS CORNER CAFE",
      payee: "Corner Cafe",
    },
    {
      id: "t2",
      posted: NOW - 20 * DAY,
      amount: "1000.00",
      description: "Payroll",
      memo: "ACME PAYROLL",
      payee: "Acme",
    },
    {
      id: "t3",
      posted: NOW - 2 * DAY,
      amount: "-75.00",
      description: "Groceries",
      memo: "GREEN GROCER 0042",
      payee: "Green Grocer",
    },
  ]);
  return { user, setup_token };
}

/** A user with a book, and the app API as them. */
async function setUp() {
  const me = await newUser();
  const created = await me.app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mine", time_zone: "America/Chicago" }),
  });
  const { id: book } = (await created.json()) as { id: string };
  const post = (path: string, body: unknown) =>
    me.app(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { me, book, post };
}

type Connection = {
  id: string;
  host: string;
  mine: boolean;
  owner: string | null;
  share: { all: boolean; accounts: string[]; updated_at: string } | null;
  errors: { code: string; explained: string }[];
  accounts: {
    account_id: string;
    shared?: boolean;
    link: { book_id: string; book_name: string | null; account: string } | null;
  }[];
};

type Me = Awaited<ReturnType<typeof newUser>>;

const send = (me: Me, path: string, method: string, body?: unknown) =>
  me.app(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Share a connection with a book (all its accounts, unless some are given). */
async function share(me: Me, book: string, connection: string, accounts?: string[]) {
  const shared = await send(me, `/books/${book}/simplefin/connections/${connection}/share`, "PUT", {
    all: !accounts,
    accounts: accounts ?? [],
    updated_at: null,
  });
  assert.equal(shared.status, 200);
  return (await shared.json()) as Connection;
}

/** The connections a book sees, as `me`. */
const seen = async (me: Me, book: string) =>
  (await (await me.app(`/books/${book}/simplefin/connections`)).json()) as Connection[];

describe("M9: bank feeds (SimpleFIN)", () => {
  before(stackIsUp);

  it("connects with a setup token, never shows the access URL, and refuses other servers", async () => {
    const { post } = await setUp();
    const { setup_token } = await bank();

    const connected = await post("/simplefin/connections", { setup_token });
    const text = await connected.text();
    assert.equal(connected.status, 201);
    const connection = JSON.parse(text) as Connection;
    assert.equal(connection.host, "simplefin-fake:8080");
    assert.deepEqual(
      connection.accounts.map((a) => a.account_id),
      ["chk"]
    );
    assert.doesNotMatch(text, /@simplefin-fake/);

    const again = await post("/simplefin/connections", { setup_token });
    assert.equal(again.status, 403);
    const elsewhere = Buffer.from("http://ledger:8000/api/ledger/v1/books").toString("base64");
    const refused = await post("/simplefin/connections", { setup_token: elsewhere });
    assert.equal(refused.status, 422);
  });

  it("links a new account that opens at the bank's balance, imports its history, and syncs without duplicates", async () => {
    const { me, book, post } = await setUp();
    const { setup_token } = await bank("1900.00");
    const connection = (await (
      await post("/simplefin/connections", { setup_token })
    ).json()) as Connection;
    await share(me, book, connection.id);
    const link = {
      connection_id: connection.id,
      account_id: "chk",
      account: "Assets:Bank:Checking",
      mode: "new",
    };

    const preview = (await (await post(`/books/${book}/simplefin/links/preview`, link)).json()) as {
      added: number;
      opening: { amount: string };
    };
    assert.equal(preview.added, 3);
    assert.equal(preview.opening.amount, "1000.00");
    assert.equal((await post(`/books/${book}/simplefin/links`, link)).status, 201);

    const [summary] = (await (
      await me.ledger.GET("/api/ledger/v1/books/{book_id}/accounts/summary", {
        params: { path: { book_id: book }, query: { account: ["Assets:Bank:Checking"] } },
      })
    ).data)!;
    assert.deepEqual(summary!.balance, [{ number: "1900.00", currency: "USD" }]);
    const status = (await (await me.app(`/books/${book}/simplefin/status`)).json()) as Record<
      string,
      { reported: { balance: string } }
    >;
    assert.equal(status["Assets:Bank:Checking"]!.reported.balance, "1900.00");

    const synced = (await (
      await post(`/simplefin/connections/${connection.id}/sync`, {})
    ).json()) as {
      staged: number;
    };
    assert.equal(synced.staged, 0);
  });

  it("reconciles an account with history: matches confirmed, the rest unconfirmed, the bank's balance kept", async () => {
    const { me, book, post } = await setUp();
    const account = "Assets:Bank:Checking";
    await me.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book } },
      body: {
        name: account,
        kind: "leaf",
        opening_balance: { amount: "500.00", currency: "USD", date: "2020-01-01" },
      },
    });
    await me.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
      params: { path: { book_id: book } },
      body: { name: "Expenses:Food", kind: "leaf" },
    });
    const day = (offset: number) =>
      new Date((NOW + offset * DAY) * 1000).toISOString().slice(0, 10);
    const write = async (date: string, amount: string, narration: string) =>
      (
        await me.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
          params: { path: { book_id: book } },
          body: {
            date,
            flag: "*",
            narration,
            postings: [
              { account, units: { number: amount, currency: "USD" } },
              { account: "Expenses:Food" },
            ],
          },
        })
      ).data!;
    const coffee = await write(day(-40), "-25.00", "my coffee");
    const stray = await write(day(-10), "-12.00", "not at the bank");
    const { setup_token } = await bank("1900.00");
    const connection = (await (
      await post("/simplefin/connections", { setup_token })
    ).json()) as Connection;
    await share(me, book, connection.id);
    const link = { connection_id: connection.id, account_id: "chk", account, mode: "reconcile" };

    const preview = (await (await post(`/books/${book}/simplefin/links/preview`, link)).json()) as {
      matched: number;
      added: number;
      not_at_bank: number;
    };
    assert.deepEqual([preview.matched, preview.added, preview.not_at_bank], [1, 2, 1]);
    assert.equal((await post(`/books/${book}/simplefin/links`, link)).status, 201);

    const get = async (id: string) =>
      (
        await me.ledger.GET("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
          params: { path: { book_id: book, directive_id: id } },
        })
      ).data!;
    assert.equal((await get(coffee.id)).flag, "*");
    assert.equal((await get(coffee.id)).narration, "my coffee");
    assert.equal((await get(stray.id)).flag, "!");
    const [summary] = (
      await me.ledger.GET("/api/ledger/v1/books/{book_id}/accounts/summary", {
        params: { path: { book_id: book }, query: { account: [account] } },
      })
    ).data!;
    // The bank's balance, plus the stray it doesn't know about.
    assert.deepEqual(summary!.balance, [{ number: "1888.00", currency: "USD" }]);
    const status = (await (await me.app(`/books/${book}/simplefin/status`)).json()) as Record<
      string,
      { not_at_bank: string[] }
    >;
    assert.deepEqual(status[account]!.not_at_bank, [stray.id]);
  });

  it("shows the bank's errors in plain words", async () => {
    const { me, post } = await setUp();
    const { user, setup_token } = await bank();
    const connection = (await (
      await post("/simplefin/connections", { setup_token })
    ).json()) as Connection;
    await fake(`/control/users/${user}/errors`, "PUT", {
      shape: "v2",
      errors: [{ code: "con.auth", msg: "Fake Bank needs you to log in" }],
    });

    await post(`/simplefin/connections/${connection.id}/sync`, {});

    const [listed] = (await (await me.app("/simplefin/connections")).json()) as Connection[];
    assert.equal(listed!.errors[0]!.code, "con.auth");
    assert.match(listed!.errors[0]!.explained, /log in again at SimpleFIN Bridge/);
  });

  it("shares a connection with a book: what its owner chooses, linked and synced by its writers, gone when they leave", async () => {
    // Jess's book, Kael a writer in it; Kael's own book beside it.
    const jess = await newUser();
    const kael = await newUser();
    const book = async (me: Me, name: string) =>
      (
        (await (
          await send(me, "/books", "POST", { name, time_zone: "America/Chicago" })
        ).json()) as { id: string }
      ).id;
    const home = await book(jess, "Home");
    const personal = await book(kael, "Personal");
    const invite = (await (
      await send(jess, `/books/${home}/invites`, "POST", { role: "write", email: kael.email })
    ).json()) as { token: string };
    assert.equal((await send(kael, `/invites/${invite.token}/accept`, "POST")).status, 200);

    // Kael's bank: a joint checking account and a card of his own.
    const { user, setup_token } = await bank();
    await fake(`/control/users/${user}/accounts/card`, "PUT", {
      name: "Kael's Card",
      institution: "Fake Card Co",
      balance: "-10.00",
    });
    const connection = (await (
      await send(kael, "/simplefin/connections", "POST", { setup_token })
    ).json()) as Connection;
    assert.deepEqual(connection.accounts.map((a) => a.account_id).sort(), ["card", "chk"]);

    // Not shared yet: Kael sees it (to share), Jess doesn't, and nobody can link it.
    const [unshared] = await seen(kael, home);
    assert.deepEqual([unshared!.mine, unshared!.share], [true, null]);
    assert.equal((await seen(jess, home)).length, 0);
    const linkTo = (account_id: string, account: string) => ({
      connection_id: connection.id,
      account_id,
      account,
      mode: "new",
    });
    const joint = linkTo("chk", "Assets:Bank:Joint");
    assert.equal((await send(jess, `/books/${home}/simplefin/links`, "POST", joint)).status, 404);

    // Shared with Home: only the joint account. Only Kael chooses what.
    await share(kael, home, connection.id, ["chk"]);
    const refused = await send(
      jess,
      `/books/${home}/simplefin/connections/${connection.id}/share`,
      "PUT",
      {
        all: true,
        accounts: [],
        updated_at: null,
      }
    );
    assert.equal(refused.status, 403);
    const [theirs] = await seen(jess, home);
    assert.equal(theirs!.mine, false);
    assert.deepEqual(
      theirs!.accounts.map((a) => a.account_id),
      ["chk"]
    );

    // Jess links the joint account; the card isn't Home's to link.
    const card = linkTo("card", "Liabilities:Card");
    assert.equal((await send(jess, `/books/${home}/simplefin/links`, "POST", card)).status, 422);
    assert.equal((await send(jess, `/books/${home}/simplefin/links`, "POST", joint)).status, 201);
    const synced = await send(
      jess,
      `/books/${home}/simplefin/connections/${connection.id}/sync`,
      "POST",
      {}
    );
    assert.equal(synced.status, 200);

    // What's linked stays shared: unlink it first.
    const [mine] = await seen(kael, home);
    const narrowed = await send(
      kael,
      `/books/${home}/simplefin/connections/${connection.id}/share`,
      "PUT",
      {
        all: false,
        accounts: [],
        updated_at: mine!.share!.updated_at,
      }
    );
    assert.equal(narrowed.status, 422);
    const stale = await send(
      kael,
      `/books/${home}/simplefin/connections/${connection.id}/share`,
      "PUT",
      {
        all: false,
        accounts: ["chk"],
        updated_at: "2020-01-01T00:00:00.000000Z",
      }
    );
    assert.equal(stale.status, 409);

    // In Kael's own book, all its accounts: the joint one says where it's linked.
    const everything = await share(kael, personal, connection.id);
    assert.deepEqual(everything.share && everything.share.all, true);
    const where = everything.accounts.find((a) => a.account_id === "chk")!.link!;
    assert.deepEqual([where.book_id, where.book_name], [home, "Home"]);
    assert.equal(
      (await send(kael, `/books/${personal}/simplefin/links`, "POST", card)).status,
      201
    );

    // Jess takes Kael out of Home: his connection, and the link Jess made on it, go with him.
    const members = (await (await jess.app(`/books/${home}/members`)).json()) as {
      members: { user_id: string }[];
    };
    assert.ok(members.members.some((m) => m.user_id === kael.id));
    assert.equal((await send(jess, `/books/${home}/members/${kael.id}`, "DELETE")).status, 204);
    assert.equal((await seen(jess, home)).length, 0);
    const status = (await (await jess.app(`/books/${home}/simplefin/status`)).json()) as object;
    assert.deepEqual(Object.keys(status), []);
    // His own book keeps its link.
    const left = (await (await kael.app(`/books/${personal}/simplefin/status`)).json()) as object;
    assert.deepEqual(Object.keys(left), ["Liabilities:Card"]);
  });
});

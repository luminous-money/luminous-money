import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AppDb } from "./db.js";
import { bankNotifications, needsFund, notifications } from "./notifications.js";
import { parseAccountSet, type SfAccount } from "./simplefin/client.js";
import { SimplefinStore } from "./simplefin/store.js";
import { FakeLedger } from "./testing.js";

const sale = (id: string, added: string) => ({
  id,
  date: "2026-11-04",
  flag: "!",
  payee: "Fidelity",
  narration: "Sold 20 VTI",
  added,
  updated_at: added,
  takes: [
    {
      fund: "Unallocated",
      amount: { number: "20", currency: "VTI" },
      holding: { number: "-20", currency: "VTI" },
    },
  ],
});

describe("notifications (Funds B)", () => {
  it("words a sale that needs a fund, which goes only once it's fixed", () => {
    expect(needsFund(sale("t1", "2026-11-04T06:00:00.000000Z"))).toEqual({
      id: "needs-fund:t1",
      kind: "needs-fund",
      added: "2026-11-04T06:00:00.000000Z",
      dismissable: false,
      title: "A sale needs a fund",
      detail:
        "Fidelity takes 20 VTI from Unallocated, which is 20 VTI short. Say which fund's shares they are.",
      transaction_id: "t1",
      date: "2026-11-04",
    });
  });

  it("lists the queue oldest first, read from the ledger each time", async () => {
    const ledger = new FakeLedger();
    ledger.shortList = [
      sale("later", "2026-11-05T06:00:00Z"),
      sale("first", "2026-11-04T06:00:00Z"),
    ];
    expect((await notifications(ledger, "b")).map((n) => n.transaction_id)).toEqual([
      "first",
      "later",
    ]);
    ledger.shortList = [];
    expect(await notifications(ledger, "b")).toEqual([]);
  });
});

describe("a bank feed's problems", () => {
  const account = (id: string, institution: string): SfAccount => ({
    id,
    name: id,
    currency: "USD",
    balance: "1.00",
    available_balance: null,
    balance_date: 1,
    institution,
    transactions: [],
    holdings: [],
  });
  const PLAIN = "Connection to Fake 529 Plan may need attention. Auth required";

  function linked() {
    const db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
    const store = new SimplefinStore(db.db);
    const connection = store.addConnection("u", "sealed", "bridge.test", 400);
    store.saveFetch(connection.id, [account("plan", "Fake 529 Plan"), account("chk", "Fake Bank")]);
    for (const [account_id, name] of [
      ["plan", "Assets:College:Plan"],
      ["chk", "Assets:Bank:Checking"],
    ] as const)
      store.addLink({
        user_id: "u",
        connection_id: connection.id,
        account_id,
        book_id: "b",
        account: name,
        kind: "cash",
        starts_on: "2026-01-01",
      });
    store.putShare(connection.id, "b", { all: false, accounts: ["plan", "chk"] }, null);
    // Plain strings, and coded errors (the protocol's `errlist`).
    const sync = (errors: string[], errlist: unknown[] = []) =>
      store.recordSync(connection.id, [
        ...parseAccountSet({ errors, accounts: [] }).errors,
        ...(errlist.length ? parseAccountSet({ errlist, accounts: [] }).errors : []),
      ]);
    return { db, store, sync, connection };
  }

  it("are in the bell, the connection's or the account they name, for as long as syncs report them", () => {
    const { store, sync, connection } = linked();
    sync(
      [PLAIN, "Requested date range exceeds recommended range of 45 days."],
      [{ code: "con.auth", msg: "log in", account_id: "plan" }]
    );

    const [plain, own, ...rest] = bankNotifications(store, "b", "u");
    expect(rest).toEqual([]); // the Bridge's notice isn't one
    expect(plain).toMatchObject({
      kind: "bank-feed",
      dismissable: true,
      title: `SimpleFIN ${connection.id.slice(0, 8)} needs attention`,
      detail: PLAIN,
      accounts: [],
      href: `/books/b/connections?connection=${connection.id}`,
      external: { label: "Open SimpleFIN Bridge", url: "https://bridge.simplefin.org/" },
    });
    expect(own).toMatchObject({
      title: "Fake 529 Plan wants you to log in again",
      detail: "Your bank wants you to log in again at SimpleFIN Bridge.",
      accounts: ["Assets:College:Plan"],
    });

    sync([PLAIN]);
    expect(bankNotifications(store, "b", "u").map((n) => n.id)).toEqual([plain!.id]); // still it
    sync([]);
    expect(bankNotifications(store, "b", "u")).toEqual([]);
    sync([PLAIN]);
    expect(bankNotifications(store, "b", "u")[0]!.id).not.toBe(plain!.id); // back: a new one
  });

  it("are dismissed by each person for themselves", () => {
    const { db, store, sync } = linked();
    sync([PLAIN]);
    const [plain] = bankNotifications(store, "b", "u");

    db.dismiss("u", "b", plain!.id);
    db.dismiss("u", "b", plain!.id); // again: no matter

    expect([...db.dismissed("u", "b")]).toEqual([plain!.id]);
    expect([...db.dismissed("someone-else", "b")]).toEqual([]);
  });

  it("go only where they're about, for anyone but the connection's owner", () => {
    const { store, sync, connection } = linked();
    store.saveFetch(connection.id, [account("ira", "Fake Brokerage")]);
    sync(
      [PLAIN],
      [
        { code: "con.auth", msg: "log in", account_id: "plan" },
        { code: "con.auth", msg: "log in", account_id: "ira" },
      ]
    );
    const titles = (viewer: string) => bankNotifications(store, "b", viewer).map((n) => n.title);

    // Its owner: the connection's own, and the shared account's; not the unshared one's.
    expect(titles("u")).toEqual([
      `SimpleFIN ${connection.id.slice(0, 8)} needs attention`,
      "Fake 529 Plan wants you to log in again",
    ]);
    // Anyone else: only the shared account's, while it isn't shared with all its accounts.
    expect(titles("jess")).toEqual(["Fake 529 Plan wants you to log in again"]);
    const share = store.share(connection.id, "b")!;
    store.putShare(connection.id, "b", { all: true, accounts: [] }, share.updated_at);
    expect(titles("jess")).toEqual([
      `SimpleFIN ${connection.id.slice(0, 8)} needs attention`,
      "Fake 529 Plan wants you to log in again",
      "Fake Brokerage wants you to log in again",
    ]);
    // A book it isn't shared with hears nothing of it.
    expect(bankNotifications(store, "other", "u")).toEqual([]);
  });

  it("say a new account turned up under all its accounts, until it's linked", () => {
    const { store, connection } = linked();
    const shared = (all: boolean) => {
      const share = store.share(connection.id, "b");
      store.putShare(
        connection.id,
        "b",
        { all, accounts: ["plan", "chk"] },
        share?.updated_at ?? null
      );
    };
    shared(true);
    store.saveFetch(connection.id, [account("new", "Fake Credit Union")]);
    const news = () =>
      bankNotifications(store, "b", "jess").filter((n) => n.kind === "bank-account");

    expect(news()).toMatchObject([
      {
        id: `bank-account:${connection.id}:new`,
        dismissable: true,
        title: "New at SimpleFIN: Fake Credit Union new",
        href: `/books/b/connections?connection=${connection.id}`,
      },
    ]);
    shared(false); // only those chosen: nothing new comes to the book
    expect(news()).toEqual([]);
    shared(true); // chosen again: what's there by then isn't new
    expect(news()).toEqual([]);
    store.saveFetch(connection.id, [account("newer", "Fake Credit Union")]);
    expect(news().map((n) => n.id)).toEqual([`bank-account:${connection.id}:newer`]);
    store.addLink({
      user_id: "jess",
      connection_id: connection.id,
      account_id: "newer",
      book_id: "b",
      account: "Liabilities:Card",
      kind: "cash",
      starts_on: "2026-01-01",
    });
    expect(news()).toEqual([]); // linked
  });
});

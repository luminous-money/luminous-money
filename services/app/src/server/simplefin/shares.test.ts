import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate, now, open } from "@luminous-money/db";
import { describe, expect, it } from "vitest";

import { AppDb, MIGRATIONS } from "../db.js";
import { covers, errorsIn, SimplefinStore, StaleShare, type Link } from "./store.js";

const fresh = () => new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));

const link = (
  store: SimplefinStore,
  l: Pick<Link, "user_id" | "connection_id" | "account_id" | "book_id" | "account">
) => store.addLink({ ...l, kind: "cash", starts_on: "2026-01-01" });

describe("sharing a connection with a book (shared connections)", () => {
  it("shares all its accounts or those chosen, against the version read", () => {
    const store = new SimplefinStore(fresh().db);
    const c = store.addConnection("kael", "sealed", "bridge.test", 400);

    const first = store.putShare(c.id, "home", { all: false, accounts: ["b", "a", "a"] }, null);
    expect(first).toMatchObject({ all: false, accounts: ["a", "b"] });
    expect(covers(first, "a")).toBe(true);
    expect(covers(first, "c")).toBe(false);
    expect(() => store.putShare(c.id, "home", { all: true, accounts: [] }, null)).toThrow(
      StaleShare
    );

    const all = store.putShare(c.id, "home", { all: true, accounts: ["a"] }, first.updated_at);
    expect(all).toMatchObject({ all: true, accounts: [] });
    expect(covers(all, "anything")).toBe(true);
    expect(store.sharesIn("home").map((s) => s.connection_id)).toEqual([c.id]);
    expect(store.sharesOf(c.id).map((s) => s.book_id)).toEqual(["home"]);

    expect(() => store.deleteShare(c.id, "home", first.updated_at)).toThrow(StaleShare);
    store.deleteShare(c.id, "home", all.updated_at);
    expect(store.share(c.id, "home")).toBeUndefined();
  });

  it("goes with its connection", () => {
    const store = new SimplefinStore(fresh().db);
    const c = store.addConnection("kael", "sealed", "bridge.test", 400);
    store.putShare(c.id, "home", { all: true, accounts: [] }, null);
    store.deleteConnection("kael", c.id);
    expect(store.sharesIn("home")).toEqual([]);
  });

  it("shows someone else only the problems about what's shared with them", () => {
    const store = new SimplefinStore(fresh().db);
    const c = store.addConnection("kael", "sealed", "bridge.test", 400);
    store.recordSync(c.id, [
      { code: "gen", message: "Connection to Example Bank may need attention" },
      { code: "con.auth", message: "log in", account_id: "joint" },
      { code: "con.auth", message: "log in", account_id: "mine" },
    ]);
    const connection = store.connectionById(c.id)!;
    const some = store.putShare(c.id, "home", { all: false, accounts: ["joint"] }, null);
    const said = (viewer: string, share = some) =>
      errorsIn(connection, share, viewer).map((e) => e.account_id ?? "connection");

    expect(said("jess")).toEqual(["joint"]);
    expect(said("kael")).toEqual(["connection", "joint"]);
    expect(said("jess", { ...some, all: true })).toEqual(["connection", "joint", "mine"]);
    expect(errorsIn(connection, undefined, "kael")).toEqual([]);
  });
});

describe("leaving a book, with bank connections", () => {
  it("takes the leaver's shares and every link on them; hands their links on others' to those owners", () => {
    const db = fresh();
    const store = new SimplefinStore(db.db);
    const kaels = store.addConnection("kael", "sealed", "bridge.test", 400);
    const jesss = store.addConnection("jess", "sealed", "bridge.test", 400);
    store.putShare(kaels.id, "home", { all: true, accounts: [] }, null);
    store.putShare(kaels.id, "personal", { all: true, accounts: [] }, null);
    store.putShare(jesss.id, "home", { all: true, accounts: [] }, null);
    // Jess linked one of Kael's; Kael, one of his own and one of Jess's.
    link(store, {
      user_id: "jess",
      connection_id: kaels.id,
      account_id: "joint",
      book_id: "home",
      account: "Assets:Joint",
    });
    link(store, {
      user_id: "kael",
      connection_id: kaels.id,
      account_id: "card",
      book_id: "home",
      account: "Liabilities:Card",
    });
    link(store, {
      user_id: "kael",
      connection_id: jesss.id,
      account_id: "savings",
      book_id: "home",
      account: "Assets:Savings",
    });
    link(store, {
      user_id: "kael",
      connection_id: kaels.id,
      account_id: "mine",
      book_id: "personal",
      account: "Assets:Mine",
    });
    store.addAttempt({
      user_id: "kael",
      connection_id: jesss.id,
      account_id: "other",
      book_id: "home",
      account: "Assets:Other",
      mode: "new",
      from_date: null,
    });

    store.leaveBook("kael", "home");

    expect(store.sharesIn("home").map((s) => s.connection_id)).toEqual([jesss.id]);
    expect(store.linksIn("home").map((l) => [l.account, l.user_id])).toEqual([
      ["Assets:Savings", "jess"], // Kael's link on Jess's connection, hers now
    ]);
    expect(store.attemptsIn("home")).toEqual([]);
    // His other book is untouched.
    expect(store.sharesIn("personal").map((s) => s.connection_id)).toEqual([kaels.id]);
    expect(store.linksIn("personal").map((l) => l.account)).toEqual(["Assets:Mine"]);
  });
});

describe("migration 27: shares from what's linked", () => {
  it("shares each connection with the books it's linked in, only the linked accounts", () => {
    const path = join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite");
    const raw = open(path);
    migrate(raw, MIGRATIONS.slice(0, 26));
    const stamp = now();
    const insert = (sql: string, ...values: (string | number | null)[]) =>
      raw.prepare(sql).run(...values);
    for (const id of ["c1", "c2"])
      insert(
        `INSERT INTO simplefin_connection (id, user_id, access_url, host, sync_minute, created_at, updated_at)
         VALUES (?, 'kael', 'sealed', 'bridge.test', 400, ?, ?)`,
        id,
        stamp,
        stamp
      );
    const addLink = (id: string, connection: string, account: string, book: string, name: string) =>
      insert(
        `INSERT INTO simplefin_link (id, user_id, connection_id, account_id, book_id, account, kind, starts_on, created_at, updated_at)
         VALUES (?, 'kael', ?, ?, ?, ?, 'cash', '2026-01-01', ?, ?)`,
        id,
        connection,
        account,
        book,
        name,
        stamp,
        stamp
      );
    addLink("l1", "c1", "chk", "home", "Assets:Checking");
    addLink("l2", "c1", "card", "home", "Liabilities:Card");
    addLink("l3", "c1", "ira", "personal", "Assets:IRA");
    insert(
      `INSERT INTO simplefin_attempt (id, user_id, connection_id, account_id, book_id, account, mode, state, created_at, updated_at)
       VALUES ('a1', 'kael', 'c2', 'sav', 'home', 'Assets:Savings', 'new', 'waiting', ?, ?)`,
      stamp,
      stamp
    );
    raw.close();

    const store = new SimplefinStore(new AppDb(path).db);
    const shared = (connection: string, book: string) => {
      const s = store.share(connection, book);
      return s && { all: s.all, accounts: s.accounts };
    };
    expect(shared("c1", "home")).toEqual({ all: false, accounts: ["card", "chk"] });
    expect(shared("c1", "personal")).toEqual({ all: false, accounts: ["ira"] });
    expect(shared("c2", "home")).toEqual({ all: false, accounts: ["sav"] });
    expect(shared("c2", "personal")).toBeUndefined();
    expect(store.linksIn("home")).toHaveLength(2); // nothing else moved
  });
});

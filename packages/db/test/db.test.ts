import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { after, createTable, migrate, MigrationError, now, open, transaction, type Migration } from "../src/index.js";

const MIGRATIONS: Migration[] = [[createTable("thing", ["id TEXT PRIMARY KEY", "name TEXT NOT NULL"])]];

const fresh = () => open(join(mkdtempSync(join(tmpdir(), "db-")), "test.sqlite"));

describe("tables", () => {
  it("always get non-null timestamps with no defaults", () => {
    const db = fresh();
    migrate(db, MIGRATIONS);

    const columns = db.prepare("PRAGMA table_info(thing)").all() as { name: string; notnull: number; dflt_value: unknown }[];
    for (const name of ["created_at", "updated_at"]) {
      const column = columns.find((c) => c.name === name);
      expect(column).toMatchObject({ notnull: 1, dflt_value: null });
    }
    expect(() => db.prepare("INSERT INTO thing (id, name) VALUES ('a', 'A')").run()).toThrow(/NOT NULL/);
  });

  it("put table constraints after the timestamps", () => {
    expect(createTable("pair", ["a TEXT", "b TEXT"], ["PRIMARY KEY (a, b)"])).toMatch(/updated_at TEXT NOT NULL,\n {4}PRIMARY KEY/);
  });
});

describe("migrations", () => {
  it("apply once, in order, and record the version", () => {
    const db = fresh();
    const backfilled: string[] = [];
    const migrations: Migration[] = [...MIGRATIONS, ["ALTER TABLE thing ADD COLUMN note TEXT", () => backfilled.push("ran")]];

    expect(migrate(db, migrations)).toBe(2);
    expect(migrate(db, migrations)).toBe(2);
    expect(backfilled).toEqual(["ran"]);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
  });

  it("roll back a migration that fails, leaving the version where it was", () => {
    const db = fresh();
    migrate(db, MIGRATIONS);

    expect(() => migrate(db, [...MIGRATIONS, ["ALTER TABLE thing ADD COLUMN x TEXT", "NOT SQL"]])).toThrow();
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    expect((db.prepare("PRAGMA table_info(thing)").all() as { name: string }[]).map((c) => c.name)).not.toContain("x");
  });

  it("refuse a database from before migrations, and one from the future", () => {
    const legacy = new DatabaseSync(":memory:");
    legacy.exec("CREATE TABLE old (id TEXT)"); // test-only, not through the helper
    expect(() => migrate(legacy, MIGRATIONS)).toThrow(MigrationError);

    const future = fresh();
    migrate(future, [...MIGRATIONS, []]);
    expect(() => migrate(future, MIGRATIONS)).toThrow(/newer/);
  });
});

describe("timestamps", () => {
  it("are fixed-width UTC with microseconds, matching the ledger's", () => {
    expect(now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });

  it("always move forward, even when the clock doesn't", () => {
    expect(after("2999-01-01T00:00:00.000000Z")).toBe("2999-01-01T00:00:00.000001Z");
    expect(after("2999-01-01T00:00:00.999999Z")).toBe("2999-01-01T00:00:01.000000Z");
    expect(after(null) < "2999-01-01T00:00:00.000000Z").toBe(true);
  });
});

it("transactions commit or roll back as a whole", () => {
  const db = fresh();
  migrate(db, MIGRATIONS);
  const insert = db.prepare("INSERT INTO thing (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)");

  expect(() =>
    transaction(db, () => {
      insert.run("a", "A", now(), now());
      throw new Error("nope");
    })
  ).toThrow("nope");
  transaction(db, () => insert.run("b", "B", now(), now()));

  expect(db.prepare("SELECT id FROM thing").all()).toEqual([{ id: "b" }]);
});

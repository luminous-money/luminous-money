/**
 * SQLite for the TypeScript services, with the same rules as the ledger's (Python) database:
 *
 * - **Every table is created through `createTable`,** which adds non-null `created_at` and
 *   `updated_at` columns with no defaults, so a write that forgets them fails loudly. A lint test
 *   (`test/lint.test.ts`) fails the build on `CREATE TABLE` anywhere else.
 * - **Timestamps** are ISO 8601, UTC, microseconds, fixed width, so text order is time order.
 *   `updated_at` doubles as a row's version, so `after` always moves it strictly forward.
 * - **Migrations** are numbered and append-only, tracked by SQLite's `user_version`. Never edit
 *   one that has shipped; append another.
 *
 * Uses `node:sqlite`, built into Node 22: no native modules to build for each architecture.
 */
import { DatabaseSync } from "node:sqlite";

export type { DatabaseSync } from "node:sqlite";
export { Sealer } from "./sealer.js";

/** CREATE TABLE with the required timestamp columns. Table constraints (composite keys and the
 * like) go in `constraints`, since SQL wants them after every column. */
export function createTable(name: string, columns: string[], constraints: string[] = []): string {
  const parts = [
    ...columns,
    "created_at TEXT NOT NULL",
    "updated_at TEXT NOT NULL",
    ...constraints,
  ];
  return `CREATE TABLE ${name} (\n    ${parts.join(",\n    ")}\n)`;
}

const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{6})Z$/;

function toMicros(stamp: string): bigint {
  const match = STAMP.exec(stamp);
  if (!match) throw new Error(`not a timestamp: ${stamp}`);
  return BigInt(Date.parse(`${match[1]}Z`)) * 1000n + BigInt(match[2]!);
}

function fromMicros(micros: bigint): string {
  const seconds = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0");
  return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19)}.${fraction}Z`;
}

/** A timestamp: ISO 8601, UTC, microseconds, fixed width (the same format as the ledger's). */
export function now(): string {
  return fromMicros(BigInt(Date.now()) * 1000n);
}

/** A timestamp strictly later than `previous`, even if the clock hasn't moved or went backwards. */
export function after(previous: string | null | undefined): string {
  const stamp = now();
  if (previous && stamp <= previous) return fromMicros(toMicros(previous) + 1n);
  return stamp;
}

/** One migration: SQL statements, or functions for steps SQL can't express (like backfills). */
export type Migration = (string | ((db: DatabaseSync) => void))[];

export class MigrationError extends Error {}

/** Open a database with the pragmas every service uses. */
export function open(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 10000");
  return db;
}

/** Run `work` as one atomic write. */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Bring the database up to date. Returns the schema version. */
export function migrate(db: DatabaseSync, migrations: Migration[]): number {
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
  const tables = (
    db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as {
      n: number;
    }
  ).n;
  if (version === 0 && tables > 0) {
    throw new MigrationError(
      "this database predates schema migrations. Nothing real was stored before hydration, so recreate it."
    );
  }
  if (version > migrations.length) {
    throw new MigrationError(
      `this database is at schema ${version}, newer than this service (${migrations.length})`
    );
  }
  migrations.slice(version).forEach((steps, i) => {
    transaction(db, () => {
      for (const step of steps) {
        if (typeof step === "string") db.exec(step);
        else step(db);
      }
      db.exec(`PRAGMA user_version = ${version + i + 1}`);
    });
  });
  return migrations.length;
}

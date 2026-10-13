/** The app's own database: CSV profiles and import history. */
import { randomUUID } from "node:crypto";

import {
  createTable,
  migrate,
  now,
  open,
  transaction,
  type DatabaseSync,
  type Migration,
} from "@fava-beans/db";

import type { CsvProfile, ImportBatch, ImportRow } from "../shared/imports.js";

export const MIGRATIONS: Migration[] = [
  [
    createTable(
      "csv_profile",
      ["book_id TEXT NOT NULL", "account TEXT NOT NULL", "profile TEXT NOT NULL"],
      ["PRIMARY KEY (book_id, account)"]
    ),
    createTable("import_batch", [
      "id TEXT PRIMARY KEY",
      "book_id TEXT NOT NULL",
      "account TEXT NOT NULL",
      "user_id TEXT NOT NULL",
      "filename TEXT NOT NULL",
      "rows INTEGER NOT NULL",
      "staged INTEGER NOT NULL",
      "duplicates INTEGER NOT NULL",
      "skipped INTEGER NOT NULL",
      "unreadable INTEGER NOT NULL",
    ]),
    "CREATE INDEX import_batch_account ON import_batch(book_id, account, created_at)",
    createTable(
      "import_row",
      [
        "batch_id TEXT NOT NULL REFERENCES import_batch(id)",
        "line INTEGER NOT NULL",
        "date TEXT",
        "amount TEXT",
        "description TEXT NOT NULL",
        "fingerprint TEXT",
        "outcome TEXT NOT NULL",
        "error TEXT",
        "transaction_id TEXT",
        "candidates TEXT NOT NULL", // JSON: Candidate[]
      ],
      ["PRIMARY KEY (batch_id, line)"]
    ),
    "CREATE INDEX import_row_fingerprint ON import_row(fingerprint)",
  ],
  // 2: several CSV profiles per account, since a bank can export more than one layout.
  [
    "ALTER TABLE csv_profile RENAME TO csv_profile_1",
    createTable("csv_profile", [
      "id TEXT PRIMARY KEY",
      "book_id TEXT NOT NULL",
      "account TEXT NOT NULL",
      "profile TEXT NOT NULL",
    ]),
    "CREATE INDEX csv_profile_account ON csv_profile(book_id, account, created_at)",
    `INSERT INTO csv_profile (id, book_id, account, profile, created_at, updated_at)
     SELECT lower(hex(randomblob(16))), book_id, account, profile, created_at, updated_at
     FROM csv_profile_1`,
    "DROP TABLE csv_profile_1",
  ],
  // 3: starred accounts, per user: what their home page shows (M2).
  [
    createTable(
      "star",
      ["user_id TEXT NOT NULL", "book_id TEXT NOT NULL", "account TEXT NOT NULL"],
      ["PRIMARY KEY (user_id, book_id, account)"]
    ),
  ],
];

type StoredRow = ImportRow & { fingerprint: string | null };

export class AppDb {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = open(path);
    migrate(this.db, MIGRATIONS);
  }

  /** The account's CSV profiles, oldest first. A file is read with the first one it fits. */
  profiles(book: string, account: string): CsvProfile[] {
    const rows = this.db
      .prepare(
        "SELECT profile FROM csv_profile WHERE book_id = ? AND account = ? ORDER BY created_at, rowid"
      )
      .all(book, account) as { profile: string }[];
    return rows.map((r) => JSON.parse(r.profile) as CsvProfile);
  }

  /** Replace all of the account's CSV profiles. */
  replaceProfiles(book: string, account: string, profiles: CsvProfile[]): void {
    transaction(this.db, () => {
      this.db
        .prepare("DELETE FROM csv_profile WHERE book_id = ? AND account = ?")
        .run(book, account);
      for (const profile of profiles) this.addProfile(book, account, profile);
    });
  }

  /** Add another CSV profile for the account. */
  addProfile(book: string, account: string, profile: CsvProfile): void {
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO csv_profile (id, book_id, account, profile, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID().replace(/-/g, ""), book, account, JSON.stringify(profile), stamp, stamp);
  }

  /** The user's starred accounts in the book, in the order they were starred. */
  stars(user: string, book: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT account FROM star WHERE user_id = ? AND book_id = ? ORDER BY created_at, rowid"
      )
      .all(user, book) as { account: string }[];
    return rows.map((r) => r.account);
  }

  star(user: string, book: string, account: string): void {
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO star (user_id, book_id, account, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`
      )
      .run(user, book, account, stamp, stamp);
  }

  unstar(user: string, book: string, account: string): void {
    this.db
      .prepare("DELETE FROM star WHERE user_id = ? AND book_id = ? AND account = ?")
      .run(user, book, account);
  }

  /** Which of `fingerprints` were already staged by an earlier import into the account. */
  stagedBefore(book: string, account: string, fingerprints: string[]): Set<string> {
    if (!fingerprints.length) return new Set();
    const found = this.db
      .prepare(
        `SELECT r.fingerprint FROM import_row r JOIN import_batch b ON b.id = r.batch_id
         WHERE b.book_id = ? AND b.account = ? AND r.outcome = 'staged'
           AND r.fingerprint IN (SELECT value FROM json_each(?))`
      )
      .all(book, account, JSON.stringify(fingerprints)) as { fingerprint: string }[];
    return new Set(found.map((r) => r.fingerprint));
  }

  saveImport(batch: ImportBatch & { book_id: string; user_id: string }, rows: StoredRow[]): void {
    const stamp = now();
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO import_batch (id, book_id, account, user_id, filename, rows, staged, duplicates, skipped, unreadable, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          batch.id,
          batch.book_id,
          batch.account,
          batch.user_id,
          batch.filename,
          batch.rows,
          batch.staged,
          batch.duplicates,
          batch.skipped,
          batch.unreadable,
          batch.created_at,
          stamp
        );
      const insert = this.db.prepare(
        `INSERT INTO import_row (batch_id, line, date, amount, description, fingerprint, outcome, error, transaction_id, candidates, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of rows) {
        insert.run(
          batch.id,
          r.line,
          r.date,
          r.amount,
          r.description,
          r.fingerprint,
          r.outcome,
          r.error,
          r.transaction_id,
          JSON.stringify(r.candidates),
          stamp,
          stamp
        );
      }
    });
  }

  batch(book: string, id: string): ImportBatch | undefined {
    return this.db
      .prepare("SELECT * FROM import_batch WHERE book_id = ? AND id = ?")
      .get(book, id) as ImportBatch | undefined;
  }

  rows(batchId: string): ImportRow[] {
    const rows = this.db
      .prepare("SELECT * FROM import_row WHERE batch_id = ? ORDER BY line")
      .all(batchId) as (ImportRow & {
      candidates: string;
    })[];
    return rows.map(
      ({ line, date, amount, description, outcome, error, transaction_id, candidates }) => ({
        line,
        date,
        amount,
        description,
        outcome,
        error,
        transaction_id,
        candidates: JSON.parse(candidates),
      })
    );
  }

  batches(book: string, account?: string): ImportBatch[] {
    return (
      account
        ? this.db
            .prepare(
              "SELECT * FROM import_batch WHERE book_id = ? AND account = ? ORDER BY created_at DESC"
            )
            .all(book, account)
        : this.db
            .prepare("SELECT * FROM import_batch WHERE book_id = ? ORDER BY created_at DESC")
            .all(book)
    ) as ImportBatch[];
  }

  /** Each account's last import time. */
  lastImports(book: string): Record<string, string> {
    const rows = this.db
      .prepare(
        "SELECT account, MAX(created_at) AS last FROM import_batch WHERE book_id = ? GROUP BY account"
      )
      .all(book) as { account: string; last: string }[];
    return Object.fromEntries(rows.map((r) => [r.account, r.last]));
  }
}

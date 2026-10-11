/** The app's own database: CSV profiles and import history. */
import {
  after,
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
];

type StoredRow = ImportRow & { fingerprint: string | null };

export class AppDb {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = open(path);
    migrate(this.db, MIGRATIONS);
  }

  profile(book: string, account: string): CsvProfile | undefined {
    const row = this.db
      .prepare("SELECT profile FROM csv_profile WHERE book_id = ? AND account = ?")
      .get(book, account) as { profile: string } | undefined;
    return row && (JSON.parse(row.profile) as CsvProfile);
  }

  saveProfile(book: string, account: string, profile: CsvProfile): void {
    const previous = this.db
      .prepare("SELECT updated_at FROM csv_profile WHERE book_id = ? AND account = ?")
      .get(book, account) as { updated_at: string } | undefined;
    const stamp = after(previous?.updated_at);
    this.db
      .prepare(
        `INSERT INTO csv_profile (book_id, account, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (book_id, account) DO UPDATE SET profile = excluded.profile, updated_at = excluded.updated_at`
      )
      .run(book, account, JSON.stringify(profile), stamp, stamp);
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

/** The app's own database: CSV profiles and import history. */
import { randomUUID } from "node:crypto";

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
import type { Occurrence, Rule, TransactionTemplate } from "../shared/schedule.js";

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
  // 4: matches that act (M2). A row's transaction can be one it matched; with candidates, its
  // match is proposed until confirmed in review.
  [
    "ALTER TABLE import_row ADD COLUMN match TEXT", // 'proposed' | 'confirmed' | NULL
    "ALTER TABLE import_batch ADD COLUMN matched INTEGER NOT NULL DEFAULT 0",
    "CREATE INDEX import_row_transaction ON import_row(transaction_id)",
  ],
  // 5: a row's payee, so it can be staged again when a match is undone.
  ["ALTER TABLE import_row ADD COLUMN payee TEXT"],
  // 6: scheduled transactions (M3). A schedule is a rule plus a transaction template; each
  // occurrence it stages is recorded, and `generated_through` is the last nominal date
  // considered, so edits never backfill and deleted occurrences don't come back.
  [
    createTable("schedule", [
      "id TEXT PRIMARY KEY",
      "user_id TEXT NOT NULL", // the owner: the generator acts as them
      "book_id TEXT NOT NULL",
      "name TEXT NOT NULL",
      "rule TEXT NOT NULL", // JSON: Rule
      "template TEXT NOT NULL", // JSON: TransactionTemplate
      "paused INTEGER NOT NULL DEFAULT 0",
      "generated_through TEXT",
      "last_error TEXT",
    ]),
    "CREATE INDEX schedule_book ON schedule(book_id)",
    createTable(
      "schedule_occurrence",
      [
        "schedule_id TEXT NOT NULL",
        "nominal TEXT NOT NULL",
        "date TEXT NOT NULL",
        "transaction_id TEXT NOT NULL",
      ],
      ["PRIMARY KEY (schedule_id, nominal)"]
    ),
  ],
];

type StoredRow = ImportRow & { fingerprint: string | null };

/** A schedule as stored, with its owner. */
export type StoredSchedule = {
  id: string;
  user_id: string;
  book_id: string;
  name: string;
  rule: Rule;
  template: TransactionTemplate;
  paused: boolean;
  generated_through: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

/** An edit based on a version that has moved on. */
export class StaleVersion extends Error {}

type ScheduleRecord = Omit<StoredSchedule, "rule" | "template" | "paused"> & {
  rule: string;
  template: string;
  paused: number;
};

const toSchedule = (r: ScheduleRecord): StoredSchedule => ({
  ...r,
  rule: JSON.parse(r.rule) as Rule,
  template: JSON.parse(r.template) as TransactionTemplate,
  paused: r.paused === 1,
});

/** An `import_row` as stored: candidates as JSON. */
type RowRecord = Omit<StoredRow, "candidates"> & { batch_id: string; candidates: string };

/** A row with where it came from: its batch, account and file. */
export type HeldRow = StoredRow & { batch_id: string; account: string; filename: string };

const HELD = `SELECT r.*, b.account, b.filename FROM import_row r JOIN import_batch b ON b.id = r.batch_id`;
const toHeldRow = (r: RowRecord & { account: string; filename: string }): HeldRow => ({
  ...toImportRow(r),
  fingerprint: r.fingerprint,
  batch_id: r.batch_id,
  account: r.account,
  filename: r.filename,
});

function toImportRow(r: RowRecord): ImportRow {
  return {
    line: r.line,
    date: r.date,
    amount: r.amount,
    description: r.description,
    payee: r.payee,
    outcome: r.outcome,
    error: r.error,
    transaction_id: r.transaction_id,
    candidates: JSON.parse(r.candidates),
    match: r.match,
  };
}

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

  /** Which of `fingerprints` an earlier import into the account already brought in (staged or
   * matched). */
  importedBefore(book: string, account: string, fingerprints: string[]): Set<string> {
    if (!fingerprints.length) return new Set();
    const found = this.db
      .prepare(
        `SELECT r.fingerprint FROM import_row r JOIN import_batch b ON b.id = r.batch_id
         WHERE b.book_id = ? AND b.account = ? AND r.outcome IN ('staged', 'matched')
           AND r.fingerprint IN (SELECT value FROM json_each(?))`
      )
      .all(book, account, JSON.stringify(fingerprints)) as { fingerprint: string }[];
    return new Set(found.map((r) => r.fingerprint));
  }

  /** Which of `transactions` a row of the account's imports already holds (staged or matched):
   * they can't be matched again from this account. */
  claimed(book: string, account: string, transactions: string[]): Set<string> {
    if (!transactions.length) return new Set();
    const found = this.db
      .prepare(
        `SELECT r.transaction_id FROM import_row r JOIN import_batch b ON b.id = r.batch_id
         WHERE b.book_id = ? AND b.account = ? AND r.outcome IN ('staged', 'matched')
           AND r.transaction_id IN (SELECT value FROM json_each(?))`
      )
      .all(book, account, JSON.stringify(transactions)) as { transaction_id: string }[];
    return new Set(found.map((r) => r.transaction_id));
  }

  saveImport(batch: ImportBatch & { book_id: string; user_id: string }, rows: StoredRow[]): void {
    const stamp = now();
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO import_batch (id, book_id, account, user_id, filename, rows, staged, matched, duplicates, skipped, unreadable, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          batch.id,
          batch.book_id,
          batch.account,
          batch.user_id,
          batch.filename,
          batch.rows,
          batch.staged,
          batch.matched,
          batch.duplicates,
          batch.skipped,
          batch.unreadable,
          batch.created_at,
          stamp
        );
      const insert = this.db.prepare(
        `INSERT INTO import_row (batch_id, line, date, amount, description, payee, fingerprint, outcome, error, transaction_id, candidates, match, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of rows) {
        insert.run(
          batch.id,
          r.line,
          r.date,
          r.amount,
          r.description,
          r.payee,
          r.fingerprint,
          r.outcome,
          r.error,
          r.transaction_id,
          JSON.stringify(r.candidates),
          r.match,
          stamp,
          stamp
        );
      }
    });
  }

  /** One row of the book's imports. */
  row(book: string, batch: string, line: number): HeldRow | undefined {
    const r = this.db
      .prepare(`${HELD} WHERE b.book_id = ? AND r.batch_id = ? AND r.line = ?`)
      .get(book, batch, line) as (RowRecord & { account: string; filename: string }) | undefined;
    return r && toHeldRow(r);
  }

  /** The row of the account's imports holding `transaction` (staged or matched), other than
   * `except`. */
  holder(
    book: string,
    account: string,
    transaction: string,
    except: { batch: string; line: number }
  ): HeldRow | undefined {
    const r = this.db
      .prepare(
        `${HELD} WHERE b.book_id = ? AND b.account = ? AND r.transaction_id = ?
           AND r.outcome IN ('staged', 'matched') AND NOT (r.batch_id = ? AND r.line = ?)`
      )
      .get(book, account, transaction, except.batch, except.line) as
      (RowRecord & { account: string; filename: string }) | undefined;
    return r && toHeldRow(r);
  }

  /** Rows whose match is proposed, oldest first: what review shows. */
  proposed(book: string): HeldRow[] {
    const rows = this.db
      .prepare(
        `${HELD} WHERE b.book_id = ? AND r.match = 'proposed' ORDER BY r.date, b.created_at, r.line`
      )
      .all(book) as (RowRecord & { account: string; filename: string })[];
    return rows.map(toHeldRow);
  }

  /** Set rows' transactions (and so outcomes), and their match states, in one write. */
  setRows(
    changes: {
      batch: string;
      line: number;
      outcome: "staged" | "matched";
      transaction_id: string;
      match: "proposed" | "confirmed";
    }[]
  ): void {
    const update = this.db.prepare(
      `UPDATE import_row SET outcome = ?, transaction_id = ?, match = ?, updated_at = ?
       WHERE batch_id = ? AND line = ?`
    );
    transaction(this.db, () => {
      for (const c of changes) {
        update.run(c.outcome, c.transaction_id, c.match, now(), c.batch, c.line);
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
      .all(batchId) as RowRecord[];
    return rows.map(toImportRow);
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

  // Schedules

  schedules(book: string): StoredSchedule[] {
    const rows = this.db
      .prepare("SELECT * FROM schedule WHERE book_id = ? ORDER BY name, created_at")
      .all(book) as ScheduleRecord[];
    return rows.map(toSchedule);
  }

  /** Every schedule that isn't paused, in every book: what the generator runs over. */
  activeSchedules(): StoredSchedule[] {
    const rows = this.db
      .prepare("SELECT * FROM schedule WHERE paused = 0 ORDER BY created_at")
      .all() as ScheduleRecord[];
    return rows.map(toSchedule);
  }

  schedule(book: string, id: string): StoredSchedule | undefined {
    const r = this.db
      .prepare("SELECT * FROM schedule WHERE book_id = ? AND id = ?")
      .get(book, id) as ScheduleRecord | undefined;
    return r && toSchedule(r);
  }

  addSchedule(
    s: Pick<StoredSchedule, "user_id" | "book_id" | "name" | "rule" | "template" | "paused">
  ): string {
    const id = randomUUID().replace(/-/g, "");
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO schedule (id, user_id, book_id, name, rule, template, paused, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        s.user_id,
        s.book_id,
        s.name,
        JSON.stringify(s.rule),
        JSON.stringify(s.template),
        s.paused ? 1 : 0,
        stamp,
        stamp
      );
    return id;
  }

  /** Change a schedule's name, rule, template or pause, against the version read. */
  updateSchedule(
    book: string,
    id: string,
    expected: string,
    changes: Partial<
      Pick<StoredSchedule, "name" | "rule" | "template" | "paused" | "generated_through">
    >
  ): void {
    transaction(this.db, () => {
      const current = this.schedule(book, id);
      if (!current) throw new Error(`no schedule ${id}`);
      if (current.updated_at !== expected)
        throw new StaleVersion("the schedule changed since it was read");
      const next = { ...current, ...changes };
      this.db
        .prepare(
          `UPDATE schedule SET name = ?, rule = ?, template = ?, paused = ?, generated_through = ?,
             last_error = NULL, updated_at = ? WHERE id = ?`
        )
        .run(
          next.name,
          JSON.stringify(next.rule),
          JSON.stringify(next.template),
          next.paused ? 1 : 0,
          next.generated_through,
          after(current.updated_at),
          id
        );
    });
  }

  deleteSchedule(book: string, id: string, expected: string): void {
    transaction(this.db, () => {
      const current = this.schedule(book, id);
      if (!current) throw new Error(`no schedule ${id}`);
      if (current.updated_at !== expected)
        throw new StaleVersion("the schedule changed since it was read");
      this.db.prepare("DELETE FROM schedule WHERE id = ?").run(id);
    });
  }

  /** Record the occurrences a schedule just staged, and move its generated-through date to the
   * last of them. Generator bookkeeping, not an edit: the version doesn't change. */
  recordOccurrences(id: string, staged: (Occurrence & { transaction_id: string })[]): void {
    const stamp = now();
    transaction(this.db, () => {
      const insert = this.db.prepare(
        `INSERT INTO schedule_occurrence (schedule_id, nominal, date, transaction_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const o of staged) insert.run(id, o.nominal, o.date, o.transaction_id, stamp, stamp);
      this.db
        .prepare("UPDATE schedule SET generated_through = ?, last_error = NULL WHERE id = ?")
        .run(staged.at(-1)!.nominal, id);
    });
  }

  /** Remember why a schedule couldn't stage its occurrences (null clears it). */
  setScheduleError(id: string, error: string | null): void {
    this.db.prepare("UPDATE schedule SET last_error = ? WHERE id = ?").run(error, id);
  }

  /** Which transactions in the book schedules staged: transaction ID to schedule ID. */
  scheduledTransactions(book: string): Record<string, string> {
    const rows = this.db
      .prepare(
        `SELECT o.transaction_id, o.schedule_id FROM schedule_occurrence o
         JOIN schedule s ON s.id = o.schedule_id WHERE s.book_id = ?`
      )
      .all(book) as { transaction_id: string; schedule_id: string }[];
    return Object.fromEntries(rows.map((r) => [r.transaction_id, r.schedule_id]));
  }
}

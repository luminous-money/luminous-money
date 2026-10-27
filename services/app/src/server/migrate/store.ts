/**
 * A book's migration from another system, as `app.sqlite` keeps it: one per book, its step and
 * what each step did (`book_migration`), and the history it brought (`reference_transaction`,
 * replaced whole when another file is read). Progress is versioned like every edit, so two tabs
 * don't step over each other.
 */
import { randomUUID } from "node:crypto";

import { after, now, transaction, type DatabaseSync } from "@luminous-money/db";

import type { Migration, MigrationState, Source, Step } from "../../shared/migration.js";
import type { OldTransaction } from "./gnucash.js";

export { SOURCES, STEPS } from "../../shared/migration.js";
export type {
  Migration,
  MigrationState,
  Source,
  Step,
  SuggestJob,
} from "../../shared/migration.js";

type Record_ = Omit<Migration, "done" | "state"> & { done: number; state: string };

const toMigration = (r: Record_): Migration => ({
  ...r,
  done: r.done === 1,
  state: JSON.parse(r.state) as MigrationState,
});

/** A change based on a version that has moved on. */
export class StaleMigration extends Error {}

export class MigrationStore {
  constructor(private readonly db: DatabaseSync) {}

  migration(book: string): Migration | undefined {
    const row = this.db.prepare("SELECT * FROM book_migration WHERE book_id = ?").get(book) as
      Record_ | undefined;
    return row && toMigration(row);
  }

  /** Start the book's migration, or return the one it has. */
  start(book: string, user: string, source: Source): Migration {
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO book_migration (book_id, user_id, source, step, done, state, created_at, updated_at)
         VALUES (?, ?, ?, 'files', 0, '{}', ?, ?) ON CONFLICT (book_id) DO NOTHING`
      )
      .run(book, user, source, stamp, stamp);
    return this.migration(book)!;
  }

  /**
   * Change its step, whether it's done, and what steps did (merged into what's there; a step set
   * to undefined is cleared). With `expected`, only if that's still its version.
   */
  update(
    book: string,
    changes: { step?: Step; done?: boolean; state?: Partial<MigrationState> },
    expected?: string
  ): Migration {
    return transaction(this.db, () => {
      const current = this.migration(book);
      if (!current) throw new Error(`${book} has no migration`);
      if (expected !== undefined && expected !== current.updated_at) throw new StaleMigration();
      const state = JSON.parse(JSON.stringify({ ...current.state, ...changes.state }));
      this.db
        .prepare(
          "UPDATE book_migration SET step = ?, done = ?, state = ?, updated_at = ? WHERE book_id = ?"
        )
        .run(
          changes.step ?? current.step,
          (changes.done ?? current.done) ? 1 : 0,
          JSON.stringify(state),
          after(current.updated_at),
          book
        );
      return this.migration(book)!;
    });
  }

  /** Background suggestions that were running when the app stopped: they've stopped. */
  stopInterrupted(): number {
    const rows = this.db
      .prepare('SELECT * FROM book_migration WHERE state LIKE \'%"status":"running"%\'')
      .all() as Record_[];
    for (const m of rows.map(toMigration)) {
      const job = m.state.suggest;
      if (job && job !== "skipped" && job.status === "running")
        this.update(m.book_id, {
          state: { suggest: { ...job, status: "stopped", finished_at: now() } },
        });
    }
    return rows.length;
  }

  /** Replace the book's imported history. */
  replaceHistory(book: string, transactions: OldTransaction[]): void {
    const stamp = now();
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM reference_transaction WHERE book_id = ?").run(book);
      const insert = this.db.prepare(
        `INSERT INTO reference_transaction (id, book_id, source_id, date, description, postings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const t of transactions)
        insert.run(
          randomUUID().replace(/-/g, ""),
          book,
          t.source_id,
          t.date,
          t.description,
          JSON.stringify(t.postings),
          stamp,
          stamp
        );
    });
  }

  /** The book's imported history, oldest first. */
  history(book: string): OldTransaction[] {
    return (
      this.db
        .prepare(
          "SELECT source_id, date, description, postings FROM reference_transaction WHERE book_id = ? ORDER BY date, rowid"
        )
        .all(book) as (Omit<OldTransaction, "postings"> & { postings: string })[]
    ).map((r) => ({ ...r, postings: JSON.parse(r.postings) as OldTransaction["postings"] }));
  }
}

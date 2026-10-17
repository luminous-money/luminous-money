/** The app's own database: CSV profiles and import history. */
import { createHash, randomBytes, randomUUID } from "node:crypto";

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

import type {
  CsvProfile,
  ImportBatch,
  ImportRow,
  ImportSource,
  ProposalSummary,
} from "../shared/imports.js";
import type { FetchResult, TransactionIn } from "@fava-beans/ledger-client";

import type { CategoryRule, CategoryRuleIn, RuleConditions } from "../shared/rules.js";
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
  // 7: M3's answers. `last_applied` is the last nominal date a schedule ran for; schedules can
  // confirm their occurrences automatically; books have a time zone for "today".
  [
    "ALTER TABLE schedule RENAME COLUMN generated_through TO last_applied",
    "ALTER TABLE schedule ADD COLUMN auto_confirm INTEGER NOT NULL DEFAULT 0",
    createTable("book_setting", ["book_id TEXT PRIMARY KEY", "time_zone TEXT NOT NULL"]),
  ],
  // 8: categorization (M4). The user's rules, and the proposal each staged transaction got:
  // which categorizer, how confident, why, and (once confirmed) whether it was accepted.
  [
    createTable("category_rule", [
      "id TEXT PRIMARY KEY",
      "book_id TEXT NOT NULL",
      "name TEXT NOT NULL",
      "conditions TEXT NOT NULL", // JSON: RuleConditions
      "account TEXT NOT NULL",
      "payee TEXT",
      "auto_confirm INTEGER NOT NULL DEFAULT 0",
      "applied INTEGER NOT NULL DEFAULT 0",
    ]),
    "CREATE INDEX category_rule_book ON category_rule(book_id)",
    createTable("proposal", [
      "transaction_id TEXT PRIMARY KEY",
      "book_id TEXT NOT NULL",
      "request_id TEXT NOT NULL",
      "incoming_id TEXT NOT NULL", // the transaction's id in the categorizer request
      "categorizer TEXT", // whose postings were applied; NULL if none proposed any
      "confidence REAL",
      "reason TEXT",
      "postings TEXT", // JSON: the proposal's postings
      "payee TEXT",
      "payee_categorizer TEXT",
      "proposal TEXT", // JSON: the winning proposal, as its categorizer gave it (for feedback)
      "accepted INTEGER", // once confirmed: 1 if its postings were kept, 0 if changed
      "payee_accepted INTEGER",
    ]),
    "CREATE INDEX proposal_book ON proposal(book_id)",
  ],
  // 9: fetching prices (M5): a book's owner (who the morning price run acts as), and each
  // book's last run.
  [
    "ALTER TABLE book_setting ADD COLUMN user_id TEXT",
    createTable("price_fetch", [
      "book_id TEXT PRIMARY KEY",
      "ran_on TEXT NOT NULL", // the book's local date
      "result TEXT NOT NULL", // JSON: the ledger's FetchResult
    ]),
  ],
  // 10: bank feeds (M9). A SimpleFIN connection is a user's (its access URL sealed); each of its
  // accounts keeps the last snapshot (balances, holdings) and a mirror of the transactions the
  // bank has sent; a link ties one to an account in a book. Batches say where they came from.
  [
    createTable("simplefin_connection", [
      "id TEXT PRIMARY KEY",
      "user_id TEXT NOT NULL",
      "access_url TEXT NOT NULL", // sealed (simplefin/crypto.ts)
      "host TEXT NOT NULL",
      "sync_minute INTEGER NOT NULL", // minutes past local midnight for the daily sync
      "requests_on TEXT", // the UTC date `requests` counts
      "requests INTEGER NOT NULL DEFAULT 0",
      "last_sync_at TEXT",
      "errors TEXT NOT NULL DEFAULT '[]'", // JSON: SfError[] from the last request
    ]),
    "CREATE INDEX simplefin_connection_user ON simplefin_connection(user_id)",
    createTable(
      "simplefin_account",
      [
        "connection_id TEXT NOT NULL REFERENCES simplefin_connection(id) ON DELETE CASCADE",
        "account_id TEXT NOT NULL",
        "name TEXT NOT NULL",
        "institution TEXT NOT NULL",
        "currency TEXT NOT NULL",
        "balance TEXT NOT NULL",
        "available_balance TEXT",
        "balance_date INTEGER NOT NULL", // Unix seconds
        "holdings TEXT NOT NULL DEFAULT '[]'", // JSON: SfHolding[]
        "history_from TEXT", // the earliest date fetched (ISO), as far as we've asked
        "history_complete INTEGER NOT NULL DEFAULT 0",
      ],
      ["PRIMARY KEY (connection_id, account_id)"]
    ),
    createTable(
      "simplefin_transaction",
      [
        "connection_id TEXT NOT NULL REFERENCES simplefin_connection(id) ON DELETE CASCADE",
        "account_id TEXT NOT NULL",
        "id TEXT NOT NULL",
        "posted INTEGER NOT NULL",
        "transacted_at INTEGER",
        "amount TEXT NOT NULL",
        "description TEXT NOT NULL",
        "payee TEXT",
        "memo TEXT",
      ],
      ["PRIMARY KEY (connection_id, account_id, id)"]
    ),
    createTable(
      "simplefin_link",
      [
        "id TEXT PRIMARY KEY",
        "user_id TEXT NOT NULL",
        "connection_id TEXT NOT NULL REFERENCES simplefin_connection(id) ON DELETE CASCADE",
        "account_id TEXT NOT NULL",
        "book_id TEXT NOT NULL",
        "account TEXT NOT NULL",
        "kind TEXT NOT NULL", // 'cash' | 'brokerage'
        "starts_on TEXT NOT NULL", // bank transactions before this date aren't imported
      ],
      ["UNIQUE (connection_id, account_id)", "UNIQUE (book_id, account)"]
    ),
    "ALTER TABLE import_batch ADD COLUMN source TEXT NOT NULL DEFAULT 'csv'",
  ],
  // 11: linking in the background (M9 follow-up). A link attempt is what the user chose; its
  // history is fetched in the background, and its preview waits for them to confirm.
  [
    createTable(
      "simplefin_attempt",
      [
        "id TEXT PRIMARY KEY",
        "user_id TEXT NOT NULL",
        "connection_id TEXT NOT NULL REFERENCES simplefin_connection(id) ON DELETE CASCADE",
        "account_id TEXT NOT NULL",
        "book_id TEXT NOT NULL",
        "account TEXT NOT NULL",
        "mode TEXT NOT NULL",
        "from_date TEXT",
        "state TEXT NOT NULL", // 'fetching' | 'waiting' (out of requests: tomorrow) | 'ready' | 'failed'
        "preview TEXT", // JSON: LinkPreview, once ready
        "error TEXT",
      ],
      ["UNIQUE (connection_id, account_id)"]
    ),
  ],
  // 12: budgets (M11). A book's weeks start on a day (0 Sunday to 6 Saturday; Monday unless
  // set), where a new weekly budget's periods start by default.
  ["ALTER TABLE book_setting ADD COLUMN week_start INTEGER NOT NULL DEFAULT 1"],
  // 13: transfers paired in review. Two imported transactions (money out of one account, the
  // same into another, within days) are made one; the pair keeps the two as they were, so
  // rejecting it restores them, and a rejected pair isn't made again.
  [
    createTable("transfer_pair", [
      "id TEXT PRIMARY KEY",
      "book_id TEXT NOT NULL",
      "transaction_id TEXT NOT NULL", // the transfer made of them
      "originals TEXT NOT NULL", // JSON: PairedOriginal[]
      "state TEXT NOT NULL", // 'proposed' | 'rejected'
      "restored TEXT", // JSON: the originals' IDs once restored
    ]),
    "CREATE INDEX transfer_pair_transaction ON transfer_pair(book_id, transaction_id)",
  ],
  // 14: sharing books (M13). Who each user is, as auth said on their last visit (for members'
  // lists), and invitations to books: a link's token (only its hash), a role, who invited, and
  // until when.
  [
    createTable("user_profile", [
      "user_id TEXT PRIMARY KEY",
      "name TEXT NOT NULL",
      "email TEXT NOT NULL",
    ]),
    createTable("book_invite", [
      "id TEXT PRIMARY KEY",
      "book_id TEXT NOT NULL",
      "token_hash TEXT NOT NULL UNIQUE",
      "role TEXT NOT NULL", // 'read' | 'write' | 'manage'
      "invited_by TEXT NOT NULL",
      "label TEXT",
      "expires_at TEXT NOT NULL",
      "accepted_by TEXT",
      "accepted_at TEXT",
    ]),
    "CREATE INDEX book_invite_book ON book_invite(book_id)",
  ],
  // 15: invitations name whose they are (M13's answers): only the account with that email can
  // accept one.
  ["ALTER TABLE book_invite ADD COLUMN email TEXT"],
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
  auto_confirm: boolean;
  last_applied: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

/** The proposal a staged transaction got, as stored. */
export type StoredProposal = {
  transaction_id: string;
  book_id: string;
  request_id: string;
  incoming_id: string;
  categorizer: string | null;
  confidence: number | null;
  reason: string | null;
  postings: { account: string; amount?: { number: string; currency: string } | null }[] | null;
  payee: string | null;
  payee_categorizer: string | null;
  proposal: unknown;
  accepted: boolean | null;
  payee_accepted: boolean | null;
};

type ProposalRecord = Omit<
  StoredProposal,
  "postings" | "proposal" | "accepted" | "payee_accepted"
> & {
  postings: string | null;
  proposal: string | null;
  accepted: number | null;
  payee_accepted: number | null;
};

const bool = (n: number | null) => (n === null ? null : n === 1);

const toProposal = (r: ProposalRecord): StoredProposal => ({
  ...r,
  postings: r.postings ? JSON.parse(r.postings) : null,
  proposal: r.proposal ? JSON.parse(r.proposal) : null,
  accepted: bool(r.accepted),
  payee_accepted: bool(r.payee_accepted),
});

type RuleRecord = Omit<CategoryRule, "conditions" | "auto_confirm"> & {
  conditions: string;
  auto_confirm: number;
};

const toRule = (r: RuleRecord): CategoryRule => ({
  ...r,
  conditions: JSON.parse(r.conditions) as RuleConditions,
  auto_confirm: r.auto_confirm === 1,
});

/** An edit based on a version that has moved on. */
export class StaleVersion extends Error {}

/** One of the two transactions a transfer was made of: as it was, and the import rows that held
 * it (each points at the transfer until it's rejected). */
export type PairedOriginal = {
  id: string;
  transaction: TransactionIn;
  account: string;
  rows: { batch: string; line: number }[];
};

export type TransferPair = {
  id: string;
  book_id: string;
  transaction_id: string;
  originals: PairedOriginal[];
  state: "proposed" | "rejected";
  restored: string[] | null;
  created_at: string;
  updated_at: string;
};

type PairRecord = Omit<TransferPair, "originals" | "restored"> & {
  originals: string;
  restored: string | null;
};

const toPair = (r: PairRecord): TransferPair => ({
  ...r,
  originals: JSON.parse(r.originals) as PairedOriginal[],
  restored: r.restored ? (JSON.parse(r.restored) as string[]) : null,
});

export type Profile = { user_id: string; name: string; email: string };

export type InviteRole = "read" | "write" | "manage";

export type Invite = {
  id: string;
  book_id: string;
  role: InviteRole;
  invited_by: string;
  /** Who it's for: only the account with this email can accept it (null: before 15). */
  email: string | null;
  label: string | null;
  expires_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

/** How long an invitation's link works (it's used up once accepted, too). */
export const INVITE_DAYS = 3;

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export type BookSettings = {
  time_zone: string;
  /** 0 Sunday to 6 Saturday. */
  week_start: number;
  updated_at: string;
};

type ScheduleRecord = Omit<StoredSchedule, "rule" | "template" | "paused" | "auto_confirm"> & {
  rule: string;
  template: string;
  paused: number;
  auto_confirm: number;
};

const toSchedule = (r: ScheduleRecord): StoredSchedule => ({
  ...r,
  rule: JSON.parse(r.rule) as Rule,
  template: JSON.parse(r.template) as TransactionTemplate,
  paused: r.paused === 1,
  auto_confirm: r.auto_confirm === 1,
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

  /** Which of `transactions` a row of the account's imports from `source` already holds
   * (staged or matched): they can't be matched again from the same stream. Another source (a
   * CSV and a bank feed) seeing the same event isn't a conflict, so it may match them. */
  claimed(
    book: string,
    account: string,
    transactions: string[],
    source: ImportSource = "csv"
  ): Set<string> {
    if (!transactions.length) return new Set();
    const found = this.db
      .prepare(
        `SELECT r.transaction_id FROM import_row r JOIN import_batch b ON b.id = r.batch_id
         WHERE b.book_id = ? AND b.account = ? AND b.source = ? AND r.outcome IN ('staged', 'matched')
           AND r.transaction_id IN (SELECT value FROM json_each(?))`
      )
      .all(book, account, source, JSON.stringify(transactions)) as { transaction_id: string }[];
    return new Set(found.map((r) => r.transaction_id));
  }

  saveImport(batch: ImportBatch & { book_id: string; user_id: string }, rows: StoredRow[]): void {
    const stamp = now();
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO import_batch (id, book_id, account, user_id, source, filename, rows, staged, matched, duplicates, skipped, unreadable, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          batch.id,
          batch.book_id,
          batch.account,
          batch.user_id,
          batch.source,
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

  /** The rows of the book's imports that hold any of `transactions` (staged or matched). */
  holders(book: string, transactions: string[]): HeldRow[] {
    if (!transactions.length) return [];
    const rows = this.db
      .prepare(
        `${HELD} WHERE b.book_id = ? AND r.outcome IN ('staged', 'matched')
           AND r.transaction_id IN (SELECT value FROM json_each(?))`
      )
      .all(book, JSON.stringify(transactions)) as (RowRecord & {
      account: string;
      filename: string;
    })[];
    return rows.map(toHeldRow);
  }

  // Transfers paired in review

  /** Record transfers just made, each from its two originals, and point the rows that held
   * the originals at it. One write. */
  recordPairs(
    book: string,
    pairs: { transaction_id: string; originals: PairedOriginal[] }[]
  ): void {
    const stamp = now();
    const insert = this.db.prepare(
      `INSERT INTO transfer_pair (id, book_id, transaction_id, originals, state, restored, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'proposed', NULL, ?, ?)`
    );
    const point = this.db.prepare(
      "UPDATE import_row SET transaction_id = ?, updated_at = ? WHERE batch_id = ? AND line = ?"
    );
    transaction(this.db, () => {
      for (const p of pairs) {
        insert.run(randomUUID(), book, p.transaction_id, JSON.stringify(p.originals), stamp, stamp);
        for (const o of p.originals)
          for (const r of o.rows) point.run(p.transaction_id, stamp, r.batch, r.line);
      }
    });
  }

  /** The book's pairs: proposed (the transfer stands), or rejected too. */
  transferPairs(book: string, states: TransferPair["state"][] = ["proposed"]): TransferPair[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM transfer_pair WHERE book_id = ? AND state IN (SELECT value FROM json_each(?)) ORDER BY created_at"
        )
        .all(book, JSON.stringify(states)) as PairRecord[]
    ).map(toPair);
  }

  /** The proposed pair a transfer was made from. */
  transferPair(book: string, transactionId: string): TransferPair | undefined {
    const r = this.db
      .prepare(
        "SELECT * FROM transfer_pair WHERE book_id = ? AND transaction_id = ? AND state = 'proposed'"
      )
      .get(book, transactionId) as PairRecord | undefined;
    return r && toPair(r);
  }

  /** The pair was rejected and its originals restored as `restored` (in order): point their
   * rows back at them, and remember not to pair them again. */
  rejectPair(pair: TransferPair, restored: string[]): void {
    const stamp = now();
    const point = this.db.prepare(
      "UPDATE import_row SET transaction_id = ?, updated_at = ? WHERE batch_id = ? AND line = ?"
    );
    transaction(this.db, () => {
      pair.originals.forEach((o, i) => {
        for (const r of o.rows) point.run(restored[i]!, stamp, r.batch, r.line);
      });
      this.db
        .prepare(
          "UPDATE transfer_pair SET state = 'rejected', restored = ?, updated_at = ? WHERE id = ?"
        )
        .run(JSON.stringify(restored), after(pair.updated_at), pair.id);
    });
  }

  /** Forget proposed pairs whose transfer isn't unconfirmed any more: confirmed (the originals
   * are gone for good) or deleted. */
  prunePairs(book: string, unconfirmed: Set<string>): void {
    const gone = this.transferPairs(book).filter((p) => !unconfirmed.has(p.transaction_id));
    const remove = this.db.prepare("DELETE FROM transfer_pair WHERE id = ?");
    transaction(this.db, () => gone.forEach((p) => remove.run(p.id)));
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
    const proposals = new Map(
      rows.flatMap((r) => {
        const p =
          r.transaction_id && r.outcome === "staged"
            ? this.proposalOf(r.transaction_id)
            : undefined;
        return p ? [[r.line, p] as const] : [];
      })
    );
    return rows.map((r) => ({ ...toImportRow(r), proposal: proposals.get(r.line) ?? null }));
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
    s: Pick<
      StoredSchedule,
      "user_id" | "book_id" | "name" | "rule" | "template" | "paused" | "auto_confirm"
    >
  ): string {
    const id = randomUUID().replace(/-/g, "");
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO schedule (id, user_id, book_id, name, rule, template, paused, auto_confirm, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        s.user_id,
        s.book_id,
        s.name,
        JSON.stringify(s.rule),
        JSON.stringify(s.template),
        s.paused ? 1 : 0,
        s.auto_confirm ? 1 : 0,
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
      Pick<
        StoredSchedule,
        "name" | "rule" | "template" | "paused" | "auto_confirm" | "last_applied"
      >
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
          `UPDATE schedule SET name = ?, rule = ?, template = ?, paused = ?, auto_confirm = ?, last_applied = ?,
             last_error = NULL, updated_at = ? WHERE id = ?`
        )
        .run(
          next.name,
          JSON.stringify(next.rule),
          JSON.stringify(next.template),
          next.paused ? 1 : 0,
          next.auto_confirm ? 1 : 0,
          next.last_applied,
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

  /** Record the occurrences a schedule just staged, and move its last-applied date to the
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
        .prepare("UPDATE schedule SET last_applied = ?, last_error = NULL WHERE id = ?")
        .run(staged.at(-1)!.nominal, id);
    });
  }

  /** Remember why a schedule couldn't stage its occurrences (null clears it). */
  setScheduleError(id: string, error: string | null): void {
    this.db.prepare("UPDATE schedule SET last_error = ? WHERE id = ?").run(error, id);
  }

  /** A schedule's occurrences dated `from` or later, with their transactions. */
  occurrencesFrom(id: string, from: string): (Occurrence & { transaction_id: string })[] {
    return this.db
      .prepare(
        "SELECT nominal, date, transaction_id FROM schedule_occurrence WHERE schedule_id = ? AND date >= ? ORDER BY nominal"
      )
      .all(id, from) as (Occurrence & { transaction_id: string })[];
  }

  forgetOccurrences(id: string, nominals: string[]): void {
    const remove = this.db.prepare(
      "DELETE FROM schedule_occurrence WHERE schedule_id = ? AND nominal = ?"
    );
    transaction(this.db, () => nominals.forEach((n) => remove.run(id, n)));
  }

  /** Which of `transactions` some import row holds (staged or matched). */
  heldByImports(transactions: string[]): Set<string> {
    if (!transactions.length) return new Set();
    const found = this.db
      .prepare(
        `SELECT transaction_id FROM import_row WHERE outcome IN ('staged', 'matched')
           AND transaction_id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify(transactions)) as { transaction_id: string }[];
    return new Set(found.map((r) => r.transaction_id));
  }

  /** For each of `transactions` a schedule staged, the schedule. */
  schedulesOf(transactions: string[]): Map<string, StoredSchedule> {
    if (!transactions.length) return new Map();
    const rows = this.db
      .prepare(
        `SELECT o.transaction_id, s.* FROM schedule_occurrence o JOIN schedule s ON s.id = o.schedule_id
         WHERE o.transaction_id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify(transactions)) as (ScheduleRecord & { transaction_id: string })[];
    return new Map(rows.map(({ transaction_id, ...r }) => [transaction_id, toSchedule(r)]));
  }

  /**
   * Follow an account that's been renamed (or moved) in the ledger, with everything under it:
   * stars, CSV profiles, import batches, schedules' templates, rules and proposals, bank links
   * and link attempts. One transaction.
   */
  renameAccount(book: string, old: string, renamed: string): void {
    const to = (name: string) =>
      name === old || name.startsWith(`${old}:`) ? renamed + name.slice(old.length) : name;
    transaction(this.db, () => this.followAccounts(book, to, () => false));
  }

  /**
   * Follow accounts deleted in the ledger, their splits moved to `substitute`: what referred to
   * them now refers to the substitute (import batches, so duplicates are still caught; CSV
   * profiles, if the substitute has none; schedules, rules, proposals), and what was about
   * them alone goes (stars, bank links and attempts). One transaction.
   */
  mergeAccounts(book: string, deleted: string[], substitute: string | null): void {
    const gone = new Set(deleted);
    const to = (name: string) => (gone.has(name) && substitute ? substitute : name);
    transaction(this.db, () => {
      const keepProfiles = substitute !== null && this.profiles(book, substitute).length === 0;
      if (!keepProfiles)
        for (const name of gone)
          this.db
            .prepare("DELETE FROM csv_profile WHERE book_id = ? AND account = ?")
            .run(book, name);
      this.followAccounts(book, to, (name) => gone.has(name));
    });
  }

  private followAccounts(
    book: string,
    to: (name: string) => string,
    drop: (name: string) => boolean
  ): void {
    const stamp = now();
    // Columns holding one account name: dropped (if `drop` says) or renamed.
    for (const [table, dropIt] of [
      ["star", true],
      ["simplefin_link", true],
      ["simplefin_attempt", true],
      ["csv_profile", false],
      ["import_batch", false],
      ["category_rule", false],
    ] as const) {
      const rows = this.db
        .prepare(`SELECT rowid AS id, account FROM ${table} WHERE book_id = ?`)
        .all(book) as { id: number; account: string }[];
      for (const r of rows) {
        if (dropIt && drop(r.account)) {
          this.db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(r.id);
        } else if (to(r.account) !== r.account) {
          this.db
            .prepare(`UPDATE ${table} SET account = ?, updated_at = ? WHERE rowid = ?`)
            .run(to(r.account), stamp, r.id);
        }
      }
    }
    // JSON columns: every `account` field in them.
    const remap = (json: string | null) =>
      json === null ? null : JSON.stringify(mapAccountFields(JSON.parse(json), to));
    for (const [table, key, columns] of [
      ["schedule", "id", ["template"]],
      ["category_rule", "id", ["conditions"]],
      ["proposal", "transaction_id", ["postings", "proposal"]],
    ] as const) {
      const rows = this.db
        .prepare(`SELECT ${key} AS key, ${columns.join(", ")} FROM ${table} WHERE book_id = ?`)
        .all(book) as Record<string, string | null>[];
      for (const r of rows) {
        const changed = columns.filter((c) => remap(r[c]!) !== r[c]);
        if (!changed.length) continue;
        this.db
          .prepare(
            `UPDATE ${table} SET ${changed.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE ${key} = ?`
          )
          .run(...changed.map((c) => remap(r[c]!)), stamp, r.key!);
      }
    }
  }

  /** Stop bank feeds into these accounts (archived ones). */
  unlinkAccounts(book: string, accounts: string[]): void {
    const remove = this.db.prepare("DELETE FROM simplefin_link WHERE book_id = ? AND account = ?");
    transaction(this.db, () => accounts.forEach((a) => remove.run(book, a)));
  }

  /** Forget everything kept here about a book: once the ledger has deleted it. */
  forgetBook(book: string): void {
    transaction(this.db, () => {
      for (const sql of [
        "DELETE FROM import_row WHERE batch_id IN (SELECT id FROM import_batch WHERE book_id = ?)",
        "DELETE FROM import_batch WHERE book_id = ?",
        "DELETE FROM csv_profile WHERE book_id = ?",
        "DELETE FROM star WHERE book_id = ?",
        "DELETE FROM schedule_occurrence WHERE schedule_id IN (SELECT id FROM schedule WHERE book_id = ?)",
        "DELETE FROM schedule WHERE book_id = ?",
        "DELETE FROM category_rule WHERE book_id = ?",
        "DELETE FROM proposal WHERE book_id = ?",
        "DELETE FROM price_fetch WHERE book_id = ?",
        "DELETE FROM book_setting WHERE book_id = ?",
        "DELETE FROM simplefin_link WHERE book_id = ?",
        "DELETE FROM simplefin_attempt WHERE book_id = ?",
        "DELETE FROM transfer_pair WHERE book_id = ?",
        "DELETE FROM book_invite WHERE book_id = ?",
      ])
        this.db.prepare(sql).run(book);
    });
  }

  // Sharing books (M13)

  /** Remember who a user is, as auth said (only writing when it changed). */
  rememberProfile(profile: Profile): void {
    const known = this.db
      .prepare("SELECT name, email FROM user_profile WHERE user_id = ?")
      .get(profile.user_id) as { name: string; email: string } | undefined;
    if (known && known.name === profile.name && known.email === profile.email) return;
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO user_profile (user_id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, email = excluded.email,
           updated_at = excluded.updated_at`
      )
      .run(profile.user_id, profile.name, profile.email, stamp, stamp);
  }

  userProfiles(users: string[]): Map<string, Profile> {
    const rows = this.db
      .prepare(
        "SELECT user_id, name, email FROM user_profile WHERE user_id IN (SELECT value FROM json_each(?))"
      )
      .all(JSON.stringify(users)) as Profile[];
    return new Map(rows.map((p) => [p.user_id, p]));
  }

  /** A new invitation to `book`, and its link's token (shown once: only its hash is kept). */
  createInvite(
    book: string,
    role: InviteRole,
    invitedBy: string,
    email: string,
    label: string | null
  ): { invite: Invite; token: string } {
    const token = randomBytes(24).toString("base64url");
    const stamp = now();
    const expires = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO book_invite (id, book_id, token_hash, role, invited_by, email, label, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, book, tokenHash(token), role, invitedBy, email, label, expires, stamp, stamp);
    return { invite: this.invite(id)!, token };
  }

  private invite(id: string): Invite | undefined {
    return this.db.prepare("SELECT * FROM book_invite WHERE id = ?").get(id) as Invite | undefined;
  }

  /** The invitation a link's token is for, used or not. */
  inviteByToken(token: string): Invite | undefined {
    return this.db
      .prepare("SELECT * FROM book_invite WHERE token_hash = ?")
      .get(tokenHash(token)) as Invite | undefined;
  }

  /** A book's invitations still open: not used, not expired. */
  openInvites(book: string): Invite[] {
    return this.db
      .prepare(
        "SELECT * FROM book_invite WHERE book_id = ? AND accepted_by IS NULL AND expires_at > ? ORDER BY created_at"
      )
      .all(book, new Date().toISOString()) as Invite[];
  }

  acceptInvite(id: string, user: string): void {
    const stamp = now();
    this.db
      .prepare(
        "UPDATE book_invite SET accepted_by = ?, accepted_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(user, stamp, stamp, id);
  }

  revokeInvite(book: string, id: string): boolean {
    return (
      this.db
        .prepare("DELETE FROM book_invite WHERE book_id = ? AND id = ? AND accepted_by IS NULL")
        .run(book, id).changes > 0
    );
  }

  /** Someone left the book: what acted as them there acts as `owner` from now on (schedules,
   * the price run). */
  handOver(book: string, from: string, owner: string): void {
    const stamp = now();
    transaction(this.db, () => {
      this.db
        .prepare(
          "UPDATE schedule SET user_id = ?, updated_at = ? WHERE book_id = ? AND user_id = ?"
        )
        .run(owner, stamp, book, from);
      this.db
        .prepare(
          "UPDATE book_setting SET user_id = ?, updated_at = ? WHERE book_id = ? AND user_id = ?"
        )
        .run(owner, stamp, book, from);
    });
  }

  // Book settings

  /** The book's time zone (IANA, e.g. "America/Chicago"), if set. */
  timeZone(book: string): string | undefined {
    const r = this.db.prepare("SELECT time_zone FROM book_setting WHERE book_id = ?").get(book) as
      { time_zone: string } | undefined;
    return r?.time_zone;
  }

  /** Set the book's time zone, recording who set it: the owner the price run acts as. */
  setTimeZone(book: string, timeZone: string, user: string): void {
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO book_setting (book_id, time_zone, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (book_id) DO UPDATE SET time_zone = excluded.time_zone, user_id = excluded.user_id,
           updated_at = excluded.updated_at`
      )
      .run(book, timeZone, user, stamp, stamp);
  }

  /** The book's settings, versioned: its time zone and the day its weeks start. Undefined until
   * a time zone is set (every book gets one on creation). */
  settings(book: string): BookSettings | undefined {
    return this.db
      .prepare("SELECT time_zone, week_start, updated_at FROM book_setting WHERE book_id = ?")
      .get(book) as BookSettings | undefined;
  }

  /** Change some of the book's settings, against the version read. */
  patchSettings(
    book: string,
    expected: string,
    changes: Partial<Pick<BookSettings, "time_zone" | "week_start">>
  ): BookSettings {
    return transaction(this.db, () => {
      const current = this.settings(book);
      if (!current) throw new Error(`no settings for ${book}`);
      if (current.updated_at !== expected)
        throw new StaleVersion("the book's settings changed since they were read");
      const next = { ...current, ...changes, updated_at: after(current.updated_at) };
      this.db
        .prepare(
          "UPDATE book_setting SET time_zone = ?, week_start = ?, updated_at = ? WHERE book_id = ?"
        )
        .run(next.time_zone, next.week_start, next.updated_at, book);
      return next;
    });
  }

  /** Books whose prices the morning run fetches: those with a time zone and an owner. */
  priceBooks(): { book_id: string; time_zone: string; user_id: string }[] {
    return this.db
      .prepare("SELECT book_id, time_zone, user_id FROM book_setting WHERE user_id IS NOT NULL")
      .all() as { book_id: string; time_zone: string; user_id: string }[];
  }

  recordPriceFetch(book: string, ranOn: string, result: unknown): void {
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO price_fetch (book_id, ran_on, result, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (book_id) DO UPDATE SET ran_on = excluded.ran_on, result = excluded.result,
           updated_at = excluded.updated_at`
      )
      .run(book, ranOn, JSON.stringify(result), stamp, stamp);
  }

  lastPriceFetch(book: string): { ran_on: string; result: FetchResult; at: string } | undefined {
    const r = this.db
      .prepare("SELECT ran_on, result, updated_at FROM price_fetch WHERE book_id = ?")
      .get(book) as { ran_on: string; result: string; updated_at: string } | undefined;
    return r && { ran_on: r.ran_on, result: JSON.parse(r.result) as FetchResult, at: r.updated_at };
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

  // Categorization rules

  rules(book: string): CategoryRule[] {
    const rows = this.db
      .prepare("SELECT * FROM category_rule WHERE book_id = ? ORDER BY name, created_at")
      .all(book) as RuleRecord[];
    return rows.map(toRule);
  }

  rule(book: string, id: string): CategoryRule | undefined {
    const r = this.db
      .prepare("SELECT * FROM category_rule WHERE book_id = ? AND id = ?")
      .get(book, id) as RuleRecord | undefined;
    return r && toRule(r);
  }

  addRule(book: string, rule: CategoryRuleIn): string {
    const id = randomUUID().replace(/-/g, "");
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO category_rule (id, book_id, name, conditions, account, payee, auto_confirm, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        book,
        rule.name,
        JSON.stringify(rule.conditions),
        rule.account,
        rule.payee,
        rule.auto_confirm ? 1 : 0,
        stamp,
        stamp
      );
    return id;
  }

  /** Replace a rule's fields, against the version read. */
  updateRule(book: string, id: string, expected: string, rule: CategoryRuleIn): void {
    transaction(this.db, () => {
      const current = this.rule(book, id);
      if (!current) throw new Error(`no rule ${id}`);
      if (current.updated_at !== expected)
        throw new StaleVersion("the rule changed since it was read");
      this.db
        .prepare(
          `UPDATE category_rule SET name = ?, conditions = ?, account = ?, payee = ?, auto_confirm = ?,
             updated_at = ? WHERE id = ?`
        )
        .run(
          rule.name,
          JSON.stringify(rule.conditions),
          rule.account,
          rule.payee,
          rule.auto_confirm ? 1 : 0,
          after(current.updated_at),
          id
        );
    });
  }

  deleteRule(book: string, id: string, expected: string): void {
    transaction(this.db, () => {
      const current = this.rule(book, id);
      if (!current) throw new Error(`no rule ${id}`);
      if (current.updated_at !== expected)
        throw new StaleVersion("the rule changed since it was read");
      this.db.prepare("DELETE FROM category_rule WHERE id = ?").run(id);
    });
  }

  /** Count how many transactions rules categorized (bookkeeping, not an edit). */
  countRuleUses(uses: Map<string, number>): void {
    const bump = this.db.prepare("UPDATE category_rule SET applied = applied + ? WHERE id = ?");
    transaction(this.db, () => uses.forEach((n, id) => bump.run(n, id)));
  }

  // Proposals

  saveProposals(proposals: Omit<StoredProposal, "accepted" | "payee_accepted">[]): void {
    const stamp = now();
    const insert = this.db.prepare(
      `INSERT INTO proposal (transaction_id, book_id, request_id, incoming_id, categorizer, confidence, reason,
         postings, payee, payee_categorizer, proposal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (transaction_id) DO UPDATE SET request_id = excluded.request_id,
         incoming_id = excluded.incoming_id, categorizer = excluded.categorizer,
         confidence = excluded.confidence, reason = excluded.reason, postings = excluded.postings,
         payee = excluded.payee, payee_categorizer = excluded.payee_categorizer,
         proposal = excluded.proposal, accepted = NULL, payee_accepted = NULL,
         updated_at = excluded.updated_at`
    );
    transaction(this.db, () => {
      for (const p of proposals) {
        insert.run(
          p.transaction_id,
          p.book_id,
          p.request_id,
          p.incoming_id,
          p.categorizer,
          p.confidence,
          p.reason,
          p.postings ? JSON.stringify(p.postings) : null,
          p.payee,
          p.payee_categorizer,
          p.proposal ? JSON.stringify(p.proposal) : null,
          stamp,
          stamp
        );
      }
    });
  }

  /** The book's proposals not yet settled (accepted or not): what review shows. */
  openProposals(book: string): StoredProposal[] {
    const rows = this.db
      .prepare("SELECT * FROM proposal WHERE book_id = ? AND accepted IS NULL")
      .all(book) as ProposalRecord[];
    return rows.map(toProposal);
  }

  /** A staged transaction's proposal, summarized (for import results). */
  proposalOf(transaction: string): ProposalSummary | undefined {
    const r = this.db
      .prepare("SELECT * FROM proposal WHERE transaction_id = ?")
      .get(transaction) as ProposalRecord | undefined;
    if (!r) return undefined;
    const p = toProposal(r);
    return {
      categorizer: p.categorizer,
      accounts: p.postings?.map((x) => x.account) ?? [],
      payee: p.payee,
      confidence: p.confidence,
      reason: p.reason,
    };
  }

  proposal(book: string, transaction: string): StoredProposal | undefined {
    const r = this.db
      .prepare("SELECT * FROM proposal WHERE book_id = ? AND transaction_id = ?")
      .get(book, transaction) as ProposalRecord | undefined;
    return r && toProposal(r);
  }

  /** Record whether a confirmed transaction kept its proposal. */
  settleProposal(transaction: string, accepted: boolean, payeeAccepted: boolean | null): void {
    this.db
      .prepare(
        "UPDATE proposal SET accepted = ?, payee_accepted = ?, updated_at = ? WHERE transaction_id = ?"
      )
      .run(
        accepted ? 1 : 0,
        payeeAccepted === null ? null : payeeAccepted ? 1 : 0,
        now(),
        transaction
      );
  }

  /** Per categorizer: proposals settled, and how many were accepted unchanged. */
  acceptance(book: string): { categorizer: string; settled: number; accepted: number }[] {
    return this.db
      .prepare(
        `SELECT categorizer, COUNT(*) AS settled, SUM(accepted) AS accepted FROM proposal
         WHERE book_id = ? AND accepted IS NOT NULL AND categorizer IS NOT NULL
         GROUP BY categorizer ORDER BY categorizer`
      )
      .all(book) as { categorizer: string; settled: number; accepted: number }[];
  }
}

/** `value` with every `account` field (at any depth) passed through `to`. */
export function mapAccountFields(value: unknown, to: (name: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => mapAccountFields(v, to));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "account" && typeof v === "string" ? to(v) : mapAccountFields(v, to),
      ])
    );
  return value;
}

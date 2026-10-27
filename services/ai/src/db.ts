/** The ai service's database: each book's AI settings, its provider's credential sealed, and
 * what its operations cost. */
import {
  after,
  createTable,
  migrate,
  now,
  open,
  transaction,
  type DatabaseSync,
  type Migration,
} from "@luminous-money/db";

import type {
  AiCost,
  AiSettings,
  AiSettingsPatch,
  AiUsage,
  Eagerness,
  ProviderName,
} from "@luminous-money/ai-api";

export type Operation = AiUsage["operations"][number]["operation"];

export const MIGRATIONS: Migration[] = [
  // 1: a book's AI (M16): on or off, its provider and credential (sealed), and the AI's settings.
  [
    createTable("ai_setting", [
      "book_id TEXT PRIMARY KEY",
      "enabled INTEGER NOT NULL DEFAULT 0",
      "provider TEXT NOT NULL DEFAULT 'claude'",
      "credential TEXT", // sealed (@luminous-money/db Sealer)
      "credential_hint TEXT", // its last four characters
      "itemize INTEGER NOT NULL DEFAULT 0",
      "create_accounts INTEGER NOT NULL DEFAULT 0",
      "eagerness TEXT NOT NULL DEFAULT 'average'",
      "guidance TEXT",
    ]),
  ],
  // 2: what each operation cost (estimated from the usage the model reported), for the AI
  // page's month-to-date and the logs.
  [
    createTable("ai_usage", [
      "book_id TEXT NOT NULL",
      "operation TEXT NOT NULL", // extract, categorize
      "ok INTEGER NOT NULL", // answered (else it failed, after calls that still cost)
      "models TEXT NOT NULL", // JSON: the models that ran
      "calls INTEGER NOT NULL",
      "input_tokens INTEGER NOT NULL",
      "output_tokens INTEGER NOT NULL",
      "cache_read_input_tokens INTEGER NOT NULL",
      "cache_creation_input_tokens INTEGER NOT NULL",
      "usd REAL", // null: a model's prices aren't known
    ]),
    "CREATE INDEX ai_usage_book ON ai_usage (book_id, created_at)",
  ],
];

/** An edit based on a version that has moved on. */
export class StaleVersion extends Error {}

type Row = {
  book_id: string;
  enabled: number;
  provider: ProviderName;
  credential: string | null;
  credential_hint: string | null;
  itemize: number;
  create_accounts: number;
  eagerness: Eagerness;
  guidance: string | null;
  updated_at: string;
};

export class AiDb {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = open(path);
    migrate(this.db, MIGRATIONS);
  }

  private row(book: string): Row | undefined {
    return this.db.prepare("SELECT * FROM ai_setting WHERE book_id = ?").get(book) as
      Row | undefined;
  }

  /** The book's settings (the defaults until first saved); `ready` given the providers this
   * service has. */
  settings(book: string, providers: ProviderName[]): AiSettings {
    const r = this.row(book);
    const provider = r?.provider ?? "claude";
    const set = !!r?.credential;
    return {
      book_id: book,
      enabled: r?.enabled === 1,
      provider,
      credential: { set, hint: r?.credential_hint ?? null },
      ready: r?.enabled === 1 && providers.includes(provider) && (set || provider === "fake"),
      itemize: r?.itemize === 1,
      create_accounts: r?.create_accounts === 1,
      eagerness: r?.eagerness ?? "average",
      guidance: r?.guidance ?? null,
      updated_at: r?.updated_at ?? null,
    };
  }

  /** Change some settings, against the version read (null: never saved). */
  patch(book: string, patch: AiSettingsPatch): void {
    transaction(this.db, () => {
      const current = this.row(book);
      if ((current?.updated_at ?? null) !== patch.updated_at)
        throw new StaleVersion("the book's AI settings changed since they were read");
      this.upsert(book, current, {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled ? 1 : 0 } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.itemize !== undefined ? { itemize: patch.itemize ? 1 : 0 } : {}),
        ...(patch.create_accounts !== undefined
          ? { create_accounts: patch.create_accounts ? 1 : 0 }
          : {}),
        ...(patch.eagerness !== undefined ? { eagerness: patch.eagerness } : {}),
        ...(patch.guidance !== undefined ? { guidance: patch.guidance?.trim() || null } : {}),
      });
    });
  }

  /** Set (or, with null, clear) the provider's credential, sealed. */
  setCredential(book: string, sealed: string | null, hint: string | null): void {
    transaction(this.db, () =>
      this.upsert(book, this.row(book), { credential: sealed, credential_hint: hint })
    );
  }

  /** The sealed credential, if any. */
  credential(book: string): string | null {
    return this.row(book)?.credential ?? null;
  }

  /** Forget a book (once it's deleted). */
  forgetBook(book: string): void {
    this.db.prepare("DELETE FROM ai_setting WHERE book_id = ?").run(book);
    this.db.prepare("DELETE FROM ai_usage WHERE book_id = ?").run(book);
  }

  /** Record what an operation cost. */
  recordUsage(book: string, operation: Operation, ok: boolean, cost: AiCost): void {
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO ai_usage (book_id, operation, ok, models, calls, input_tokens, output_tokens,
           cache_read_input_tokens, cache_creation_input_tokens, usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        book,
        operation,
        ok ? 1 : 0,
        JSON.stringify(cost.models),
        cost.calls,
        cost.input_tokens,
        cost.output_tokens,
        cost.cache_read_input_tokens,
        cost.cache_creation_input_tokens,
        cost.usd,
        stamp,
        stamp
      );
  }

  /** The book's spending in a month (YYYY-MM, UTC), by operation; failed ones count too. */
  usage(book: string, month: string): AiUsage {
    const rows = this.db
      .prepare(
        `SELECT operation, COUNT(*) AS count, SUM(calls) AS calls, SUM(usd) AS usd,
           SUM(usd IS NULL AND calls > 0) AS unpriced
         FROM ai_usage WHERE book_id = ? AND created_at LIKE ? GROUP BY operation ORDER BY operation`
      )
      .all(book, `${month}-%`) as {
      operation: Operation;
      count: number;
      calls: number;
      usd: number | null;
      unpriced: number;
    }[];
    const operations = rows.map((r) => ({
      operation: r.operation,
      count: r.count,
      usd: r.unpriced ? null : (r.usd ?? 0),
    }));
    return {
      month,
      calls: rows.reduce((n, r) => n + r.calls, 0),
      usd: operations.some((o) => o.usd === null)
        ? null
        : operations.reduce((n, o) => n + (o.usd ?? 0), 0),
      operations,
    };
  }

  private upsert(book: string, current: Row | undefined, changes: Partial<Row>): void {
    const stamp = after(current?.updated_at);
    const next = {
      enabled: 0,
      provider: "claude",
      credential: null,
      credential_hint: null,
      itemize: 0,
      create_accounts: 0,
      eagerness: "average",
      guidance: null,
      ...current,
      ...changes,
    };
    this.db
      .prepare(
        `INSERT INTO ai_setting (book_id, enabled, provider, credential, credential_hint, itemize,
           create_accounts, eagerness, guidance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (book_id) DO UPDATE SET enabled = excluded.enabled, provider = excluded.provider,
           credential = excluded.credential, credential_hint = excluded.credential_hint,
           itemize = excluded.itemize, create_accounts = excluded.create_accounts,
           eagerness = excluded.eagerness, guidance = excluded.guidance, updated_at = excluded.updated_at`
      )
      .run(
        book,
        next.enabled,
        next.provider,
        next.credential,
        next.credential_hint,
        next.itemize,
        next.create_accounts,
        next.eagerness,
        next.guidance,
        stamp,
        stamp
      );
  }
}

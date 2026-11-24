/** The ai service's database: people's keys (sealed), each book's AI settings and the key it
 * uses, and what its operations cost. */
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

import { randomUUID } from "node:crypto";

import type {
  AiCost,
  AiCredential,
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
  // 3: "Suggest tags" (HSA tracking; Tags, more's decision 9: on by default).
  ["ALTER TABLE ai_setting ADD COLUMN suggest_tags INTEGER NOT NULL DEFAULT 1"],
  // 4: keys are people's (shared connections, 2026-11-24): a key is its owner's, and a book uses
  // one. A book's own (`ai_setting.credential`, from before) becomes its owner's the first time
  // the owner's request comes (`adopt`): nothing here knew who set it.
  [
    createTable("ai_credential", [
      "id TEXT PRIMARY KEY",
      "user_id TEXT NOT NULL",
      "provider TEXT NOT NULL",
      "credential TEXT NOT NULL", // sealed (@luminous-money/db Sealer)
      "hint TEXT NOT NULL", // its last four characters
    ]),
    "CREATE INDEX ai_credential_user ON ai_credential (user_id)",
    "ALTER TABLE ai_setting ADD COLUMN credential_id TEXT REFERENCES ai_credential (id) ON DELETE SET NULL",
  ],
];

/** The key a book uses: a person's, or (`user_id` null) the book's own from before. */
export type BookKey = {
  id: string | null;
  user_id: string | null;
  credential: string;
  hint: string;
};

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
  suggest_tags: number;
  credential_id: string | null;
  updated_at: string;
};

type KeyRow = {
  id: string;
  user_id: string;
  provider: ProviderName;
  credential: string;
  hint: string;
  created_at: string;
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
   * service has and the key it may use (`key`: the caller's call, `usableKey`). */
  settings(
    book: string,
    providers: ProviderName[],
    key: BookKey | null,
    viewer: string
  ): AiSettings {
    const r = this.row(book);
    const provider = r?.provider ?? "claude";
    const set = !!key;
    return {
      book_id: book,
      enabled: r?.enabled === 1,
      provider,
      credential: {
        set,
        hint: key?.hint ?? null,
        mine: !!key?.user_id && key.user_id === viewer,
        owner_id: key?.user_id ?? null,
      },
      ready: r?.enabled === 1 && providers.includes(provider) && (set || provider === "fake"),
      itemize: r?.itemize === 1,
      create_accounts: r?.create_accounts === 1,
      eagerness: r?.eagerness ?? "average",
      guidance: r?.guidance ?? null,
      suggest_tags: r ? r.suggest_tags === 1 : true,
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
        ...(patch.suggest_tags !== undefined ? { suggest_tags: patch.suggest_tags ? 1 : 0 } : {}),
      });
    });
  }

  /** The key the book uses, if any (whether its owner may still lend it is the API's call). */
  keyOf(book: string): BookKey | null {
    const r = this.row(book);
    if (r?.credential_id) {
      const k = this.db.prepare("SELECT * FROM ai_credential WHERE id = ?").get(r.credential_id) as
        KeyRow | undefined;
      if (k) return { id: k.id, user_id: k.user_id, credential: k.credential, hint: k.hint };
    }
    return r?.credential
      ? { id: null, user_id: null, credential: r.credential, hint: r.credential_hint ?? "" }
      : null;
  }

  /** Use one of a person's keys in the book (or, with null, none): a change of its settings. */
  useKey(book: string, key: string | null): void {
    transaction(this.db, () =>
      this.upsert(book, this.row(book), {
        credential_id: key,
        credential: null,
        credential_hint: null,
      })
    );
  }

  /** The book's own key, from before keys were people's, becomes `owner`'s (the book's owner,
   * the first time their request comes), and the book uses it as theirs. */
  adopt(book: string, owner: string): void {
    transaction(this.db, () => {
      const r = this.row(book);
      if (!r?.credential || r.credential_id) return;
      const key = this.addKey(owner, r.provider, r.credential, r.credential_hint ?? "");
      this.db
        .prepare(
          "UPDATE ai_setting SET credential_id = ?, credential = NULL, credential_hint = NULL WHERE book_id = ?"
        )
        .run(key.id, book);
    });
  }

  // People's keys

  private keyView(k: KeyRow): AiCredential {
    const books = this.db
      .prepare("SELECT book_id FROM ai_setting WHERE credential_id = ? ORDER BY book_id")
      .all(k.id) as { book_id: string }[];
    return {
      id: k.id,
      provider: k.provider,
      hint: k.hint,
      created_at: k.created_at,
      books: books.map((b) => b.book_id),
    };
  }

  /** A person's key, sealed. */
  addKey(user: string, provider: ProviderName, sealed: string, hint: string): AiCredential {
    const id = randomUUID().replace(/-/g, "");
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO ai_credential (id, user_id, provider, credential, hint, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, user, provider, sealed, hint, stamp, stamp);
    return this.key(user, id)!;
  }

  /** One of the person's keys. */
  key(user: string, id: string): AiCredential | undefined {
    const k = this.db
      .prepare("SELECT * FROM ai_credential WHERE id = ? AND user_id = ?")
      .get(id, user) as KeyRow | undefined;
    return k && this.keyView(k);
  }

  keys(user: string): AiCredential[] {
    return (
      this.db
        .prepare("SELECT * FROM ai_credential WHERE user_id = ? ORDER BY created_at")
        .all(user) as KeyRow[]
    ).map((k) => this.keyView(k));
  }

  /** Delete one of the person's keys: every book using it has none. */
  deleteKey(user: string, id: string): boolean {
    return (
      this.db.prepare("DELETE FROM ai_credential WHERE id = ? AND user_id = ?").run(id, user)
        .changes > 0
    );
  }

  /** Forget a person's keys (their account is being deleted). */
  forgetUser(user: string): void {
    this.db.prepare("DELETE FROM ai_credential WHERE user_id = ?").run(user);
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
      suggest_tags: 1,
      credential_id: null,
      ...current,
      ...changes,
    };
    this.db
      .prepare(
        `INSERT INTO ai_setting (book_id, enabled, provider, credential, credential_hint, itemize,
           create_accounts, eagerness, guidance, suggest_tags, credential_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (book_id) DO UPDATE SET enabled = excluded.enabled, provider = excluded.provider,
           credential = excluded.credential, credential_hint = excluded.credential_hint,
           itemize = excluded.itemize, create_accounts = excluded.create_accounts,
           eagerness = excluded.eagerness, guidance = excluded.guidance,
           suggest_tags = excluded.suggest_tags, credential_id = excluded.credential_id,
           updated_at = excluded.updated_at`
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
        next.suggest_tags,
        next.credential_id,
        stamp,
        stamp
      );
  }
}

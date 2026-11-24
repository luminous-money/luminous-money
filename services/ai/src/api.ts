/**
 * The ai service's API, at /api/ai/v1 (M16). Every route but health needs the caller (X-User-Id,
 * set by Traefik after checking the session); what they may do in a book is the ledger's call:
 * a member reads a book's AI settings, a manager changes them (and chooses its key), a writer
 * uses its two operations (extract a receipt's facts, categorize splits).
 *
 * **Keys are people's** (shared connections, 2026-11-24: `/credentials`): a manager puts one of
 * their own in a book; its owner can always take it out, and it isn't used once they've left the
 * book. A key is sealed at rest and never sent back.
 */
import { bodyLimit } from "hono/body-limit";
import { Hono, type Context } from "hono";

import type { Sealer } from "@luminous-money/db";
import {
  addCost,
  EAGERNESS,
  formatUsd,
  NO_COST,
  type AiHealth,
  type AiSettingsPatch,
  type CategorizeIn,
  type ExtractIn,
  type LoanTableIn,
  type ProviderName,
} from "@luminous-money/ai-api";

import { StaleVersion, type AiDb, type BookKey, type Operation } from "./db.js";
import { offeredTags, ReadFailed, untagged, type Meter, type Provider } from "./providers/types.js";

type Env = { Variables: { user: string } };
export type Role = "owner" | "manage" | "write" | "read";
/** The caller's role in the book, or null if they have none (or there's no such book). */
export type RoleOf = (user: string, book: string) => Promise<Role | null>;

const RANKS: Role[] = ["read", "write", "manage", "owner"];
const atLeast = (role: Role | null, need: Role) =>
  role !== null && RANKS.indexOf(role) >= RANKS.indexOf(need);

/** At most 5 MB of receipt, as base64 (a third more). */
const MAX_BASE64 = Math.ceil((5 * 1024 * 1024 * 4) / 3) + 4;

export function createApi({
  db,
  sealer,
  providers,
  roleOf,
}: {
  db: AiDb;
  sealer: Sealer;
  providers: Provider[];
  roleOf: RoleOf;
}) {
  const api = new Hono<Env>().basePath("/api/ai/v1");
  // A receipt's or a loan table's file comes as base64, from `app` (which keeps receipts to 5 MB,
  // PDFs too): 25 MB is ample, and nothing reads more (scale readiness, S4).
  api.use(
    "*",
    bodyLimit({
      maxSize: 25 * 1024 * 1024,
      onError: (c) => c.json({ detail: "a request is at most 25 MB" }, 413),
    })
  );
  const names = providers.map((p) => p.name) as ProviderName[];

  /** Up, and with which providers: what the PWA checks before offering anything AI. */
  api.get("/health", (c) => c.json({ status: "ok", providers: names } satisfies AiHealth));

  for (const path of ["/books/*", "/credentials", "/credentials/*", "/me"])
    api.use(path, async (c, next) => {
      const user = c.req.header("x-user-id");
      if (!user) return c.json({ detail: "not logged in" }, 401);
      c.set("user", user);
      return next();
    });

  /** The caller's role, or a response refusing them. The book's owner takes its key from
   * before keys were people's, the first time they come. */
  const allowed = async (c: Context<Env>, need: Role) => {
    const book = c.req.param("book")!;
    const role = await roleOf(c.get("user"), book);
    if (role === "owner") db.adopt(book, c.get("user"));
    if (!role) return c.json({ detail: "not found" }, 404);
    if (!atLeast(role, need))
      return c.json(
        {
          detail:
            need === "manage"
              ? "only a manager of the book can do that"
              : "you can see this book, but not change it",
        },
        403
      );
    return null;
  };

  /** The key the book may use: none once its owner has left the book (it stops being used). */
  const usableKey = async (book: string, caller: string): Promise<BookKey | null> => {
    const key = db.keyOf(book);
    if (!key?.user_id || key.user_id === caller) return key;
    if (await roleOf(key.user_id, book)) return key;
    db.useKey(book, null);
    return null;
  };

  /** The book's settings, as the caller sees them. */
  const settingsOf = async (book: string, caller: string) =>
    db.settings(book, names, await usableKey(book, caller), caller);

  api.get("/books/:book/settings", async (c) => {
    const refused = await allowed(c, "read");
    if (refused) return refused;
    return c.json(await settingsOf(c.req.param("book"), c.get("user")));
  });

  /** Change some settings, against `updated_at` (null when they've never been saved). */
  api.patch("/books/:book/settings", async (c) => {
    const refused = await allowed(c, "manage");
    if (refused) return refused;
    const book = c.req.param("book");
    const patch = (await c.req.json().catch(() => null)) as AiSettingsPatch | null;
    if (!patch || !("updated_at" in patch))
      return c.json({ detail: "send the updated_at you read (null if none)" }, 422);
    if (patch.provider !== undefined && !names.includes(patch.provider))
      return c.json({ detail: `the provider is one of ${names.join(", ")}` }, 422);
    if (patch.eagerness !== undefined && !EAGERNESS.includes(patch.eagerness))
      return c.json({ detail: `eagerness is one of ${EAGERNESS.join(", ")}` }, 422);
    for (const flag of ["enabled", "itemize", "create_accounts", "suggest_tags"] as const)
      if (patch[flag] !== undefined && typeof patch[flag] !== "boolean")
        return c.json({ detail: `${flag} is true or false` }, 422);
    if (
      patch.guidance !== undefined &&
      patch.guidance !== null &&
      typeof patch.guidance !== "string"
    )
      return c.json({ detail: "guidance is text" }, 422);
    try {
      db.patch(book, patch);
    } catch (error) {
      if (error instanceof StaleVersion) return c.json({ detail: error.message }, 409);
      throw error;
    }
    return c.json(await settingsOf(book, c.get("user")));
  });

  /** A new key, the caller's: sealed, and never sent back. */
  const newKey = (user: string, provider: ProviderName, apiKey: unknown) => {
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (key.length < 8) return null;
    return db.addKey(user, provider, sealer.seal(key), key.slice(-4));
  };

  /** The book's key, as a manager: one of their own (`credential_id`), or a new one of theirs
   * (`api_key`). */
  api.put("/books/:book/credential", async (c) => {
    const refused = await allowed(c, "manage");
    if (refused) return refused;
    const book = c.req.param("book");
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as {
      api_key?: unknown;
      credential_id?: unknown;
    };
    const provider = db.settings(book, names, null, user).provider;
    const key =
      typeof body.credential_id === "string"
        ? db.key(user, body.credential_id)
        : newKey(user, provider, body.api_key);
    if (!key)
      return c.json(
        {
          detail:
            typeof body.credential_id === "string"
              ? "that isn't one of your keys"
              : "paste the whole API key",
        },
        422
      );
    db.useKey(book, key.id);
    return c.json(await settingsOf(book, user));
  });

  /** Stop using the book's key: a manager, or the key's owner (taking theirs back). */
  api.delete("/books/:book/credential", async (c) => {
    const book = c.req.param("book");
    const user = c.get("user");
    const theirs = db.keyOf(book)?.user_id === user;
    const refused = await allowed(c, theirs ? "read" : "manage");
    if (refused) return refused;
    db.useKey(book, null);
    return c.json(await settingsOf(book, user));
  });

  // People's keys

  /** The caller's keys (their last four), with the books using each. */
  api.get("/credentials", (c) => c.json(db.keys(c.get("user"))));

  /** A new key of the caller's (`{api_key, provider?}`), to put in books. */
  api.post("/credentials", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      api_key?: unknown;
      provider?: unknown;
    };
    const provider = (body.provider ?? "claude") as ProviderName;
    if (!names.includes(provider))
      return c.json({ detail: `the provider is one of ${names.join(", ")}` }, 422);
    const key = newKey(c.get("user"), provider, body.api_key);
    if (!key) return c.json({ detail: "paste the whole API key" }, 422);
    return c.json(key, 201);
  });

  /** Delete one of the caller's keys: every book using it has none. */
  api.delete("/credentials/:id", (c) =>
    db.deleteKey(c.get("user"), c.req.param("id"))
      ? c.body(null, 204)
      : c.json({ detail: "not found" }, 404)
  );

  /** Forget the caller's keys (`app` calls this when their account is deleted). */
  api.delete("/me", (c) => {
    db.forgetUser(c.get("user"));
    return c.body(null, 204);
  });

  /** The book's provider and its credential, once the caller may use them: a refusal
   * otherwise (409 when the book's AI isn't set up). */
  const ready = async (c: Context<Env>) => {
    const refused = await allowed(c, "write");
    if (refused) return { refused };
    const book = c.req.param("book")!;
    const key = await usableKey(book, c.get("user"));
    const settings = db.settings(book, names, key, c.get("user"));
    if (!settings.ready) return { refused: c.json({ detail: "the book's AI isn't set up" }, 409) };
    return {
      refused: null,
      settings,
      provider: providers.find((p) => p.name === settings.provider)!,
      credential: key ? sealer.open(key.credential) : null,
    };
  };

  /**
   * Run a provider's operation, with what it cost as `cost`; 422 when it couldn't answer (`app`
   * carries on without it), which the log says too: `luminous-money logs ai`. Every call to a
   * model is logged with its tokens and estimated cost as it's answered, and the operation's
   * total is recorded for the book (failed ones too: their calls still cost).
   */
  const answer = async <T extends object>(
    c: Context<Env>,
    what: Operation,
    run: (meter: Meter) => Promise<T>
  ) => {
    const book = c.req.param("book")!;
    let cost = NO_COST;
    const meter: Meter = (call) => {
      cost = addCost(cost, call);
      console.log(
        `book ${book}: ${what} call: ${call.model}, ${call.input_tokens} in, ${call.output_tokens} out, ` +
          `${call.cache_read_input_tokens} cache read, ${call.cache_creation_input_tokens} cache written: ` +
          `about ${formatUsd(call.usd)}`
      );
    };
    const done = (ok: boolean) => {
      if (!cost.calls) return;
      db.recordUsage(book, what, ok, cost);
      console.log(
        `book ${book}: ${what} ${ok ? "answered" : "failed"}: about ${formatUsd(cost.usd)} in all`
      );
    };
    try {
      const result = await run(meter);
      done(true);
      return c.json({ ...result, cost });
    } catch (error) {
      done(false);
      if (error instanceof ReadFailed) {
        console.warn(`book ${book}: ${what} failed: ${error.message}`);
        return c.json({ detail: error.message, cost }, 422);
      }
      throw error;
    }
  };

  /** What the book's AI cost in a month (`?month=YYYY-MM`, UTC; default this one): any member. */
  api.get("/books/:book/usage", async (c) => {
    const refused = await allowed(c, "read");
    if (refused) return refused;
    const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ detail: "the month is YYYY-MM" }, 422);
    return c.json(db.usage(c.req.param("book"), month));
  });

  /** What a receipt says: its facts, nothing about the book. */
  api.post("/books/:book/receipts/extract", async (c) => {
    const use = await ready(c);
    if (use.refused) return use.refused;
    const input = (await c.req.json().catch(() => null)) as ExtractIn | null;
    if (!input?.file?.data || !input.file.media_type || !input.today || !input.currency)
      return c.json({ detail: "send the receipt, today and the currency" }, 422);
    if (input.file.data.length > MAX_BASE64)
      return c.json({ detail: "a receipt is at most 5 MB" }, 413);
    return answer(c, "extract", (meter) => use.provider.extract(input, use.credential, meter));
  });

  /** What a loan's amortization schedule says: its rows, and its terms where it prints them. */
  api.post("/books/:book/loans/extract", async (c) => {
    const use = await ready(c);
    if (use.refused) return use.refused;
    const input = (await c.req.json().catch(() => null)) as LoanTableIn | null;
    if (!input?.file?.data || !input.file.media_type || !input.currency)
      return c.json({ detail: "send the schedule and the currency" }, 422);
    if (input.file.data.length > MAX_BASE64)
      return c.json({ detail: "a schedule is at most 5 MB" }, 413);
    return answer(c, "loan-table", (meter) => use.provider.loanTable(input, use.credential, meter));
  });

  /** Where transactions' unconfirmed splits belong, with the book's guidance (and its
   * account creation, if it's on), and the tags offered on them (with "Suggest tags" on: only
   * those offered are kept). */
  api.post("/books/:book/categorize", async (c) => {
    const use = await ready(c);
    if (use.refused) return use.refused;
    const input = (await c.req.json().catch(() => null)) as CategorizeIn | null;
    if (!Array.isArray(input?.transactions) || !Array.isArray(input.accounts) || !input.currency)
      return c.json({ detail: "send the transactions, the accounts and the currency" }, 422);
    const { settings } = use;
    const tags = settings.suggest_tags && Array.isArray(input.tags) ? input.tags : [];
    return answer(c, "categorize", (meter) =>
      use.provider
        .categorize(
          {
            ...input,
            history: settings.suggest_tags ? (input.history ?? []) : untagged(input.history ?? []),
            reference: Array.isArray(input.reference) ? input.reference : [],
            tags,
            guidance: settings.guidance,
            creation: settings.create_accounts ? { eagerness: settings.eagerness } : null,
          },
          use.credential,
          meter
        )
        .then((out) => offeredTags(out, new Set(tags.map((t) => t.name))))
    );
  });

  /** Forget a book: its owner, or anyone once the ledger no longer has it (`app` calls this
   * when a book is deleted). */
  api.delete("/books/:book", async (c) => {
    const book = c.req.param("book");
    const role = await roleOf(c.get("user"), book);
    if (role && role !== "owner") return c.json({ detail: "only the owner can do that" }, 403);
    db.forgetBook(book);
    return c.body(null, 204);
  });

  return api;
}

/**
 * The ai service's API, at /api/ai/v1 (M16). Every route but health needs the caller (X-User-Id,
 * set by Traefik after checking the session); what they may do in a book is the ledger's call:
 * a member reads a book's AI settings, a manager changes them (and its credential), a writer
 * uses its two operations (extract a receipt's facts, categorize splits). The credential is
 * sealed at rest and never sent back.
 */
import { Hono, type Context } from "hono";

import type { Sealer } from "@luminous-money/db";
import {
  EAGERNESS,
  type AiHealth,
  type AiSettingsPatch,
  type CategorizeIn,
  type ExtractIn,
  type ProviderName,
} from "@luminous-money/ai-api";

import { StaleVersion, type AiDb } from "./db.js";
import { ReadFailed, type Provider } from "./providers/types.js";

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
  const names = providers.map((p) => p.name) as ProviderName[];

  /** Up, and with which providers: what the PWA checks before offering anything AI. */
  api.get("/health", (c) => c.json({ status: "ok", providers: names } satisfies AiHealth));

  api.use("/books/*", async (c, next) => {
    const user = c.req.header("x-user-id");
    if (!user) return c.json({ detail: "not logged in" }, 401);
    c.set("user", user);
    return next();
  });

  /** The caller's role, or a response refusing them. */
  const allowed = async (c: Context<Env>, need: Role) => {
    const role = await roleOf(c.get("user"), c.req.param("book")!);
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

  api.get("/books/:book/settings", async (c) => {
    const refused = await allowed(c, "read");
    if (refused) return refused;
    return c.json(db.settings(c.req.param("book"), names));
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
    for (const flag of ["enabled", "itemize", "create_accounts"] as const)
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
    return c.json(db.settings(book, names));
  });

  /** Set the provider's credential (an API key): sealed, and never sent back. */
  api.put("/books/:book/credential", async (c) => {
    const refused = await allowed(c, "manage");
    if (refused) return refused;
    const book = c.req.param("book");
    const body = (await c.req.json().catch(() => ({}))) as { api_key?: unknown };
    const key = typeof body.api_key === "string" ? body.api_key.trim() : "";
    if (key.length < 8) return c.json({ detail: "paste the whole API key" }, 422);
    db.setCredential(book, sealer.seal(key), key.slice(-4));
    return c.json(db.settings(book, names));
  });

  api.delete("/books/:book/credential", async (c) => {
    const refused = await allowed(c, "manage");
    if (refused) return refused;
    const book = c.req.param("book");
    db.setCredential(book, null, null);
    return c.json(db.settings(book, names));
  });

  /** The book's provider and its credential, once the caller may use them: a refusal
   * otherwise (409 when the book's AI isn't set up). */
  const ready = async (c: Context<Env>) => {
    const refused = await allowed(c, "write");
    if (refused) return { refused };
    const book = c.req.param("book")!;
    const settings = db.settings(book, names);
    if (!settings.ready) return { refused: c.json({ detail: "the book's AI isn't set up" }, 409) };
    const sealed = db.credential(book);
    return {
      refused: null,
      settings,
      provider: providers.find((p) => p.name === settings.provider)!,
      credential: sealed ? sealer.open(sealed) : null,
    };
  };

  /** Run a provider's operation; 422 when it couldn't answer (`app` carries on without it),
   * which the log says too: `luminous-money logs ai`. */
  const answer = async <T>(c: Context<Env>, what: string, run: () => Promise<T>) => {
    try {
      return c.json(await run());
    } catch (error) {
      if (error instanceof ReadFailed) {
        console.warn(`book ${c.req.param("book")}: ${what} failed: ${error.message}`);
        return c.json({ detail: error.message }, 422);
      }
      throw error;
    }
  };

  /** What a receipt says: its facts, nothing about the book. */
  api.post("/books/:book/receipts/extract", async (c) => {
    const use = await ready(c);
    if (use.refused) return use.refused;
    const input = (await c.req.json().catch(() => null)) as ExtractIn | null;
    if (!input?.file?.data || !input.file.media_type || !input.today || !input.currency)
      return c.json({ detail: "send the receipt, today and the currency" }, 422);
    if (input.file.data.length > MAX_BASE64)
      return c.json({ detail: "a receipt is at most 5 MB" }, 413);
    return answer(c, "extract", () => use.provider.extract(input, use.credential));
  });

  /** Where transactions' unconfirmed splits belong, with the book's guidance (and its
   * account creation, if it's on). */
  api.post("/books/:book/categorize", async (c) => {
    const use = await ready(c);
    if (use.refused) return use.refused;
    const input = (await c.req.json().catch(() => null)) as CategorizeIn | null;
    if (!Array.isArray(input?.transactions) || !Array.isArray(input.accounts) || !input.currency)
      return c.json({ detail: "send the transactions, the accounts and the currency" }, 422);
    const { settings } = use;
    return answer(c, "categorize", () =>
      use.provider.categorize(
        {
          ...input,
          history: input.history ?? [],
          reference: Array.isArray(input.reference) ? input.reference : [],
          guidance: settings.guidance,
          creation: settings.create_accounts ? { eagerness: settings.eagerness } : null,
        },
        use.credential
      )
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

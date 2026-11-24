/**
 * Bank feeds' part of the app API.
 *
 * - **Connections are the user's** (`/simplefin/connections`): connect with a setup token, list
 *   (each with its accounts' last snapshot, where each is linked, and the books it's shared
 *   with), sync now, disconnect.
 * - **Sharing puts one in a book** (`/books/:book/simplefin/connections`, shared connections):
 *   its owner shares all its accounts (new ones too) or those chosen. A book sees the caller's
 *   own and those shared with it, only what's shared; its writers sync them.
 * - **Links go into a book** (`/books/:book/simplefin/...`): preview and make a link (mode
 *   `new`, `reconcile`, `start-over` or `from-date`) to a shared account, unlink, and what each
 *   linked account's bank reports (for account pages and home cards). Any writer of the book.
 * - `DELETE /me` (api.ts) forgets the user's connections, when their account is deleted.
 *
 * The access URL never leaves the server: connections show their host.
 */
import type { Hono } from "hono";

import type { ImportResult } from "../../shared/imports.js";
import {
  claim,
  concerns,
  explainError,
  hostOf,
  isNotice,
  SimplefinProblem,
  type SfError,
} from "./client.js";
import { kindOf, LinkProblem, plan, type LinkMode } from "./link.js";
import { attemptLink, confirmAttempt } from "./attempts.js";
import type { Attempt, Connection, LinkKind } from "./store.js";
import { covers, DAILY_BUDGET, errorsIn, StaleShare } from "./store.js";
import {
  cashAccountOf,
  OutOfRequests,
  randomSyncMinute,
  request,
  syncConnection,
  type SimplefinDeps,
} from "./sync.js";
import { isInternal, within } from "../../shared/divided.js";
import { wantsAsync, type Jobs } from "../jobs.js";
import { LedgerError } from "../ledger.js";
import { bankComparison } from "../reconcile.js";
import { pairTransfers } from "../transfers.js";
import { readerFor } from "./activity.js";
import { activityOf, dividendsOf } from "./brokerage.js";
import { planReread, RereadProblem } from "./reread.js";

type Env = { Variables: { user: string } };

const MODES: LinkMode[] = ["new", "reconcile", "start-over", "from-date"];

const errorsOf = (errors: SfError[]) =>
  errors.map((e) => ({
    code: e.code,
    message: e.message,
    explained: explainError(e),
    notice: isNotice(e),
  }));

function failure(error: unknown): [{ detail: string }, 403 | 404 | 409 | 422 | 429 | 502] {
  if (error instanceof SimplefinProblem)
    return [{ detail: error.message }, error.status === 400 ? 422 : error.status];
  if (error instanceof LinkProblem) return [{ detail: error.message }, error.status];
  if (error instanceof OutOfRequests) return [{ detail: error.message }, 429];
  if (error instanceof RereadProblem) return [{ detail: error.message }, error.status];
  throw error;
}

const summarize = (results: ImportResult[]) => ({
  batches: results.length,
  staged: results.reduce((n, r) => n + r.batch.staged, 0),
  matched: results.reduce((n, r) => n + r.batch.matched, 0),
});

export function simplefinRoutes(
  api: Hono<Env>,
  deps: SimplefinDeps,
  owned: (user: string, book: string) => Promise<boolean>,
  jobs: Jobs
) {
  const { store, sealer } = deps;
  const ledgerFor = deps.ledgerFor;

  /** The caller's books' names, by ID (a link elsewhere names its book, if they're in it). */
  const bookNames = async (user: string) =>
    new Map((await ledgerFor(user).listBooks()).map((b) => [b.id, b.name]));

  /**
   * A connection as the caller sees it. Its owner sees everything (in a book, each account
   * saying whether it's shared with the book; without one, the books it's shared with); anyone
   * else, in a book it's shared with, only what's shared, and only the problems they'd be told
   * about (`errorsIn`).
   */
  const view = (user: string, c: Connection, books: Map<string, string>, book?: string) => {
    const mine = c.user_id === user;
    const share = book ? store.share(c.id, book) : undefined;
    const links = store.links(c.id);
    const errors = mine ? c.errors : errorsIn(c, share, user);
    return {
      id: c.id,
      host: c.host,
      created_at: c.created_at,
      last_sync_at: c.last_sync_at,
      requests_left: Math.max(0, store.budgetLeft(c)),
      requests_per_day: DAILY_BUDGET,
      mine,
      // Whose it is, when it isn't the caller's: their name.
      owner: mine ? null : (deps.db.userProfiles([c.user_id]).get(c.user_id)?.name ?? null),
      share: share
        ? { all: share.all, accounts: share.accounts, updated_at: share.updated_at }
        : null,
      ...(mine && !book
        ? {
            shares: store.sharesOf(c.id).map((s) => ({
              book_id: s.book_id,
              book_name: books.get(s.book_id) ?? null,
              all: s.all,
              accounts: s.accounts,
              updated_at: s.updated_at,
            })),
          }
        : {}),
      errors: errorsOf(errors),
      accounts: store
        .accounts(c.id)
        .filter((a) => mine || covers(share, a.account_id))
        .map((a) => {
          const link = links.find((l) => l.account_id === a.account_id);
          return {
            account_id: a.account_id,
            name: a.name,
            institution: a.institution,
            currency: a.currency,
            balance: a.balance,
            available_balance: a.available_balance,
            balance_date: a.balance_date,
            kind: kindOf(a),
            holdings: a.holdings.length,
            // Whether a brokerage's activity can be read (else its rows come in as cash).
            reader: kindOf(a) === "brokerage" ? (readerFor(a.institution)?.name ?? null) : null,
            ...(book ? { shared: covers(share, a.account_id) } : {}),
            link: link
              ? {
                  id: link.id,
                  book_id: link.book_id,
                  book_name: books.get(link.book_id) ?? null,
                  account: link.account,
                }
              : null,
          };
        }),
    };
  };

  /** The connection, if `book` sees it: the caller's own, or one shared with the book. */
  const visible = (user: string, book: string, id: string) => {
    const connection = store.connectionById(id);
    if (!connection) return undefined;
    return connection.user_id === user || store.share(id, book) ? connection : undefined;
  };

  api.get("/simplefin/connections", async (c) => {
    const user = c.get("user");
    const books = await bookNames(user);
    return c.json(store.connections(user).map((x) => view(user, x, books)));
  });

  /** Connect: claim the setup token, keep the access URL sealed, and list its accounts. */
  api.post("/simplefin/connections", async (c) => {
    const user = c.get("user");
    const { setup_token } = (await c.req.json().catch(() => ({}))) as { setup_token?: unknown };
    if (typeof setup_token !== "string" || !setup_token.trim())
      return c.json({ detail: "paste the setup token from SimpleFIN Bridge" }, 422);
    try {
      const access = await claim(setup_token, deps.policy, deps.fetcher);
      const connection = store.addConnection(
        user,
        sealer.seal(access),
        hostOf(access),
        randomSyncMinute()
      );
      // A day's window rather than balances only: holdings come only with transactions.
      await request(deps, connection, { start: Math.floor(Date.now() / 1000) - 86400 });
      return c.json(view(user, store.connection(user, connection.id)!, await bookNames(user)), 201);
    } catch (error) {
      return c.json(...failure(error));
    }
  });

  api.delete("/simplefin/connections/:id", (c) =>
    store.deleteConnection(c.get("user"), c.req.param("id"))
      ? c.body(null, 204)
      : c.json({ detail: "not found" }, 404)
  );

  api.post("/simplefin/connections/:id/sync", async (c) => {
    const user = c.get("user");
    const connection = store.connection(user, c.req.param("id"));
    if (!connection) return c.json({ detail: "not found" }, 404);
    try {
      const results = await syncConnection(deps, connection);
      return c.json({
        ...summarize(results),
        connection: view(user, store.connection(user, connection.id)!, await bookNames(user)),
      });
    } catch (error) {
      return c.json(...failure(error));
    }
  });

  // Connections in a book: the caller's own and those shared with it (shared connections)

  api.get("/books/:book/simplefin/connections", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    if (!(await owned(user, book))) return c.json({ detail: "not found" }, 404);
    const seen = new Map(store.connections(user).map((x) => [x.id, x]));
    for (const share of store.sharesIn(book)) {
      const connection = store.connectionById(share.connection_id);
      if (connection) seen.set(connection.id, connection);
    }
    const books = await bookNames(user);
    return c.json(
      [...seen.values()]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((x) => view(user, x, books, book))
    );
  });

  /** Share the caller's connection with the book (`{all, accounts, updated_at}`, null
   * `updated_at` when it isn't yet), or change what's shared. What's linked here stays shared. */
  api.put("/books/:book/simplefin/connections/:id/share", async (c) => {
    const { book, id } = c.req.param();
    const user = c.get("user");
    if (!(await owned(user, book))) return c.json({ detail: "not found" }, 404);
    const connection = store.connection(user, id);
    if (!connection)
      return visible(user, book, id)
        ? c.json({ detail: "only its owner can change what's shared" }, 403)
        : c.json({ detail: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.all !== "boolean")
      return c.json({ detail: "say whether it's all its accounts (all: true or false)" }, 422);
    if (
      !("updated_at" in body) ||
      (body.updated_at !== null && typeof body.updated_at !== "string")
    )
      return c.json({ detail: "send the updated_at you read (null if it isn't shared yet)" }, 422);
    const accounts = body.all ? [] : body.accounts;
    if (!Array.isArray(accounts) || !accounts.every((a) => typeof a === "string"))
      return c.json({ detail: "say which accounts, by their account_id" }, 422);
    const known = new Map(store.accounts(id).map((a) => [a.account_id, a]));
    if (accounts.some((a) => !known.has(a)))
      return c.json({ detail: "that isn't one of this connection's accounts" }, 422);
    if (!body.all) {
      const kept = new Set(accounts);
      const used = [...store.linksIn(book), ...store.attemptsIn(book)].find(
        (l) => l.connection_id === id && !kept.has(l.account_id)
      );
      if (used)
        return c.json(
          {
            detail: `${known.get(used.account_id)?.name ?? "An account"} is linked in this book: unlink it first`,
          },
          422
        );
    }
    try {
      store.putShare(id, book, { all: body.all, accounts }, body.updated_at as string | null);
    } catch (error) {
      if (error instanceof StaleShare) return c.json({ detail: error.message }, 409);
      throw error;
    }
    return c.json(view(user, connection, await bookNames(user), book));
  });

  /** Stop sharing the caller's connection with the book (`?updated_at=`): once nothing's linked. */
  api.delete("/books/:book/simplefin/connections/:id/share", async (c) => {
    const { book, id } = c.req.param();
    const user = c.get("user");
    if (!(await owned(user, book))) return c.json({ detail: "not found" }, 404);
    const connection = store.connection(user, id);
    if (!connection)
      return visible(user, book, id)
        ? c.json({ detail: "only its owner can change what's shared" }, 403)
        : c.json({ detail: "not found" }, 404);
    const updatedAt = c.req.query("updated_at");
    if (!updatedAt) return c.json({ detail: "send the updated_at you read" }, 422);
    if ([...store.linksIn(book), ...store.attemptsIn(book)].some((l) => l.connection_id === id))
      return c.json({ detail: "its accounts are linked in this book: unlink them first" }, 422);
    try {
      store.deleteShare(id, book, updatedAt);
    } catch (error) {
      if (error instanceof StaleShare) return c.json({ detail: error.message }, 409);
      throw error;
    }
    return c.body(null, 204);
  });

  /** Sync now, by any writer of a book the connection is shared with (it spends its owner's
   * requests, and brings in every book's links). */
  api.post("/books/:book/simplefin/connections/:id/sync", async (c) => {
    const { book, id } = c.req.param();
    const user = c.get("user");
    const connection = visible(user, book, id);
    if (!connection) return c.json({ detail: "not found" }, 404);
    try {
      const results = await syncConnection(deps, connection);
      return c.json({
        ...summarize(results),
        connection: view(user, store.connectionById(id)!, await bookNames(user), book),
      });
    } catch (error) {
      return c.json(...failure(error));
    }
  });

  // Links, in a book: any writer's, to accounts shared with it

  const linkInput = async (
    c: { req: { json(): Promise<unknown> } },
    user: string,
    book: string
  ) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const connection =
      typeof body.connection_id === "string" ? visible(user, book, body.connection_id) : undefined;
    if (!connection) throw new LinkProblem(404, "there's no such connection");
    if (typeof body.account_id !== "string") throw new LinkProblem(422, "say which bank account");
    if (!covers(store.share(connection.id, book), body.account_id))
      throw new LinkProblem(422, "that bank account isn't shared with this book");
    if (typeof body.account !== "string" || !/^[A-Z][\w-]*(:[\w-]+)+$/.test(body.account))
      throw new LinkProblem(422, "say which account in the book, by its full name");
    if (!MODES.includes(body.mode as LinkMode))
      throw new LinkProblem(422, `mode is one of ${MODES.join(", ")}`);
    return {
      user,
      connection,
      accountId: body.account_id,
      book,
      account: body.account,
      mode: body.mode as LinkMode,
      from: typeof body.from === "string" ? body.from : undefined,
    };
  };

  api.post("/books/:book/simplefin/links/preview", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    if (!(await owned(user, book))) return c.json({ detail: "not found" }, 404);
    try {
      return c.json((await plan(deps, await linkInput(c, user, book))).preview);
    } catch (error) {
      return c.json(...failure(error));
    }
  });

  api.post("/books/:book/simplefin/links", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    if (!(await owned(user, book))) return c.json({ detail: "not found" }, 404);
    try {
      const planned = await plan(deps, await linkInput(c, user, book));
      const link = await planned.apply();
      await pairTransfers({ db: deps.db, ledger: deps.ledgerFor(user), book });
      return c.json({ link, preview: planned.preview }, 201);
    } catch (error) {
      return c.json(...failure(error));
    }
  });

  // Link attempts: chosen now, fetched in the background, confirmed from their preview later.

  const attemptView = (a: Attempt) => ({
    id: a.id,
    connection_id: a.connection_id,
    account_id: a.account_id,
    account: a.account,
    mode: a.mode,
    from: a.from_date,
    state: a.state,
    preview: a.preview,
    error: a.error,
    updated_at: a.updated_at,
  });

  api.get("/books/:book/simplefin/attempts", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(store.attemptsIn(book).map(attemptView));
  });

  api.post("/books/:book/simplefin/attempts", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    if (!(await owned(user, book))) return c.json({ detail: "not found" }, 404);
    try {
      return c.json(attemptView(await attemptLink(deps, await linkInput(c, user, book))), 202);
    } catch (error) {
      return c.json(...failure(error));
    }
  });

  api.post("/books/:book/simplefin/attempts/:id/confirm", async (c) => {
    const { book, id } = c.req.param();
    const user = c.get("user");
    if (!(await owned(user, book))) return c.json({ detail: "not found" }, 404);
    const attempt = store.attemptById(id);
    if (!attempt || attempt.book_id !== book) return c.json({ detail: "not found" }, 404);
    try {
      return c.json({ link: await confirmAttempt(deps, attempt) }, 201);
    } catch (error) {
      return c.json(...failure(error));
    }
  });

  api.delete("/books/:book/simplefin/attempts/:id", async (c) => {
    const { book, id } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const attempt = store.attemptById(id);
    if (!attempt || attempt.book_id !== book) return c.json({ detail: "not found" }, 404);
    store.deleteAttempt(id);
    return c.body(null, 204);
  });

  api.delete("/books/:book/simplefin/links/:id", async (c) => {
    const { book, id } = c.req.param();
    const user = c.get("user");
    if (!(await owned(user, book))) return c.json({ detail: "not found" }, 404);
    const link = store.linkById(id);
    if (!link || link.book_id !== book) return c.json({ detail: "not found" }, 404);
    store.deleteLink(id);
    return c.body(null, 204);
  });

  /** Each linked account in the book: what its bank reports, and how syncing is going. */
  api.get("/books/:book/simplefin/status", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    if (!(await owned(user, book))) return c.json({ detail: "not found" }, 404);
    const status: Record<string, unknown> = {};
    const links = store.linksIn(book);
    const unconfirmed = links.length ? await ledgerFor(user).unconfirmed(book) : [];
    const notAtBank = (account: string, kind: LinkKind, from: string) => {
      const cash = cashAccountOf({ account, kind });
      // A divided account's parts too (M15), but not moves between them.
      const mine = unconfirmed.filter(
        (t) =>
          t.date >= from &&
          t.postings.some((p) => within(p.account, cash)) &&
          !isInternal(t.postings, cash)
      );
      const held = deps.db.claimed(
        book,
        cash,
        mine.map((t) => t.id),
        "simplefin"
      );
      return mine.filter((t) => !held.has(t.id)).map((t) => t.id);
    };
    for (const link of links) {
      const connection = store.connectionById(link.connection_id);
      const snapshot = store.account(link.connection_id, link.account_id);
      if (!connection || !snapshot) continue;
      status[link.account] = {
        link_id: link.id,
        connection_id: connection.id,
        institution: snapshot.institution,
        name: snapshot.name,
        kind: link.kind,
        reported: {
          balance: snapshot.balance,
          currency: snapshot.currency,
          balance_date: snapshot.balance_date,
        },
        last_sync_at: connection.last_sync_at,
        // Unconfirmed transactions of yours from the link's start that no bank row holds.
        not_at_bank: [...notAtBank(link.account, link.kind, link.starts_on)],
        // Only what's about this account (the bell has the rest).
        errors: errorsOf(connection.errors.filter((e) => concerns(e, snapshot))),
        comparison: await bankComparison(deps.db, store, ledgerFor(user), link).catch(() => null),
        updated_at: link.updated_at,
        ...(link.kind === "brokerage"
          ? {
              reader: readerFor(snapshot.institution)?.name ?? null,
              dividends: dividendsOf(link, snapshot),
              dividends_chosen: link.dividends !== null,
              activity: activityOf(deps, link),
            }
          : {}),
      };
    }
    return c.json(status);
  });

  /** A brokerage link's settings: where its dividends go (null: the default for its kind),
   * against the version read. */
  api.patch("/books/:book/simplefin/links/:id", async (c) => {
    const { book, id } = c.req.param();
    const user = c.get("user");
    const link = store.linkById(id);
    if (!(await owned(user, book)) || !link || link.book_id !== book)
      return c.json({ detail: "not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as {
      dividends?: unknown;
      updated_at?: unknown;
    } | null;
    const dividends = body?.dividends ?? null;
    if (typeof body?.updated_at !== "string")
      return c.json({ detail: "send the updated_at you read" }, 422);
    if (dividends !== null && (typeof dividends !== "string" || !/^Income:\S+$/.test(dividends)))
      return c.json(
        { detail: "dividends go to an income account (Income:…), or null for the default" },
        422
      );
    if (link.kind !== "brokerage") return c.json({ detail: "only a brokerage has dividends" }, 422);
    const changed = store.setDividends(link, dividends, body.updated_at);
    if (!changed) return c.json({ detail: "this link changed since you read it" }, 409);
    return c.json({ id: changed.id, dividends: changed.dividends, updated_at: changed.updated_at });
  });

  /** What reading a brokerage link again would do (from what's fetched: no requests). */
  api.post("/books/:book/simplefin/links/:id/reread/preview", async (c) => {
    const { book, id } = c.req.param();
    const user = c.get("user");
    const link = store.linkById(id);
    if (!(await owned(user, book)) || !link || link.book_id !== book)
      return c.json({ detail: "not found" }, 404);
    try {
      return c.json((await planReread(deps, link)).preview);
    } catch (error) {
      return c.json(...failure(error));
    }
  });

  /** Read a brokerage link again (see reread.ts). It can take a while (prices are fetched for
   * a long history): with `Prefer: respond-async`, it runs as a job to ask after. */
  api.post("/books/:book/simplefin/links/:id/reread", async (c) => {
    const { book, id } = c.req.param();
    const user = c.get("user");
    const link = store.linkById(id);
    if (!(await owned(user, book)) || !link || link.book_id !== book)
      return c.json({ detail: "not found" }, 404);
    const work = async (step: (s: string) => void) => {
      step("planning");
      const planned = await planReread(deps, link);
      step("reading");
      const done = await planned.apply();
      await pairTransfers({ db: deps.db, ledger: ledgerFor(user), book });
      return done;
    };
    if (wantsAsync(c.req.header("prefer"))) {
      const job = jobs.start(book, user, work, (error) =>
        error instanceof RereadProblem || error instanceof LedgerError
          ? { status: error.status, detail: error.message }
          : { status: 500, detail: `reading it again failed (${(error as Error).message})` }
      );
      c.header("location", `/api/app/v1/books/${book}/jobs/${job}`);
      return c.json({ id: job, state: "running", step: null }, 202);
    }
    try {
      return c.json(await work(() => {}));
    } catch (error) {
      if (error instanceof LedgerError)
        return c.json({ detail: error.message }, error.status as 409);
      return c.json(...failure(error));
    }
  });
}

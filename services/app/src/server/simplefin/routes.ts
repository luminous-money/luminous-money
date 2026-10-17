/**
 * Bank feeds' part of the app API.
 *
 * - **Connections are the user's** (`/simplefin/connections`): connect with a setup token, list
 *   (each with its accounts' last snapshot and where each is linked), sync now, disconnect.
 * - **Links go into a book** (`/books/:book/simplefin/...`): preview and make a link (mode
 *   `new`, `reconcile`, `start-over` or `from-date`), unlink, and what each linked account's bank
 *   reports (for account pages and home cards).
 * - `DELETE /me` forgets the user's connections (auth calls it when an account is deleted).
 *
 * The access URL never leaves the server: connections show their host.
 */
import type { Hono } from "hono";

import type { ImportResult } from "../../shared/imports.js";
import { claim, explainError, hostOf, isNotice, SimplefinProblem, type SfError } from "./client.js";
import { kindOf, LinkProblem, plan, type LinkMode } from "./link.js";
import { attemptLink, confirmAttempt } from "./attempts.js";
import type { Attempt, Connection, LinkKind } from "./store.js";
import { DAILY_BUDGET } from "./store.js";
import {
  cashAccountOf,
  OutOfRequests,
  randomSyncMinute,
  request,
  syncConnection,
  type SimplefinDeps,
} from "./sync.js";
import { pairTransfers } from "../transfers.js";

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
  owned: (user: string, book: string) => Promise<boolean>
) {
  const { store, sealer } = deps;
  const ledgerFor = deps.ledgerFor;

  const view = async (user: string, c: Connection) => {
    const links = store.links(c.id);
    const books = new Map((await ledgerFor(user).listBooks()).map((b) => [b.id, b.name]));
    return {
      id: c.id,
      host: c.host,
      created_at: c.created_at,
      last_sync_at: c.last_sync_at,
      requests_left: Math.max(0, store.budgetLeft(c)),
      requests_per_day: DAILY_BUDGET,
      errors: errorsOf(c.errors),
      accounts: store.accounts(c.id).map((a) => {
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

  api.get("/simplefin/connections", async (c) => {
    const user = c.get("user");
    return c.json(await Promise.all(store.connections(user).map((x) => view(user, x))));
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
      return c.json(await view(user, store.connection(user, connection.id)!), 201);
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
        connection: await view(user, store.connection(user, connection.id)!),
      });
    } catch (error) {
      return c.json(...failure(error));
    }
  });

  api.delete("/me", (c) => {
    store.forgetUser(c.get("user"));
    return c.body(null, 204);
  });

  // Links, in a book

  const linkInput = async (
    c: { req: { json(): Promise<unknown> } },
    user: string,
    book: string
  ) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const connection =
      typeof body.connection_id === "string"
        ? store.connection(user, body.connection_id)
        : undefined;
    if (!connection) throw new LinkProblem(404, "there's no such connection");
    if (typeof body.account_id !== "string") throw new LinkProblem(422, "say which bank account");
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
    const attempt = store.attempt(user, id);
    if (!attempt || attempt.book_id !== book) return c.json({ detail: "not found" }, 404);
    try {
      return c.json({ link: await confirmAttempt(deps, attempt) }, 201);
    } catch (error) {
      return c.json(...failure(error));
    }
  });

  api.delete("/books/:book/simplefin/attempts/:id", (c) => {
    const { book, id } = c.req.param();
    const attempt = store.attempt(c.get("user"), id);
    if (!attempt || attempt.book_id !== book) return c.json({ detail: "not found" }, 404);
    store.deleteAttempt(id);
    return c.body(null, 204);
  });

  api.delete("/books/:book/simplefin/links/:id", async (c) => {
    const { book, id } = c.req.param();
    const user = c.get("user");
    const link = store.link(user, id);
    if (!link || link.book_id !== book) return c.json({ detail: "not found" }, 404);
    store.deleteLink(user, id);
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
      const mine = unconfirmed.filter(
        (t) => t.date >= from && t.postings.some((p) => p.account === cash)
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
      const connection = store.connection(link.user_id, link.connection_id);
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
        errors: errorsOf(
          connection.errors.filter((e) => !e.account_id || e.account_id === link.account_id)
        ),
      };
    }
    return c.json(status);
  });
}

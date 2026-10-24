/**
 * The app API, at /api/app/v1. Every route needs the caller (X-User-Id, set by Traefik after
 * checking the session), and acts as them toward the ledger, so book ownership is the ledger's
 * call: a book the caller doesn't own answers 404 here too.
 */
import { Hono, type Context, type Next } from "hono";

import type { CsvProfile } from "@luminous-money/csv-import";

import type { AppDb, Invite } from "./db.js";
import { ImportProblem, importFile } from "./imports.js";
import { fetchPrices } from "./prices.js";
import { assignRow, confirmRow, MatchProblem, proposedMatches } from "./matches.js";
import {
  breakdownReport,
  cashFlowReport,
  largestReport,
  netWorthReport,
  ReportProblem,
  spendingReport,
  typicalReport,
} from "./reports.js";
import { finish, ReconcileProblem, reconcileView, saveDraft } from "./reconcile.js";
import type { AiPort } from "./ai.js";
import { captureReceipt, ReceiptProblem } from "./receipts.js";
import type { System } from "./system.js";
import { pairAfterImport, pairedTransfers, rejectTransfer, TransferProblem } from "./transfers.js";
import { UPCOMING_DAYS, type ScheduleIn, type SchedulePatch } from "../shared/schedule.js";
import { StaleVersion } from "./db.js";
import {
  createSchedule,
  editSchedule,
  runSchedules,
  ScheduleProblem,
  bookToday,
  upcomingOccurrences,
  view,
} from "./schedules.js";
import type { Categorizer } from "./categorize/types.js";
import { ruleProblem } from "./categorize/rules.js";
import { applyRule, coveredBy, settle, suggestUnconfirmed } from "./categorize/service.js";
import type { CategoryRuleIn, CategoryRulePatch } from "../shared/rules.js";
import { LedgerError, type Book, type DivideIn, type LedgerPort, type Member } from "./ledger.js";
import { simplefinRoutes } from "./simplefin/routes.js";
import type { SimplefinDeps } from "./simplefin/sync.js";

type Env = { Variables: { user: string } };

/** Whether `zone` is an IANA time zone this runtime knows. */
function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** What bank feeds need beyond the rest (simplefin/). */
export type SimplefinServices = Pick<
  SimplefinDeps,
  "store" | "sealer" | "policy" | "fetcher" | "clock"
>;

export function createApi({
  db,
  ledgerFor,
  categorizers = [],
  simplefin,
  aiFor,
  system,
}: {
  db: AppDb;
  ledgerFor: (userId: string) => LedgerPort;
  /** The ai service as the user (M16); without it, receipts are made unread. */
  aiFor?: (userId: string) => AiPort;
  /** The categorization chain, in order (see categorize/chain.ts). */
  categorizers?: Categorizer[];
  simplefin?: SimplefinServices;
  /** The system page's facts, and who may see them: admins' emails (lowercase). */
  system?: { facts: System; admins: Set<string> };
}) {
  const api = new Hono<Env>().basePath("/api/app/v1");

  api.get("/health", (c) => c.json({ status: "ok" }));

  const caller = async (c: Context<Env>, next: Next) => {
    const user = c.req.header("x-user-id");
    if (!user) return c.json({ detail: "not logged in" }, 401);
    c.set("user", user);
    // Who they are, for the people they share books with (M13).
    const name = c.req.header("x-user-name");
    const email = c.req.header("x-user-email");
    if (name && email) {
      try {
        db.rememberProfile({
          user_id: user,
          name: decodeURIComponent(name),
          email: decodeURIComponent(email),
        });
      } catch {
        // a malformed header: nothing to remember
      }
    }
    return next();
  };
  api.use("/books", caller);
  api.use("/books/*", caller);
  api.use("/simplefin/*", caller);
  api.use("/invites/*", caller);
  api.use("/me", caller);
  api.use("/system", caller);
  api.use("/system/*", caller);

  // The system page (production readiness): admins only, named by email in the config and
  // confirmed. Anyone else is told there's nothing here.
  const isAdmin = (c: Context<Env>) => {
    if (!system || c.req.header("x-user-email-verified") !== "true") return false;
    try {
      const email = decodeURIComponent(c.req.header("x-user-email") ?? "").toLowerCase();
      return !!email && system.admins.has(email);
    } catch {
      return false;
    }
  };
  api.get("/system/access", (c) => c.json({ admin: isAdmin(c) }));
  api.get("/system", async (c) =>
    isAdmin(c) ? c.json(await system!.facts.info()) : c.json({ detail: "not found" }, 404)
  );
  api.post("/system/check", async (c) => {
    if (!isAdmin(c)) return c.json({ detail: "not found" }, 404);
    await system!.facts.check();
    return c.json(await system!.facts.info());
  });

  /** The caller's role in the book (owner, manage, write, read), or undefined if none. */
  const roleIn = async (user: string, book: string) =>
    (await ledgerFor(user).book(book))?.role ?? undefined;
  const RANKS = ["read", "write", "manage", "owner"];
  const atLeast = (role: string | undefined, need: string) =>
    role !== undefined && RANKS.indexOf(role) >= RANKS.indexOf(need);

  // Changing a book needs a member's write (M13); reading, any member's (each route checks).
  // Stars are personal, so a reader may star too; members and invitations check their own
  // (leaving is anyone's; the rest, a manager's).
  api.use("/books/:book/*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    if (/\/(stars|members|invites)(\/|$)/.test(c.req.path)) return next();
    const role = await roleIn(c.get("user"), c.req.param("book")!);
    if (!role) return c.json({ detail: "not found" }, 404);
    if (!atLeast(role, "write"))
      return c.json({ detail: "you can see this book, but not change it" }, 403);
    return next();
  });

  /** 404 unless the caller owns the book. */
  const owned = async (user: string, book: string) =>
    (await ledgerFor(user).book(book)) !== undefined;

  if (simplefin) simplefinRoutes(api, { ...simplefin, db, ledgerFor, categorizers }, owned);

  const isProfile = (p: unknown): p is CsvProfile => {
    const profile = p as CsvProfile | undefined;
    return (
      Array.isArray(profile?.columns) &&
      typeof profile.date?.column === "number" &&
      !!profile.amount
    );
  };

  /** An account's CSV profiles (its bank's file formats), oldest first; empty if none yet. */
  api.get("/books/:book/profiles/:account", async (c) => {
    const { book, account } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.profiles(book, account));
  });

  /** Replace all of an account's CSV profiles with the ones given. */
  api.put("/books/:book/profiles/:account", async (c) => {
    const { book, account } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const profiles = (await c.req.json()) as unknown;
    if (!Array.isArray(profiles) || !profiles.every(isProfile)) {
      return c.json({ detail: "send a list of CSV profiles" }, 422);
    }
    db.replaceProfiles(book, account, profiles);
    return c.json(db.profiles(book, account));
  });

  /** Add a CSV profile to an account's. */
  api.post("/books/:book/profiles/:account", async (c) => {
    const { book, account } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const profile = (await c.req.json()) as unknown;
    if (!isProfile(profile)) return c.json({ detail: "that isn't a CSV profile" }, 422);
    db.addProfile(book, account, profile);
    return c.json(db.profiles(book, account), 201);
  });

  /** The caller's starred accounts in the book: what their home page shows. */
  api.get("/books/:book/stars", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.stars(c.get("user"), book));
  });

  api.put("/books/:book/stars/:account", async (c) => {
    const { book, account } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    db.star(c.get("user"), book, account);
    return c.json(db.stars(c.get("user"), book));
  });

  api.delete("/books/:book/stars/:account", async (c) => {
    const { book, account } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    db.unstar(c.get("user"), book, account);
    return c.json(db.stars(c.get("user"), book));
  });

  /** Import a file: multipart form data with `account` and `file`. */
  api.post("/books/:book/imports", async (c) => {
    const { book } = c.req.param();
    const form = await c.req.parseBody();
    const account = form["account"];
    const file = form["file"];
    if (typeof account !== "string" || !(file instanceof File)) {
      return c.json({ detail: "send an account and a file" }, 422);
    }
    try {
      const ledger = ledgerFor(c.get("user"));
      const result = await importFile({
        db,
        ledger,
        book,
        account,
        filename: file.name,
        text: await file.text(),
        userId: c.get("user"),
        categorizers,
      });
      return c.json(await pairAfterImport({ db, ledger, book }, result), 201);
    } catch (error) {
      if (error instanceof ImportProblem) {
        return c.json(
          { detail: error.message, code: error.code },
          error.code === "no-such-book" ? 404 : 409
        );
      }
      throw error;
    }
  });

  /** Capture a receipt (M16): multipart, with `file` and the hints (`account`, `itemize`
   * yes/no, `total` as stored, `date`, `payee`, `note`). Read by the ai service if the book has
   * it set up, staged unconfirmed with the receipt attached; made from the hints otherwise. */
  api.post("/books/:book/receipts", async (c) => {
    const { book } = c.req.param();
    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) return c.json({ detail: "send the receipt as `file`" }, 422);
    const text = (key: string) => {
      const value = form[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    const total = text("total");
    if (total && !/^-?\d+(\.\d+)?$/.test(total))
      return c.json({ detail: "the total is a number, like -12.34" }, 422);
    try {
      return c.json(
        await captureReceipt({
          ledger: ledgerFor(c.get("user")),
          ai: aiFor?.(c.get("user")),
          db,
          categorizers,
          book,
          file: {
            name: file.name,
            type: file.type,
            bytes: new Uint8Array(await file.arrayBuffer()),
          },
          hints: {
            account: text("account"),
            total,
            date: text("date"),
            payee: text("payee"),
            note: text("note"),
            itemize: text("itemize") === null ? null : text("itemize") === "yes",
          },
          today: bookToday(db, book),
        }),
        201
      );
    } catch (error) {
      if (error instanceof ReceiptProblem) return c.json({ detail: error.message }, error.status);
      return c.json(...ledgerStatus(error));
    }
  });

  // Reports (M12): datasets from the ledger's postings, ready to draw. `on` is the caller's
  // today (the book's, if not given).

  const reportOn = (c: Context, book: string) => {
    const on = c.req.query("on");
    return on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : bookToday(db, book);
  };
  const count = (value: string | undefined, low: number, high: number, fallback: number) => {
    const n = Number(value ?? fallback);
    return Number.isInteger(n) && n >= low && n <= high ? n : fallback;
  };
  const report =
    (run: (c: Context, book: string, ledger: LedgerPort) => Promise<unknown>) =>
    async (c: Context) => {
      const { book } = c.req.param() as { book: string };
      if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
      try {
        return c.json(await run(c, book, ledgerFor(c.get("user"))));
      } catch (error) {
        if (error instanceof ReportProblem) return c.json({ detail: error.message }, error.status);
        throw error;
      }
    };

  /** This month's spending by day, against the budget and a simulated month. */
  api.get(
    "/books/:book/reports/spending",
    report((c, book, ledger) => spendingReport(ledger, book, reportOn(c, book)))
  );
  /** Income and expenses for each of the last `months` (6) months. */
  api.get(
    "/books/:book/reports/cash-flow",
    report((c, book, ledger) =>
      cashFlowReport(ledger, book, reportOn(c, book), count(c.req.query("months"), 1, 24, 6))
    )
  );
  /** The largest categories: `side` expenses or income, `depth`, `slices`, `window` (average
   * over 6 months, or this month), or the accounts just under `of`. */
  api.get(
    "/books/:book/reports/breakdown",
    report((c, book, ledger) =>
      breakdownReport(ledger, book, reportOn(c, book), {
        side: c.req.query("side") === "income" ? "income" : "expenses",
        of: c.req.query("of") || undefined,
        depth: count(c.req.query("depth"), 1, 4, 1),
        slices: count(c.req.query("slices"), 2, 12, 6),
        window: c.req.query("window") === "month" ? "month" : "average",
      })
    )
  );
  /** This month's largest expenses. */
  api.get(
    "/books/:book/reports/largest",
    report((c, book, ledger) =>
      largestReport(ledger, book, reportOn(c, book), count(c.req.query("limit"), 1, 50, 8))
    )
  );
  /** Assets, liabilities and net worth at each of the last `months` (24) month ends. */
  api.get(
    "/books/:book/reports/net-worth",
    report((c, book, ledger) =>
      netWorthReport(ledger, book, reportOn(c, book), count(c.req.query("months"), 2, 120, 24))
    )
  );
  /** What an expense or income account's week, month and year typically come to. */
  api.get(
    "/books/:book/reports/typical",
    report((c, book, ledger) =>
      typicalReport(
        ledger,
        book,
        reportOn(c, book),
        c.req.query("account") ?? "",
        db.settings(book)?.week_start ?? 1
      )
    )
  );

  /** Transfers paired in review, each with the two transactions it was made of. */
  api.get("/books/:book/transfers", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(pairedTransfers(db, book));
  });

  /** Reject a paired transfer: the two it was made of come back in its place. */
  api.post("/books/:book/transfers/:transaction/reject", async (c) => {
    const { book, transaction } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    try {
      const restored = await rejectTransfer({
        db,
        ledger: ledgerFor(c.get("user")),
        book,
        transactionId: transaction,
      });
      return c.json({ restored });
    } catch (error) {
      if (error instanceof TransferProblem) return c.json({ detail: error.message }, error.status);
      throw error;
    }
  });

  /** Rows whose match is up for review, with their candidates and who holds them. */
  api.get("/books/:book/matches", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(proposedMatches(db, book));
  });

  const matchError = (error: unknown) => {
    if (!(error instanceof MatchProblem)) throw error;
    const status = { "not-found": 404, "not-proposed": 409, "not-a-candidate": 422 } as const;
    return [{ detail: error.message, code: error.code }, status[error.code]] as const;
  };

  /** Set a row's transaction: `{transaction}`, one of its candidates (swapping if another row
   * holds it), or null for a new one ("not a match"). */
  api.post("/books/:book/imports/:batch/rows/:line/assign", async (c) => {
    const { book, batch, line } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { transaction?: unknown };
    if (body.transaction !== null && typeof body.transaction !== "string")
      return c.json({ detail: "send a transaction ID, or null for a new one" }, 422);
    try {
      await assignRow({
        db,
        ledger: ledgerFor(c.get("user")),
        book,
        row: { batch, line: Number(line) },
        to: body.transaction,
      });
      return c.json(proposedMatches(db, book));
    } catch (error) {
      return c.json(...matchError(error));
    }
  });

  /** Confirm a row's match: its transaction is final, and it leaves review. */
  api.post("/books/:book/imports/:batch/rows/:line/confirm", async (c) => {
    const { book, batch, line } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    try {
      await confirmRow(db, ledgerFor(c.get("user")), book, { batch, line: Number(line) });
      return c.json(proposedMatches(db, book));
    } catch (error) {
      return c.json(...matchError(error));
    }
  });

  // Categorization: rules, proposals, suggesting, acceptance

  /** The book, for categorizer requests (404 unless the caller owns it). */
  const bookOf = async (user: string, book: string) => {
    const found = await ledgerFor(user).book(book);
    return found && { id: found.id, name: found.name };
  };

  api.get("/books/:book/rules", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.rules(book));
  });

  /** Create a rule. Says how many unconfirmed transactions it covers, to offer re-applying. */
  api.post("/books/:book/rules", async (c) => {
    const { book } = c.req.param();
    const info = await bookOf(c.get("user"), book);
    if (!info) return c.json({ detail: "not found" }, 404);
    const ledger = ledgerFor(c.get("user"));
    const input = (await c.req.json().catch(() => null)) as CategoryRuleIn | null;
    const problem = ruleProblem(input, await ledger.accounts(book));
    if (problem) return c.json({ detail: problem }, 422);
    const id = db.addRule(book, {
      ...input!,
      name: input!.name.trim(),
      payee: input!.payee || null,
      part: input!.part || null,
    });
    const rule = db.rule(book, id)!;
    const covers = (await coveredBy({ db, ledger, book: info }, rule)).length;
    return c.json({ ...rule, covers }, 201);
  });

  api.get("/books/:book/rules/:id", async (c) => {
    const { book, id } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const rule = db.rule(book, id);
    return rule ? c.json(rule) : c.json({ detail: "not found" }, 404);
  });

  /** Change a rule (only the fields sent), against `updated_at`. Says how many unconfirmed
   * transactions it now covers, to offer re-applying. */
  api.patch("/books/:book/rules/:id", async (c) => {
    const { book, id } = c.req.param();
    const info = await bookOf(c.get("user"), book);
    if (!info) return c.json({ detail: "not found" }, 404);
    const current = db.rule(book, id);
    if (!current) return c.json({ detail: "not found" }, 404);
    const ledger = ledgerFor(c.get("user"));
    const patch = (await c.req.json().catch(() => null)) as CategoryRulePatch | null;
    if (!patch?.updated_at) return c.json({ detail: "send the updated_at you read" }, 422);
    const { updated_at, ...changes } = patch;
    const merged = { ...current, ...changes };
    const problem = ruleProblem(merged, await ledger.accounts(book));
    if (problem) return c.json({ detail: problem }, 422);
    try {
      db.updateRule(book, id, updated_at, {
        name: merged.name.trim(),
        conditions: merged.conditions,
        account: merged.account,
        payee: merged.payee || null,
        part: merged.part || null,
        auto_confirm: merged.auto_confirm,
      });
    } catch (error) {
      if (error instanceof StaleVersion) return c.json({ detail: error.message }, 409);
      throw error;
    }
    const rule = db.rule(book, id)!;
    const covers = (await coveredBy({ db, ledger, book: info }, rule)).length;
    return c.json({ ...rule, covers });
  });

  api.delete("/books/:book/rules/:id", async (c) => {
    const { book, id } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    if (!db.rule(book, id)) return c.json({ detail: "not found" }, 404);
    try {
      db.deleteRule(book, id, c.req.query("updated_at") ?? "");
    } catch (error) {
      if (error instanceof StaleVersion) return c.json({ detail: error.message }, 409);
      throw error;
    }
    return c.body(null, 204);
  });

  /** Re-apply a rule to the unconfirmed transactions it covers that haven't been touched. */
  api.post("/books/:book/rules/:id/apply", async (c) => {
    const { book, id } = c.req.param();
    const info = await bookOf(c.get("user"), book);
    const rule = info && db.rule(book, id);
    if (!info || !rule) return c.json({ detail: "not found" }, 404);
    const applied = await applyRule({ db, ledger: ledgerFor(c.get("user")), book: info }, rule);
    return c.json({ applied });
  });

  /** Proposals for transactions still waiting: transaction ID to what was proposed. */
  api.get("/books/:book/proposals", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(
      Object.fromEntries(
        db.openProposals(book).map((p) => [p.transaction_id, db.proposalOf(p.transaction_id)])
      )
    );
  });

  /** Record whether a confirmed transaction kept its proposal (the PWA calls this on confirm). */
  api.post("/books/:book/proposals/:transaction/settle", async (c) => {
    const { book, transaction } = c.req.param();
    const info = await bookOf(c.get("user"), book);
    if (!info) return c.json({ detail: "not found" }, 404);
    const settled = await settle({
      db,
      ledger: ledgerFor(c.get("user")),
      book: info,
      categorizers,
      transaction,
    });
    return settled
      ? c.json({ accepted: settled.accepted, payee_accepted: settled.payee_accepted })
      : c.json({ detail: "no proposal" }, 404);
  });

  /** "Suggest categories" for unconfirmed transactions not yet categorized (`?account=`: only
   * those from that account and its subaccounts). */
  api.post("/books/:book/suggest", async (c) => {
    const { book } = c.req.param();
    const info = await bookOf(c.get("user"), book);
    if (!info) return c.json({ detail: "not found" }, 404);
    const suggested = await suggestUnconfirmed({
      db,
      ledger: ledgerFor(c.get("user")),
      book: info,
      categorizers,
      account: c.req.query("account") || undefined,
    });
    return c.json({ suggested });
  });

  /** The categorizers, in chain order, with how often their proposals were accepted. */
  api.get("/books/:book/categorizers", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const stats = new Map(db.acceptance(book).map((s) => [s.categorizer, s]));
    return c.json(
      categorizers.map((cat) => ({
        name: cat.name,
        settled: stats.get(cat.name)?.settled ?? 0,
        accepted: stats.get(cat.name)?.accepted ?? 0,
      }))
    );
  });

  // Books: the ledger's, with what `app` keeps about each (its time zone). Creating one sets
  // its time zone too, and deleting one forgets everything kept here about it.

  const withSettings = (book: Book) => ({ ...book, time_zone: db.timeZone(book.id) ?? null });
  const ledgerStatus = (error: unknown) => {
    if (error instanceof LedgerError && [403, 404, 409, 422].includes(error.status))
      return [{ detail: error.message }, error.status as 403 | 404 | 409 | 422] as const;
    throw error;
  };

  api.get("/books", async (c) => {
    const books = await ledgerFor(c.get("user")).listBooks();
    return c.json(books.map(withSettings));
  });

  api.post("/books", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: unknown;
      time_zone?: unknown;
      text?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ detail: "name the book" }, 422);
    if (typeof body.time_zone !== "string" || !isTimeZone(body.time_zone))
      return c.json({ detail: "send a time zone, like America/Chicago" }, 422);
    if (body.text !== undefined && body.text !== null && typeof body.text !== "string")
      return c.json({ detail: "text is Beancount, as a string" }, 422);
    try {
      const book = await ledgerFor(c.get("user")).createBook(name, body.text ?? undefined);
      db.setTimeZone(book.id, body.time_zone, c.get("user"));
      return c.json(withSettings(book), 201);
    } catch (error) {
      return c.json(...ledgerStatus(error));
    }
  });

  api.delete("/books/:book", async (c) => {
    const { book } = c.req.param();
    const updatedAt = c.req.query("updated_at");
    if (!updatedAt) return c.json({ detail: "send the updated_at you read" }, 422);
    try {
      await ledgerFor(c.get("user")).deleteBook(book, updatedAt);
    } catch (error) {
      return c.json(...ledgerStatus(error));
    }
    db.forgetBook(book);
    await aiFor?.(c.get("user")).forgetBook(book);
    return c.body(null, 204);
  });

  // The chart of accounts (M10): renaming, archiving and deleting go through here, so what
  // `app` keeps by account name follows the ledger (the ledger first, then `app`, in one
  // transaction, as for deleting books).

  const accountChange = async (
    c: Context<Env>,
    change: (ledger: LedgerPort, book: string, account: string) => Promise<Response>
  ) => {
    const { book } = c.req.param() as { book: string };
    const account = c.req.param("account")!;
    try {
      return await change(ledgerFor(c.get("user")), book, account);
    } catch (error) {
      return c.json(...ledgerStatus(error));
    }
  };

  api.post("/books/:book/accounts/:account/rename", (c) =>
    accountChange(c, async (ledger, book, account) => {
      const { to, updated_at } = (await c.req.json().catch(() => ({}))) as {
        to?: unknown;
        updated_at?: unknown;
      };
      if (typeof to !== "string") return c.json({ detail: "send the new name as `to`" }, 422);
      const renamed = await ledger.renameAccount(
        book,
        account,
        to,
        typeof updated_at === "string" ? updated_at : undefined
      );
      db.renameAccount(book, account, to);
      return c.json(renamed);
    })
  );

  api.post("/books/:book/accounts/:account/archive", (c) =>
    accountChange(c, async (ledger, book, account) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        date?: string;
        transfer_to?: string;
        updated_at?: string;
      };
      const closed = await ledger.archiveAccount(book, account, body);
      db.unlinkAccounts(book, [account, ...closed]); // an archived account's bank feed stops
      return c.json(closed);
    })
  );

  api.post("/books/:book/accounts/:account/unarchive", (c) =>
    accountChange(c, async (ledger, book, account) =>
      c.json(await ledger.unarchiveAccount(book, account))
    )
  );

  api.delete("/books/:book/accounts/:account", (c) =>
    accountChange(c, async (ledger, book, account) => {
      const substitute = c.req.query("substitute") || undefined;
      const deleted = await ledger.deleteAccount(
        book,
        account,
        substitute,
        c.req.query("updated_at") || undefined
      );
      db.mergeAccounts(book, deleted, substitute ?? null);
      return c.json(deleted);
    })
  );

  /** Divide an asset or liability account (M15): `{main, parts: [{name, amount}], date,
   * updated_at}`. It becomes a divided account of the same name, its history in its main part;
   * what `app` keeps that posts to it follows to the main part. */
  api.post("/books/:book/accounts/:account/divide", (c) =>
    accountChange(c, async (ledger, book, account) => {
      const body = (await c.req.json().catch(() => ({}))) as DivideIn;
      const divided = await ledger.divide(book, account, body);
      db.divideAccount(book, account, divided.main_part!);
      return c.json(divided);
    })
  );

  /** Make an account a divided account (M14: one real account its sub-accounts divide), or not:
   * `{divided, updated_at}`. Refused while an account under it is linked to a bank on its own. */
  api.post("/books/:book/accounts/:account/divided", (c) =>
    accountChange(c, async (ledger, book, account) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        divided?: unknown;
        updated_at?: unknown;
      };
      if (typeof body.divided !== "boolean")
        return c.json({ detail: "send `divided`: true or false" }, 422);
      const linked = simplefin?.store
        .linksIn(book)
        .find((l) => l.account.startsWith(`${account}:`));
      if (body.divided && linked)
        return c.json(
          { detail: `${linked.account} is linked to a bank on its own: unlink it first` },
          409
        );
      return c.json(
        await ledger.setAccount(book, account, {
          divided: body.divided,
          updated_at: typeof body.updated_at === "string" ? body.updated_at : "",
        })
      );
    })
  );

  // Reconciliation (M14): the Reconcile screen's view (with what starts ticked and any draft),
  // saving it for later, and finishing. History and undo are the ledger's own.

  const reconcileDeps = (c: Context<Env>, book: string) => ({
    db,
    ledger: ledgerFor(c.get("user")),
    store: simplefin?.store,
    book,
  });
  const reconcileError = (c: Context<Env>, error: unknown) => {
    if (error instanceof ReconcileProblem) return c.json({ detail: error.message }, error.status);
    return c.json(...ledgerStatus(error));
  };

  api.get("/books/:book/reconcile/:account", async (c) => {
    const { book, account } = c.req.param();
    const through = c.req.query("through");
    try {
      return c.json(
        await reconcileView(
          reconcileDeps(c, book),
          account,
          through && /^\d{4}-\d{2}-\d{2}$/.test(through) ? through : undefined
        )
      );
    } catch (error) {
      return reconcileError(c, error);
    }
  });

  /** Save for later: `{statement_date, balance, ticked, updated_at}` (the draft's version read;
   * null when there wasn't one). */
  api.put("/books/:book/reconcile/:account/draft", async (c) => {
    const { book, account } = c.req.param();
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === "string" && v ? v : null);
    if (!Array.isArray(body.ticked) || !body.ticked.every((t) => typeof t === "string"))
      return c.json({ detail: "send what's ticked, as transaction IDs" }, 422);
    try {
      return c.json(
        saveDraft(
          db,
          book,
          c.get("user"),
          {
            account,
            statement_date: text(body.statement_date),
            balance: text(body.balance),
            ticked: body.ticked as string[],
          },
          text(body.updated_at)
        )
      );
    } catch (error) {
      return reconcileError(c, error);
    }
  });

  api.delete("/books/:book/reconcile/:account/draft", (c) => {
    const { book, account } = c.req.param();
    db.discardDraft(book, account);
    return c.body(null, 204);
  });

  /** Finish: `{statement_date, balance, transactions}`; refused (422) unless it balances. */
  api.post("/books/:book/reconcile/:account", async (c) => {
    const { book, account } = c.req.param();
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (
      typeof body.statement_date !== "string" ||
      typeof body.balance !== "string" ||
      !Array.isArray(body.transactions)
    )
      return c.json({ detail: "send the statement's date and balance, and what's ticked" }, 422);
    try {
      return c.json(
        await finish(reconcileDeps(c, book), account, {
          statement_date: body.statement_date,
          balance: body.balance,
          transactions: body.transactions as string[],
        }),
        201
      );
    } catch (error) {
      return reconcileError(c, error);
    }
  });

  // Book settings (kept in `app`): the book's time zone, which decides "today" for its
  // schedules, and the day its weeks start (where weekly budgets start by default).

  api.get("/books/:book/settings", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.settings(book) ?? { time_zone: null, week_start: 1, updated_at: null });
  });

  /** Change some settings (`time_zone`, `week_start`), against `updated_at`. */
  api.patch("/books/:book/settings", async (c) => {
    const { book } = c.req.param();
    if (!atLeast(await roleIn(c.get("user"), book), "manage"))
      return c.json({ detail: "only a manager of the book can do that" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      updated_at?: unknown;
      time_zone?: unknown;
      week_start?: unknown;
    };
    if (typeof body.updated_at !== "string")
      return c.json({ detail: "send the updated_at you read" }, 422);
    const changes: { time_zone?: string; week_start?: number } = {};
    if (body.time_zone !== undefined) {
      if (typeof body.time_zone !== "string" || !isTimeZone(body.time_zone))
        return c.json({ detail: "send a time zone, like America/Chicago" }, 422);
      changes.time_zone = body.time_zone;
    }
    if (body.week_start !== undefined) {
      if (
        !Number.isInteger(body.week_start) ||
        (body.week_start as number) < 0 ||
        (body.week_start as number) > 6
      )
        return c.json({ detail: "week_start is 0 (Sunday) to 6 (Saturday)" }, 422);
      changes.week_start = body.week_start as number;
    }
    if (!db.settings(book)) return c.json({ detail: "set the book's time zone first" }, 409);
    try {
      return c.json(db.patchSettings(book, body.updated_at, changes));
    } catch (error) {
      if (error instanceof StaleVersion) return c.json({ detail: error.message }, 409);
      throw error;
    }
  });

  api.put("/books/:book/settings", async (c) => {
    const { book } = c.req.param();
    if (!atLeast(await roleIn(c.get("user"), book), "manage"))
      return c.json({ detail: "only a manager of the book can do that" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { time_zone?: unknown };
    const zone = body.time_zone;
    if (typeof zone !== "string" || !isTimeZone(zone))
      return c.json({ detail: "send a time zone, like America/Chicago" }, 422);
    db.setTimeZone(book, zone, c.get("user"));
    return c.json({ time_zone: zone });
  });

  // Sharing books (M13): members (kept by the ledger, with names from here) and invitations by
  // link. Accepting one adds the caller acting as whoever invited them, so the ledger checks
  // they still manage the book.

  const withNames = (members: Member[]) => {
    const profiles = db.userProfiles(members.map((m) => m.user_id));
    return members.map((m) => ({
      ...m,
      name: profiles.get(m.user_id)?.name ?? null,
      email: profiles.get(m.user_id)?.email ?? null,
    }));
  };
  const inviteView = (i: Invite) => {
    const by = db.userProfiles([i.invited_by]).get(i.invited_by);
    return {
      id: i.id,
      role: i.role,
      email: i.email,
      label: i.label,
      invited_by: by?.name ?? null,
      expires_at: i.expires_at,
      created_at: i.created_at,
    };
  };
  /** Whether an invitation is for the caller: their account's email is the one it names. */
  const forCaller = (invite: Invite, user: string) =>
    !invite.email ||
    db.userProfiles([user]).get(user)?.email.toLowerCase() === invite.email.toLowerCase();
  const ledgerProblem = (error: unknown) => {
    if (error instanceof LedgerError && [403, 404, 409, 422].includes(error.status))
      return [{ detail: error.message }, error.status as 403 | 404 | 409 | 422] as const;
    throw error;
  };

  /** Who has the book (owner first), and, for managers, its open invitations. */
  api.get("/books/:book/members", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    const role = await roleIn(user, book);
    if (!role) return c.json({ detail: "not found" }, 404);
    const members = await ledgerFor(user).members(book);
    return c.json({
      role,
      members: withNames(members),
      invites: atLeast(role, "manage") ? db.openInvites(book).map(inviteView) : [],
    });
  });

  /** Change a member's role (`{role, updated_at}`), as a manager. */
  api.patch("/books/:book/members/:member", async (c) => {
    const { book, member } = c.req.param();
    const body = (await c.req.json().catch(() => ({}))) as { role?: unknown; updated_at?: unknown };
    if (body.role !== "read" && body.role !== "write" && body.role !== "manage")
      return c.json({ detail: "the role is read, write or manage" }, 422);
    if (typeof body.updated_at !== "string")
      return c.json({ detail: "send the updated_at you read" }, 422);
    try {
      const changed = await ledgerFor(c.get("user")).putMember(book, member, {
        role: body.role,
        updated_at: body.updated_at,
      });
      return c.json(withNames([changed])[0]);
    } catch (error) {
      return c.json(...ledgerProblem(error));
    }
  });

  /** Take a member out (a manager), or leave (yourself). What acted as them in the book acts as
   * its owner from then on, and their bank links into it go. */
  api.delete("/books/:book/members/:member", async (c) => {
    const { book, member } = c.req.param();
    const ledger = ledgerFor(c.get("user"));
    try {
      const owner = (await ledger.members(book)).find((m) => m.role === "owner")?.user_id;
      await ledger.removeMember(book, member);
      if (owner) db.handOver(book, member, owner);
      for (const link of simplefin?.store.linksIn(book) ?? [])
        if (link.user_id === member) simplefin!.store.deleteLink(link.user_id, link.id);
      return c.body(null, 204);
    } catch (error) {
      return c.json(...ledgerProblem(error));
    }
  });

  /** Invite someone (`{email, role, label?}`), as a manager: the link's token, shown once. Only
   * the account with that email can accept it. */
  api.post("/books/:book/invites", async (c) => {
    const { book } = c.req.param();
    const user = c.get("user");
    if (!atLeast(await roleIn(user, book), "manage"))
      return c.json({ detail: "only a manager of the book can do that" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      role?: unknown;
      label?: unknown;
      email?: unknown;
    };
    if (body.role !== "read" && body.role !== "write" && body.role !== "manage")
      return c.json({ detail: "the role is read, write or manage" }, 422);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return c.json({ detail: "enter the email address of the account it's for" }, 422);
    const label =
      typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 100) : null;
    const { invite, token } = db.createInvite(book, body.role, user, email, label);
    return c.json({ ...inviteView(invite), token }, 201);
  });

  /** Withdraw an invitation that hasn't been used, as a manager. */
  api.delete("/books/:book/invites/:id", async (c) => {
    const { book, id } = c.req.param();
    if (!atLeast(await roleIn(c.get("user"), book), "manage"))
      return c.json({ detail: "only a manager of the book can do that" }, 403);
    return db.revokeInvite(book, id) ? c.body(null, 204) : c.json({ detail: "not found" }, 404);
  });

  /** What an invitation is for: the book, the role, who invited; whether it can still be used. */
  api.get("/invites/:token", async (c) => {
    const invite = db.inviteByToken(c.req.param("token"));
    if (!invite) return c.json({ detail: "this invitation doesn't exist" }, 404);
    const book = await ledgerFor(invite.invited_by).book(invite.book_id);
    if (!book) return c.json({ detail: "this invitation's book is gone" }, 404);
    const state = invite.accepted_by
      ? "used"
      : invite.expires_at <= new Date().toISOString()
        ? "expired"
        : "open";
    return c.json({
      ...inviteView(invite),
      book: { id: book.id, name: book.name },
      state,
      member: (await roleIn(c.get("user"), invite.book_id)) !== undefined,
      for_you: forCaller(invite, c.get("user")),
    });
  });

  /** Accept an invitation: the caller becomes a member with its role (if they aren't one). */
  api.post("/invites/:token/accept", async (c) => {
    const user = c.get("user");
    const invite = db.inviteByToken(c.req.param("token"));
    if (!invite) return c.json({ detail: "this invitation doesn't exist" }, 404);
    if ((await roleIn(user, invite.book_id)) !== undefined) return c.json({ book: invite.book_id });
    if (invite.accepted_by) return c.json({ detail: "this invitation was already used" }, 409);
    if (!forCaller(invite, user))
      return c.json(
        { detail: `this invitation is for ${invite.email}: log in as them to accept it` },
        403
      );
    if (invite.expires_at <= new Date().toISOString())
      return c.json({ detail: "this invitation has expired: ask for a new one" }, 409);
    try {
      await ledgerFor(invite.invited_by).putMember(invite.book_id, user, { role: invite.role });
    } catch (error) {
      if (error instanceof LedgerError && error.status === 403)
        return c.json(
          { detail: "whoever invited you can't add people to this book any more" },
          409
        );
      return c.json(...ledgerProblem(error));
    }
    db.acceptInvite(invite.id, user);
    return c.json({ book: invite.book_id });
  });

  // Prices: the last morning run, and fetching now

  api.get("/books/:book/prices/fetch", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.lastPriceFetch(book) ?? null);
  });

  api.post("/books/:book/prices/fetch", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    await fetchPrices(db, ledgerFor(c.get("user")), book, bookToday(db, book));
    return c.json(db.lastPriceFetch(book));
  });

  // Schedules

  const scheduleError = (error: unknown): readonly [{ detail: string }, 404 | 409 | 422] => {
    if (error instanceof ScheduleProblem) return [{ detail: error.message }, error.status];
    if (error instanceof StaleVersion) return [{ detail: error.message }, 409];
    throw error;
  };

  api.get("/books/:book/schedules", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.schedules(book).map(view));
  });

  /** Create a schedule, and stage any occurrences already due (from its start). */
  api.post("/books/:book/schedules", async (c) => {
    const { book } = c.req.param();
    const input = (await c.req.json().catch(() => null)) as ScheduleIn | null;
    try {
      const made = await createSchedule({ db, ledgerFor, user: c.get("user"), book, input });
      return c.json(made, 201);
    } catch (error) {
      return c.json(...scheduleError(error));
    }
  });

  /** Occurrences still to come over the next `days` (UPCOMING_DAYS by default). */
  api.get("/books/:book/schedules/upcoming", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const days = Math.min(Number(c.req.query("days") ?? UPCOMING_DAYS) || UPCOMING_DAYS, 366);
    return c.json(upcomingOccurrences(db, book, bookToday(db, book), days));
  });

  /** Which transactions schedules staged: transaction ID to schedule ID. */
  api.get("/books/:book/schedules/occurrences", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.scheduledTransactions(book));
  });

  /** Stage the book's due occurrences now (the generator also runs hourly). */
  api.post("/books/:book/schedules/run", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const staged = await runSchedules({ db, ledgerFor, book });
    return c.json({ staged, schedules: db.schedules(book).map(view) });
  });

  api.get("/books/:book/schedules/:id", async (c) => {
    const { book, id } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const found = db.schedule(book, id);
    return found ? c.json(view(found)) : c.json({ detail: "not found" }, 404);
  });

  /** Change a schedule (only the fields sent), against `updated_at`. Applies to occurrences
   * still to come. */
  api.patch("/books/:book/schedules/:id", async (c) => {
    const { book, id } = c.req.param();
    const patch = (await c.req.json().catch(() => null)) as SchedulePatch | null;
    try {
      return c.json(await editSchedule({ db, ledgerFor, user: c.get("user"), book, id, patch }));
    } catch (error) {
      return c.json(...scheduleError(error));
    }
  });

  /** Delete a schedule, against `?updated_at=`. What it staged stays in the books. */
  api.delete("/books/:book/schedules/:id", async (c) => {
    const { book, id } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    if (!db.schedule(book, id)) return c.json({ detail: "not found" }, 404);
    try {
      db.deleteSchedule(book, id, c.req.query("updated_at") ?? "");
    } catch (error) {
      if (error instanceof StaleVersion) return c.json({ detail: error.message }, 409);
      throw error;
    }
    return c.body(null, 204);
  });

  api.get("/books/:book/imports", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.batches(book, c.req.query("account")));
  });

  /** Each account's last import time: what the home page shows as "last updated". */
  api.get("/books/:book/imports/latest", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json(db.lastImports(book));
  });

  api.get("/books/:book/imports/:batch", async (c) => {
    const { book, batch } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const found = db.batch(book, batch);
    return found
      ? c.json({ batch: found, rows: db.rows(batch) })
      : c.json({ detail: "not found" }, 404);
  });

  return api;
}

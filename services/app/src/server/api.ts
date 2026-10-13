/**
 * The app API, at /api/app/v1. Every route needs the caller (X-User-Id, set by Traefik after
 * checking the session), and acts as them toward the ledger, so book ownership is the ledger's
 * call: a book the caller doesn't own answers 404 here too.
 */
import { Hono } from "hono";

import type { CsvProfile } from "@fava-beans/csv-import";

import type { AppDb } from "./db.js";
import { ImportProblem, importFile } from "./imports.js";
import { assignRow, confirmRow, MatchProblem, proposedMatches } from "./matches.js";
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
import { applyRule, coveredBy, settle, suggestPending } from "./categorize/service.js";
import type { CategoryRuleIn, CategoryRulePatch } from "../shared/rules.js";
import type { LedgerPort } from "./ledger.js";

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

export function createApi({
  db,
  ledgerFor,
  categorizers = [],
}: {
  db: AppDb;
  ledgerFor: (userId: string) => LedgerPort;
  /** The categorization chain, in order (see categorize/chain.ts). */
  categorizers?: Categorizer[];
}) {
  const api = new Hono<Env>().basePath("/api/app/v1");

  api.get("/health", (c) => c.json({ status: "ok" }));

  api.use("/books/*", async (c, next) => {
    const user = c.req.header("x-user-id");
    if (!user) return c.json({ detail: "not logged in" }, 401);
    c.set("user", user);
    return next();
  });

  /** 404 unless the caller owns the book. */
  const owned = async (user: string, book: string) =>
    (await ledgerFor(user).book(book)) !== undefined;

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
      const result = await importFile({
        db,
        ledger: ledgerFor(c.get("user")),
        book,
        account,
        filename: file.name,
        text: await file.text(),
        userId: c.get("user"),
        categorizers,
      });
      return c.json(result, 201);
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

  /** Create a rule. Says how many pending transactions it covers, to offer re-applying. */
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

  /** Change a rule (only the fields sent), against `updated_at`. Says how many pending
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

  /** Re-apply a rule to the pending transactions it covers that haven't been touched. */
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

  /** "Suggest categories" for pending transactions not yet categorized. */
  api.post("/books/:book/suggest", async (c) => {
    const { book } = c.req.param();
    const info = await bookOf(c.get("user"), book);
    if (!info) return c.json({ detail: "not found" }, 404);
    const suggested = await suggestPending({
      db,
      ledger: ledgerFor(c.get("user")),
      book: info,
      categorizers,
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

  // Book settings (kept in `app`): for now, the book's time zone, which decides "today" for
  // its schedules.

  api.get("/books/:book/settings", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    return c.json({ time_zone: db.timeZone(book) ?? null });
  });

  api.put("/books/:book/settings", async (c) => {
    const { book } = c.req.param();
    if (!(await owned(c.get("user"), book))) return c.json({ detail: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { time_zone?: unknown };
    const zone = body.time_zone;
    if (typeof zone !== "string" || !isTimeZone(zone))
      return c.json({ detail: "send a time zone, like America/Chicago" }, 422);
    db.setTimeZone(book, zone);
    return c.json({ time_zone: zone });
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

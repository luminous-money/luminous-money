/**
 * Scheduled transactions: checking schedules, the generator, and what's coming.
 *
 * The generator stages each due occurrence of every schedule that isn't paused, acting as the
 * schedule's owner toward the ledger: unconfirmed (`!`) for review, or confirmed if the schedule
 * confirms automatically. It runs at startup, after a schedule is saved, and once a day just
 * after midnight in each book's time zone. An occurrence is due on its (weekend-adjusted) date,
 * in the book's time zone.
 *
 * A schedule's `last_applied` date is the last nominal date it ran for. The generator stages
 * the occurrences after it (or from the start, if it has never run) through today, then moves
 * it past them. So each occurrence is staged once: one deleted with "Not this time" doesn't
 * come back. Editing a schedule resets it to now: its unconfirmed occurrences from today on are
 * deleted (except ones an import already matched), and staged again as edited.
 *
 * A schedule whose transactions the ledger refuses keeps the error, and is retried on the next
 * run; the others carry on.
 */
import type { Account, TransactionIn } from "@luminous-money/ledger-client";

import {
  addDays,
  due,
  occurrences,
  problem,
  upcoming,
  type Occurrence,
  type Schedule,
  type ScheduleIn,
  type SchedulePatch,
  type UpcomingOccurrence,
} from "../shared/schedule.js";
import { StaleVersion, type AppDb, type StoredSchedule } from "./db.js";
import type { DailyJob } from "./daily.js";
import type { LedgerPort } from "./ledger.js";

export const SCHEDULE_KEY = "schedule";
export const SCHEDULE_DATE_KEY = "schedule-date";

/** Today's date in `timeZone` (IANA), or where the app runs if none is given. */
export function todayIn(timeZone?: string): string {
  return new Date().toLocaleDateString("en-CA", timeZone ? { timeZone } : undefined);
}

/** Today in the book's time zone. */
export const bookToday = (db: AppDb, book: string) => todayIn(db.timeZone(book));

const DECIMAL = /^-?\d+(\.\d+)?$/;
const AMOUNT = /^\d+(\.\d+)?$/;

/** Why a schedule can't be saved, or null if it can. The ledger checks the transaction again
 * when an occurrence is staged. */
export function scheduleProblem(s: ScheduleIn, accounts: Account[]): string | null {
  if (!s.name?.trim()) return "Name the schedule";
  const rule = problem(s.rule);
  if (rule) return rule;
  const postings = s.template?.postings ?? [];
  if (postings.length < 2) return "A transaction needs at least two splits";
  if (postings.filter((p) => !p.units).length > 1) return "Leave at most one amount blank";
  if (postings.some((p) => p.units && (!DECIMAL.test(p.units.number) || !p.units.currency)))
    return "Amounts must be numbers like 12.50, with a currency";
  if (postings.some((p) => p.tolerance && !AMOUNT.test(p.tolerance)))
    return "A match tolerance is an amount, like 25.00";
  const tolerant = postings.filter((p) => p.tolerance && Number(p.tolerance) > 0);
  if (tolerant.length && (tolerant.some((p) => !p.units) || postings.every((p) => p.units)))
    return "A split with a match tolerance needs an amount, and another split left blank to absorb the difference";
  const byName = new Map(accounts.map((a) => [a.name, a]));
  for (const p of postings) {
    const account = byName.get(p.account);
    if (!account || account.kind !== "leaf" || account.implicit || account.close)
      return `${p.account || "An account"} isn't an open account that holds transactions`;
  }
  return null;
}

/** Something the caller has to fix: 404 (no such book or schedule) or 422 (not a valid one). */
export class ScheduleProblem extends Error {
  constructor(
    readonly status: 404 | 422,
    message: string
  ) {
    super(message);
  }
}

type Services = {
  db: AppDb;
  ledgerFor: (userId: string) => LedgerPort;
  user: string;
  book: string;
};

/** Create a schedule owned by `user`, and stage every occurrence from its start through today
 * (`on`, by default today in the book's time zone). */
export async function createSchedule({
  db,
  ledgerFor,
  user,
  book,
  input,
  on,
}: Services & { input: ScheduleIn | null; on?: string }): Promise<Schedule> {
  const ledger = ledgerFor(user);
  if (!(await ledger.book(book))) throw new ScheduleProblem(404, "not found");
  const problem = input ? scheduleProblem(input, await ledger.accounts(book)) : "send a schedule";
  if (!input || problem) throw new ScheduleProblem(422, problem!);
  const id = db.addSchedule({
    user_id: user,
    book_id: book,
    name: input.name.trim(),
    rule: input.rule,
    template: input.template,
    paused: input.paused ?? false,
    auto_confirm: input.auto_confirm ?? false,
  });
  await runSchedules({ db, ledgerFor, on, id });
  return view(db.schedule(book, id)!);
}

/**
 * Change a schedule (only the fields given), against the version read, and reset it to now:
 * its unconfirmed occurrences dated today (`on`) or later are deleted, except ones an import
 * matched, and `last_applied` becomes yesterday (or the last occurrence kept), so today's
 * occurrence on is staged as edited. Dates before today are never staged by an edit.
 */
export async function editSchedule({
  db,
  ledgerFor,
  user,
  book,
  id,
  patch,
  on = bookToday(db, book),
}: Services & { id: string; patch: SchedulePatch | null; on?: string }): Promise<Schedule> {
  const ledger = ledgerFor(user);
  if (!(await ledger.book(book))) throw new ScheduleProblem(404, "not found");
  const current = db.schedule(book, id);
  if (!current) throw new ScheduleProblem(404, "not found");
  if (!patch?.updated_at) throw new ScheduleProblem(422, "send the updated_at you read");
  const { updated_at, ...changes } = patch;
  const merged = { ...current, ...changes };
  const problem = scheduleProblem(merged, await ledger.accounts(book));
  if (problem) throw new ScheduleProblem(422, problem);
  if (current.updated_at !== updated_at)
    throw new StaleVersion("the schedule changed since it was read");

  const from = db.occurrencesFrom(id, on);
  const held = db.heldByImports(from.map((o) => o.transaction_id));
  const remove: { id: string; updated_at: string }[] = [];
  const forget: string[] = [];
  let kept = addDays(on, -1);
  for (const o of from) {
    const staged = held.has(o.transaction_id)
      ? undefined
      : await ledger.transaction(book, o.transaction_id).catch(() => null);
    if (staged === null)
      forget.push(o.nominal); // already deleted
    else if (staged?.flag === "!") {
      remove.push({ id: staged.id, updated_at: staged.updated_at });
      forget.push(o.nominal);
    } else if (o.nominal > kept) kept = o.nominal; // confirmed or matched: it stays
  }
  if (remove.length) await ledger.applyChanges(book, { create: [], delete: remove });
  db.forgetOccurrences(id, forget);
  db.updateSchedule(book, id, updated_at, {
    name: merged.name.trim(),
    rule: merged.rule,
    template: merged.template,
    paused: merged.paused,
    auto_confirm: merged.auto_confirm,
    last_applied: kept,
  });
  await runSchedules({ db, ledgerFor, on, id });
  return view(db.schedule(book, id)!);
}

/** The transaction an occurrence stages. Tolerances stay with the schedule. */
export function occurrenceTransaction(
  s: Pick<StoredSchedule, "id" | "template" | "auto_confirm">,
  occurrence: Occurrence
): TransactionIn {
  const { template } = s;
  return {
    date: occurrence.date,
    flag: s.auto_confirm ? "*" : "!",
    payee: template.payee,
    narration: template.narration,
    tags: template.tags,
    links: template.links,
    meta: { ...template.meta, [SCHEDULE_KEY]: s.id, [SCHEDULE_DATE_KEY]: occurrence.nominal },
    postings: template.postings.map(
      ({ tolerance: _tolerance, ...p }) => p
    ) as TransactionIn["postings"],
  };
}

/** The next occurrence a schedule will stage, if any (none while paused or ended). */
function next(s: StoredSchedule): Occurrence | null {
  if (s.paused) return null;
  const from = s.last_applied ?? s.rule.start;
  return occurrences(s.rule, s.last_applied, addDays(from, 800))[0] ?? null;
}

/** A schedule as the API shows it. */
export function view(s: StoredSchedule): Schedule {
  return {
    id: s.id,
    book_id: s.book_id,
    name: s.name,
    rule: s.rule,
    template: s.template,
    paused: s.paused,
    auto_confirm: s.auto_confirm,
    last_applied: s.last_applied,
    last_error: s.last_error,
    next: next(s),
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

/** Occurrences still to stage from `from` through `days` later, across the book's active
 * schedules, by date. */
export function upcomingOccurrences(
  db: AppDb,
  book: string,
  from: string,
  days: number
): UpcomingOccurrence[] {
  const to = addDays(from, days);
  return db
    .schedules(book)
    .filter((s) => !s.paused)
    .flatMap((s) =>
      upcoming(s.rule, from, 1000, days + 3)
        .filter((o) => o.date <= to && (!s.last_applied || o.nominal > s.last_applied))
        .map((o) => ({ ...o, schedule_id: s.id, name: s.name, template: s.template }))
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/**
 * Stage every due occurrence of the active schedules (all of them, or one book's, or one
 * schedule), each due by today in its book's time zone (or `on`). Each schedule's occurrences
 * are one atomic ledger write. Returns how many were staged.
 */
export async function runSchedules({
  db,
  ledgerFor,
  on,
  book,
  id,
}: {
  db: AppDb;
  ledgerFor: (userId: string) => LedgerPort;
  on?: string;
  book?: string;
  id?: string;
}): Promise<number> {
  let staged = 0;
  for (const s of db.activeSchedules()) {
    if ((book && s.book_id !== book) || (id && s.id !== id)) continue;
    const occurrences = due(s.rule, s.last_applied, on ?? bookToday(db, s.book_id));
    if (!occurrences.length) continue;
    try {
      const created = await ledgerFor(s.user_id).createTransactions(
        s.book_id,
        occurrences.map((o) => occurrenceTransaction(s, o))
      );
      db.recordOccurrences(
        s.id,
        occurrences.map((o, i) => ({ ...o, transaction_id: created[i]!.id }))
      );
      staged += occurrences.length;
    } catch (error) {
      db.setScheduleError(s.id, error instanceof Error ? error.message : String(error));
    }
  }
  return staged;
}

/** The generator as a daily job: just after midnight in each book with active schedules. */
export function schedulesJob(db: AppDb, ledgerFor: (userId: string) => LedgerPort): DailyJob {
  return {
    name: "scheduler",
    at: 0,
    zones: () => db.activeSchedules().map((s) => db.timeZone(s.book_id)),
    run: async () => {
      const n = await runSchedules({ db, ledgerFor });
      return n ? `staged ${n} occurrence${n === 1 ? "" : "s"}` : undefined;
    },
  };
}

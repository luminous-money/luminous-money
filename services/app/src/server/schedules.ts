/**
 * Scheduled transactions: checking schedules, the generator, and what's coming.
 *
 * The generator stages each due occurrence of every schedule that isn't paused as a pending (`!`)
 * transaction, acting as the schedule's owner toward the ledger. It runs at startup, every hour,
 * and after a schedule is saved. An occurrence is due on its (weekend-adjusted) date. Each is
 * staged once: only nominal dates after the schedule's generated-through date are considered,
 * and that date moves past every occurrence staged, so editing a rule never backfills, and a
 * deleted occurrence doesn't come back. A schedule whose transactions the ledger refuses keeps
 * the error, and is retried on the next run; the others carry on.
 */
import type { Account, TransactionIn } from "@fava-beans/ledger-client";

import {
  addDays,
  due,
  occurrences,
  problem,
  upcoming,
  type Occurrence,
  type Rule,
  type Schedule,
  type ScheduleIn,
  type TransactionTemplate,
  type UpcomingOccurrence,
} from "../shared/schedule.js";
import type { AppDb, StoredSchedule } from "./db.js";
import type { SchedulePatch } from "../shared/schedule.js";
import type { LedgerPort } from "./ledger.js";

export const SCHEDULE_KEY = "schedule";
export const SCHEDULE_DATE_KEY = "schedule-date";

/** Today's date where the app runs (set `TZ` for the household's time zone). */
export function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

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

/** Create a schedule owned by `user`, and stage any occurrences already due (from its start:
 * a start in the past backfills). */
export async function createSchedule({
  db,
  ledgerFor,
  user,
  book,
  input,
  on = today(),
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
  });
  await runSchedules({ db, ledgerFor, on, id });
  return view(db.schedule(book, id)!);
}

/**
 * Change a schedule (only the fields given), against the version read. Changes apply to
 * occurrences still to come: a changed rule applies from `on` (today), never staging dates
 * already past. Then stages anything now due.
 */
export async function editSchedule({
  db,
  ledgerFor,
  user,
  book,
  id,
  patch,
  on = today(),
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
  const yesterday = addDays(on, -1);
  const ruleChanged = JSON.stringify(merged.rule) !== JSON.stringify(current.rule);
  db.updateSchedule(book, id, updated_at, {
    name: merged.name.trim(),
    rule: merged.rule,
    template: merged.template,
    paused: merged.paused,
    generated_through:
      ruleChanged && (current.generated_through ?? "") < yesterday
        ? yesterday
        : current.generated_through,
  });
  await runSchedules({ db, ledgerFor, on, id });
  return view(db.schedule(book, id)!);
}

/** The transaction an occurrence stages. */
export function occurrenceTransaction(
  id: string,
  template: TransactionTemplate,
  occurrence: Occurrence
): TransactionIn {
  return {
    date: occurrence.date,
    flag: "!",
    payee: template.payee,
    narration: template.narration,
    tags: template.tags,
    links: template.links,
    meta: { ...template.meta, [SCHEDULE_KEY]: id, [SCHEDULE_DATE_KEY]: occurrence.nominal },
    postings: template.postings as TransactionIn["postings"],
  };
}

/** The next occurrence a schedule will stage, if any (none while paused or ended). */
function next(s: StoredSchedule): Occurrence | null {
  if (s.paused) return null;
  const from = s.generated_through ?? s.rule.start;
  return occurrences(s.rule, s.generated_through, addDays(from, 800))[0] ?? null;
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
    generated_through: s.generated_through,
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
        .filter((o) => o.date <= to && (!s.generated_through || o.nominal > s.generated_through))
        .map((o) => ({ ...o, schedule_id: s.id, name: s.name, template: s.template }))
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/**
 * Stage every due occurrence of the active schedules (all of them, or one book's, or one
 * schedule). Each schedule's occurrences are one atomic ledger write. Returns how many were
 * staged.
 */
export async function runSchedules({
  db,
  ledgerFor,
  on = today(),
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
    const occurrences = due(s.rule as Rule, s.generated_through, on);
    if (!occurrences.length) continue;
    try {
      const created = await ledgerFor(s.user_id).createTransactions(
        s.book_id,
        occurrences.map((o) => occurrenceTransaction(s.id, s.template, o))
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

/** Run the generator now and then every hour, logging what it does. Returns a stop function. */
export function startScheduler(
  db: AppDb,
  ledgerFor: (userId: string) => LedgerPort,
  everyMs = 60 * 60 * 1000
): () => void {
  const tick = () =>
    runSchedules({ db, ledgerFor }).then(
      (n) => n && console.log(`scheduler: staged ${n} occurrence${n === 1 ? "" : "s"}`),
      (error: unknown) => console.error("scheduler:", error)
    );
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  return () => clearInterval(timer);
}

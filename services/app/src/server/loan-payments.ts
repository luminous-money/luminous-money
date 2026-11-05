/**
 * A loan's payments, as its schedule stages them (M3's generator, with the amounts the loan
 * works out), and as they're filled in again when the loan changes.
 *
 * What's owed before each payment is what the books say (the liability's balance the day
 * before it's due), less the principal of the payments staged before it in the same write. A
 * payment due before the paying account's books begin (a loan backfilled from its start into a
 * book that starts later) is paid from Opening Balances, and is only principal and interest: the
 * money left before those books did, and what the lender did with escrow then isn't known.
 *
 * A payment already in the paying account (the bank's, imported: the same total within the
 * tolerance, five days either side, not staged by a schedule) becomes the payment rather than
 * a second one: its splits are filled in from the loan, the bank's amount kept, or it's taken
 * as it is if it already pays down the loan.
 */
import type { Transaction, TransactionIn } from "@luminous-money/ledger-client";

import {
  cents,
  money,
  paymentOn,
  paymentPostings,
  project,
  type Payment,
  type LoanAccounts,
} from "../shared/loans.js";
import type { Occurrence, TransactionTemplate } from "../shared/schedule.js";
import type { AppDb, StoredLoan, StoredSchedule } from "./db.js";
import { STAGING, type LedgerPort, type TransactionEdit } from "./ledger.js";

export const OPENING_BALANCES = "Equity:Opening-Balances";

/** How far either side of its date a payment already in the books may be. */
export const MATCH_DAYS = 5;

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

/** What's owed (cents, positive) at the end of each day before the dates given, by the books. */
async function owedBefore(
  ledger: LedgerPort,
  loan: StoredLoan,
  dates: string[]
): Promise<(date: string) => bigint> {
  const first = dates[0]!;
  const last = dates.at(-1)!;
  const balances = await ledger.dayBalances(loan.book_id, loan.accounts.liability, first, last);
  return (date) => {
    let balance = balances.before;
    for (const d of balances.days) if (d.date < date) balance = d.balance;
    return -cents(balance);
  };
}

/** The paying account's first day in the books, if it has one: payments before it are paid from
 * Opening Balances. */
async function booksBegin(ledger: LedgerPort, loan: StoredLoan): Promise<string | null> {
  const paying = (await ledger.accounts(loan.book_id)).find((a) => a.name === loan.accounts.paying);
  return paying?.open ?? null;
}

/** A payment made before the paying account's books began: principal and interest only. */
function beforeBooks(p: Payment): Payment {
  const total = money(cents(p.principal) + cents(p.extra) + cents(p.interest));
  return { ...p, others: [], total };
}

/** The accounts a payment posts to: from Opening Balances before the books begin. */
const accountsFor = (loan: StoredLoan, early: boolean): LoanAccounts =>
  early ? { ...loan.accounts, paying: OPENING_BALANCES } : loan.accounts;

/** What a payment's liability split pays down, its blank worked out from the others. */
function paidDown(t: Pick<Transaction, "postings">, liability: string): bigint {
  const split = t.postings.find((p) => p.account === liability);
  if (!split) return 0n;
  if (split.units) return cents(split.units.number);
  return -t.postings
    .filter((p) => p !== split && p.units)
    .reduce((sum, p) => sum + cents(p.units!.number), 0n);
}

const hasTolerance = (loan: StoredLoan) => cents(loan.tolerance) > 0n;

/** The payment's transaction. */
function paymentTransaction(
  loan: StoredLoan,
  p: Payment,
  o: Occurrence,
  early: boolean,
  flag: "*" | "!",
  meta: Record<string, string>
): TransactionIn {
  const payment = early ? beforeBooks(p) : p;
  return {
    date: o.date,
    flag,
    payee: loan.payee || loan.name,
    narration: p.number ? `Payment ${p.number}` : "Payment",
    tags: [],
    links: [],
    meta,
    postings: paymentPostings(accountsFor(loan, early), payment, loan.currency, {
      blankPrincipal: hasTolerance(loan),
    }) as TransactionIn["postings"],
  };
}

/**
 * Stage a loan's due occurrences: worked out in order, each one already in the paying account
 * filled in rather than added again, the rest created, in one atomic write. Occurrences after
 * it's paid off stage nothing. `flag` overrides the schedule's (a backfill's choice). Returns how
 * many were staged.
 */
export async function stageLoanPayments({
  db,
  ledger,
  loan,
  schedule,
  occurrences,
  meta,
  flag,
}: {
  db: AppDb;
  ledger: LedgerPort;
  loan: StoredLoan;
  schedule: StoredSchedule;
  occurrences: Occurrence[];
  meta: (o: Occurrence) => Record<string, string>;
  flag?: "*" | "!";
}): Promise<number> {
  if (!occurrences.length) return 0;
  const book = loan.book_id;
  const owed = await owedBefore(
    ledger,
    loan,
    occurrences.map((o) => o.date)
  );
  const begins = await booksBegin(ledger, loan);
  const mark = flag ?? (schedule.auto_confirm ? "*" : "!");

  // What's already in the paying account that a payment could be.
  const from = occurrences.find((o) => !begins || o.date >= begins)?.date;
  const scheduled = new Set(Object.keys(db.scheduledTransactions(book)));
  const nearby = from
    ? (await ledger.compact(book, shift(from, -MATCH_DAYS))).filter(
        (t) =>
          !scheduled.has(t.id) &&
          t.date <= shift(occurrences.at(-1)!.date, MATCH_DAYS) &&
          t.postings.some((p) => p.account === loan.accounts.paying)
      )
    : [];
  const taken = new Set<string>();
  const tolerance = cents(loan.tolerance);

  const create: TransactionIn[] = [];
  const update: TransactionEdit[] = [];
  const staged: (Occurrence & { ref: { create: number } | { id: string } })[] = [];
  let paidSoFar = 0n;
  let lastNominal: string | null = null;
  let owedAfter: bigint | null = null;
  for (const o of occurrences) {
    lastNominal = o.nominal;
    const p = paymentOn(loan, o.nominal, owed(o.date) - paidSoFar);
    owedAfter = p ? cents(p.owed_after) : 0n;
    if (!p) continue;
    const early = !!begins && o.date < begins;
    const payment = early ? beforeBooks(p) : p;
    const total = cents(payment.total);
    const found = early
      ? undefined
      : nearby.find((t) => {
          if (taken.has(t.id) || t.date < shift(o.date, -MATCH_DAYS)) return false;
          if (t.date > shift(o.date, MATCH_DAYS)) return false;
          const split = t.postings.find((s) => s.account === loan.accounts.paying);
          if (!split?.amount) return false;
          const gap = cents(split.amount.number) + total;
          return (gap < 0n ? -gap : gap) <= tolerance;
        });
    const entry = { ...meta(o) };
    if (found) {
      taken.add(found.id);
      const t = await ledger.transaction(book, found.id);
      const pays = t.postings.some((s) => s.account === loan.accounts.liability);
      if (!pays) {
        const paying = t.postings.find((s) => s.account === loan.accounts.paying)!;
        const [, ...rest] = paymentPostings(loan.accounts, payment, loan.currency, {
          blankPrincipal: true,
        });
        update.push({
          id: t.id,
          updated_at: t.updated_at,
          flag: mark,
          meta: { ...(t.meta ?? {}), ...entry },
          postings: [paying, ...rest] as TransactionEdit["postings"],
        });
      }
      staged.push({ ...o, ref: { id: t.id } });
      paidSoFar += pays ? 0n : cents(p.principal) + cents(p.extra);
    } else {
      create.push(paymentTransaction(loan, p, o, early, mark, entry));
      staged.push({ ...o, ref: { create: create.length - 1 } });
      paidSoFar += cents(p.principal) + cents(p.extra);
    }
  }

  if (staged.length) {
    const created = await ledger.applyChanges(book, { create, update, delete: [] }, STAGING);
    db.recordOccurrences(
      schedule.id,
      staged.map(({ ref, ...o }) => ({
        ...o,
        transaction_id: "id" in ref ? ref.id : created[ref.create]!.id,
      }))
    );
  }
  if (lastNominal && lastNominal !== staged.at(-1)?.nominal)
    db.setLastApplied(schedule.id, lastNominal);
  // The schedule shows the next payment (the Schedules page, upcoming rows).
  if (lastNominal && owedAfter !== null)
    db.setScheduleTemplate(schedule.id, {
      name: schedule.name,
      rule: schedule.rule,
      template: loanTemplate(loan, project(loan, lastNominal, owedAfter, 1)[0] ?? null),
    });
  return staged.length;
}

/**
 * Fill in a loan's unconfirmed payments due `since` or later again, as it now works them out
 * (after a change, a re-base or an extra payment): in order, each from what the books say is
 * owed, less what the ones before it now pay down beyond what they did. A payment the bank's
 * row matched keeps the bank's amount. Confirmed ones are left as they are.
 */
export async function refillLoanPayments(
  db: AppDb,
  ledger: LedgerPort,
  loan: StoredLoan,
  since: string
): Promise<number> {
  const book = loan.book_id;
  const occurrences = db.occurrencesFrom(loan.schedule_id, since);
  if (!occurrences.length) return 0;
  const transactions = await Promise.all(
    occurrences.map((o) => ledger.transaction(book, o.transaction_id).catch(() => null))
  );
  const open = occurrences
    .map((o, i) => ({ o, t: transactions[i] }))
    .filter((x): x is { o: (typeof occurrences)[number]; t: Transaction } => x.t?.flag === "!");
  if (!open.length) return 0;
  const owed = await owedBefore(
    ledger,
    loan,
    open.map((x) => x.o.date)
  );
  const begins = await booksBegin(ledger, loan);
  const held = db.heldByImports(open.map((x) => x.t.id));

  const update: TransactionEdit[] = [];
  let shifted = 0n; // how much more the payments before now pay down than they did
  for (const { o, t } of open) {
    const p = paymentOn(loan, o.nominal, owed(o.date) - shifted);
    if (!p) continue;
    const early = !!begins && o.date < begins;
    const payment = early ? beforeBooks(p) : p;
    const accounts = accountsFor(loan, early);
    const paying = t.postings.find((s) => s.account === accounts.paying);
    const keepPaying = held.has(t.id) && !!paying?.units;
    const postings = paymentPostings(accounts, payment, loan.currency, {
      blankPrincipal: keepPaying || hasTolerance(loan),
    });
    if (keepPaying) postings[0] = { account: paying!.account, units: paying!.units! };
    const before = paidDown(t, loan.accounts.liability);
    const after = paidDown(
      { postings: postings as Transaction["postings"] },
      loan.accounts.liability
    );
    shifted += after - before;
    update.push({
      id: t.id,
      updated_at: t.updated_at,
      postings: postings as TransactionEdit["postings"],
      narration: p.number ? `Payment ${p.number}` : "Payment",
    });
  }
  if (update.length) await ledger.applyChanges(book, { create: [], update, delete: [] }, STAGING);
  return update.length;
}

/** What the loan's schedule shows as its template: the next payment's splits, worked out from
 * what's owed now. */
export function loanTemplate(loan: StoredLoan, next: Payment | null): TransactionTemplate {
  const postings = next
    ? paymentPostings(loan.accounts, next, loan.currency, { blankPrincipal: true })
    : [
        { account: loan.accounts.paying, units: null },
        { account: loan.accounts.liability, units: null },
      ];
  return {
    payee: loan.payee || loan.name,
    narration: "Payment",
    tags: [],
    links: [],
    meta: {},
    postings: postings.map((p, i) =>
      i === 0 && cents(loan.tolerance) > 0n ? { ...p, tolerance: loan.tolerance } : p
    ),
  };
}

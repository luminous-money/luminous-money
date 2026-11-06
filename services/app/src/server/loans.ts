/**
 * Loans: declaring one (with its history), changing it, re-basing it on what the lender says is
 * owed, extra payments, and what its page shows. The payments themselves are a schedule's (M3),
 * staged by loan-payments.ts.
 */
import type { Account } from "@luminous-money/ledger-client";

import {
  cents,
  loanProblem,
  loanRule,
  money,
  project,
  tableStarts,
  termsProblem,
  termsTable,
  type Loan,
  type LoanIn,
  type LoanPatch,
  type LoanRebaseIn,
  type LoanSetup,
  type LoanTable,
  type LoanView,
} from "../shared/loans.js";
import { addDays, nominalDates } from "../shared/schedule.js";
import type { AppDb, StoredLoan } from "./db.js";
import type { LedgerPort } from "./ledger.js";
import { loanTemplate, OPENING_BALANCES, refillLoanPayments } from "./loan-payments.js";
import {
  bookToday,
  createSchedule,
  runSchedules,
  scheduleProblem,
  view as scheduleView,
} from "./schedules.js";

/** Something the caller has to fix: 404 (no such book or loan) or 422 (not a valid one). */
export class LoanProblem extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
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
  /** Today, by default in the book's time zone. */
  on?: string;
};

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d\d-\d\d$/;

/** Why an account can't be one of the loan's, or null. */
function accountProblem(accounts: Account[], name: string | null, role: string): string | null {
  if (!name) return null;
  const a = accounts.find((x) => x.name === name);
  if (!a || a.kind !== "leaf" || a.implicit || a.close)
    return `${name} (${role}) isn't an open account that holds transactions`;
  return null;
}

function accountsProblem(accounts: Account[], l: Pick<Loan, "accounts" | "others">) {
  return (
    accountProblem(accounts, l.accounts.liability, "what's owed") ??
    accountProblem(accounts, l.accounts.paying, "what pays it") ??
    accountProblem(accounts, l.accounts.interest, "interest") ??
    accountProblem(accounts, l.accounts.asset, "what it bought") ??
    l.others.map((o) => accountProblem(accounts, o.account, o.name)).find(Boolean) ??
    null
  );
}

const TYPES: Record<string, Account["type"]> = {
  Assets: "asset",
  Liabilities: "liability",
  Equity: "equity",
  Income: "income",
  Expenses: "expense",
};

/** The chart as it will be once a setup's accounts are open. */
function withOpened(accounts: Account[], setup: LoanSetup): Account[] {
  return [
    ...accounts,
    ...(setup.open ?? []).map(
      (a) =>
        ({
          name: a.name,
          kind: "leaf",
          implicit: false,
          close: null,
          type: TYPES[a.name.split(":")[0]!] ?? null,
          currencies: [],
        }) as unknown as Account
    ),
  ];
}

/**
 * Why what's made along with a loan can't be, or null: accounts to open that are new leaves
 * (what they cost an amount on a date), escrow's balance on one of the loan's others, bills that
 * are valid schedules, and spending counted for an asset or liability as an expense leaf.
 * `chart` already has the accounts to open.
 */
function setupProblem(
  setup: LoanSetup,
  before: Account[],
  chart: Account[],
  loan: Pick<Loan, "others">
): string | null {
  const names = new Set(before.map((a) => a.name));
  const opening = new Set<string>();
  for (const a of setup.open ?? []) {
    if (!a?.name || !TYPES[a.name.split(":")[0]!])
      return `${a?.name || "An account"} isn't a full account name`;
    if (names.has(a.name) || opening.has(a.name)) return `${a.name} is already in the chart`;
    opening.add(a.name);
    if (a.opening && (!/^-?\d+(\.\d{1,2})?$/.test(a.opening.amount) || !DATE.test(a.opening.date)))
      return `What ${a.name} cost is an amount on a date`;
    if (a.revalue_every != null && !(Number.isInteger(a.revalue_every) && a.revalue_every > 0))
      return `${a.name} is revalued every so many days`;
  }
  const escrow = setup.escrow_balance;
  if (escrow) {
    if (!loan.others.some((o) => o.account === escrow.account))
      return `${escrow.account} isn't one of the loan's accounts`;
    if (!/^-?\d+(\.\d{1,2})?$/.test(escrow.amount) || !DATE.test(escrow.on))
      return "What escrow holds is an amount on a date";
  }
  for (const bill of setup.bills ?? []) {
    const problem = scheduleProblem(bill, chart);
    if (problem) return `${bill.name || "A bill"}: ${problem}`;
  }
  const byName = new Map(chart.map((a) => [a.name, a]));
  for (const o of setup.outflows ?? []) {
    const from = byName.get(o.account);
    if (!from || !["asset", "liability"].includes(from.type ?? ""))
      return `Only an asset or a liability counts as spending, not ${o.account}`;
    const as = byName.get(o.as);
    if (!as || as.type !== "expense" || as.kind !== "leaf" || as.close)
      return `${o.account} counts as spending as an open expense account, not ${o.as || "nothing"}`;
  }
  return null;
}

/** A table as sent, a terms table's rows worked out if they weren't sent (scripts may send
 * only terms). */
function filled(t: LoanTable): LoanTable {
  if (t?.source === "terms" && t.terms && !t.rows?.length && !termsProblem(t.terms))
    return termsTable(t.terms, t.from || t.terms.first);
  return t;
}

/** What the books say is owed (cents) at the end of `on`. */
async function owedOn(ledger: LedgerPort, loan: Pick<Loan, "book_id" | "accounts">, on: string) {
  const balances = await ledger.dayBalances(loan.book_id, loan.accounts.liability, on, on);
  return -cents(balances.days.at(-1)?.balance ?? balances.before);
}

/** The last due date on or before `on`, if any. */
const lastDue = (l: Pick<Loan, "tables">, on: string) =>
  nominalDates(loanRule(l), null, on).at(-1) ?? null;

/** The loan as the API shows it: with its schedule's pause and auto-confirm, and its status
 * (`brief`: without the payments ahead, for lists). */
export async function loanView(
  db: AppDb,
  ledger: LedgerPort,
  loan: StoredLoan,
  { brief = false, on }: { brief?: boolean; on?: string } = {}
): Promise<LoanView> {
  const { user_id: _user, ...rest } = loan;
  const schedule = db.schedule(loan.book_id, loan.schedule_id);
  const today = on ?? bookToday(db, loan.book_id);
  const owed = await owedOn(ledger, loan, today);
  const ahead = project(loan, schedule?.last_applied ?? null, owed);
  const accounts = new Set(loan.others.map((o) => o.account));
  return {
    ...rest,
    auto_confirm: schedule?.auto_confirm ?? false,
    paused: schedule?.paused ?? false,
    status: {
      owed: money(owed),
      as_of: today,
      next: ahead[0] ?? null,
      ahead: brief ? [] : ahead,
      interest_ahead: money(ahead.reduce((sum, p) => sum + cents(p.interest), 0n)),
      paid: db.occurrencesFrom(loan.schedule_id, "0000-00-00").map((o) => ({
        nominal: o.nominal,
        date: o.date,
        transaction_id: o.transaction_id,
      })),
      paid_from: db
        .schedules(loan.book_id)
        .filter((s) => s.id !== loan.schedule_id)
        .flatMap((s) => {
          const from = s.template.postings.find((p) => accounts.has(p.account));
          return from
            ? [
                {
                  schedule_id: s.id,
                  name: s.name,
                  account: from.account,
                  next: scheduleView(s).next?.date ?? null,
                },
              ]
            : [];
        }),
    },
  };
}

/** Bring the loan's schedule up to date with the loan: its rule, name, and the next payment as
 * its template. */
async function syncSchedule(db: AppDb, ledger: LedgerPort, loan: StoredLoan, on?: string) {
  const schedule = db.schedule(loan.book_id, loan.schedule_id);
  if (!schedule) return;
  const owed = await owedOn(ledger, loan, on ?? bookToday(db, loan.book_id));
  const next = project(loan, schedule.last_applied, owed, 1)[0] ?? null;
  db.setScheduleTemplate(schedule.id, {
    name: loan.name,
    rule: loanRule(loan),
    template: loanTemplate(loan, next),
  });
}

/**
 * Declare a loan, owned by `user`, with how it comes into the books (its history), and stage
 * what's due (`on`, by default today in the book's time zone): from the start, every payment
 * since its first; otherwise, from the next one.
 */
export async function createLoan({
  db,
  ledgerFor,
  user,
  book,
  input,
  on,
}: Services & { input: LoanIn | null }): Promise<LoanView> {
  const ledger = ledgerFor(user);
  if (!(await ledger.book(book))) throw new LoanProblem(404, "not found");
  if (!input) throw new LoanProblem(422, "send a loan");
  const today = on ?? bookToday(db, book);
  const loan = {
    name: input.name?.trim() ?? "",
    accounts: { ...input.accounts, asset: input.accounts?.asset || null },
    tables: input.table ? [filled(input.table)] : [],
    others: input.others ?? [],
    extras: input.extras ?? [],
    tolerance: input.tolerance || "0",
  };
  const setup = input.setup ?? {};
  const before = await ledger.accounts(book);
  const chart = withOpened(before, setup);
  const problem =
    loanProblem(loan) ?? accountsProblem(chart, loan) ?? setupProblem(setup, before, chart, loan);
  if (problem) throw new LoanProblem(422, problem);
  const currency = input.currency || "USD";
  const history = input.history;
  const first = loan.tables[0]!.rows[0]!.date;

  // How it comes into the books.
  const liability = (await ledger.summary(book, [loan.accounts.liability]))[0];
  const owesAlready = liability?.balance.some((b) => cents(b.number) !== 0n) ?? false;
  let lastApplied: string | null = null;
  let opening: { on: string; owed: string; against: string; flag: "*" | "!" } | null = null;
  if (history?.kind === "start") {
    if (!DATE.test(history.on) || history.on > first)
      throw new LoanProblem(422, "The borrowing is on or before the first payment");
    if (owesAlready)
      throw new LoanProblem(
        422,
        `${loan.accounts.liability} already says what's owed: choose "Already in the books"`
      );
    opening = {
      on: history.on,
      owed: tableStarts(loan.tables[0]!),
      against: history.against || OPENING_BALANCES,
      flag: history.confirm ? "*" : "!",
    };
  } else if (history?.kind === "today") {
    if (!DATE.test(history.on)) throw new LoanProblem(422, "Choose the day it's owed on");
    if (!AMOUNT.test(history.owed) || cents(history.owed) <= 0n)
      throw new LoanProblem(422, "What's owed is an amount, like 232357.56");
    if (owesAlready)
      throw new LoanProblem(
        422,
        `${loan.accounts.liability} already says what's owed: choose "Already in the books"`
      );
    opening = {
      on: history.on,
      owed: history.owed,
      against: history.against || OPENING_BALANCES,
      flag: "*",
    };
    lastApplied = lastDue(loan, history.on);
  } else if (history?.kind === "books") {
    lastApplied = lastDue(loan, today);
  } else {
    throw new LoanProblem(422, "Say how its history comes into the books");
  }

  // Everything's been checked: the setup's accounts open first, in one write.
  if (setup.open?.length)
    await ledger.createAccounts(
      book,
      setup.open.map((a) => ({
        name: a.name,
        kind: "leaf",
        ...(a.opening
          ? { opening_balance: { amount: a.opening.amount, currency, date: a.opening.date } }
          : {}),
        ...(a.revalue_every ? { revalue_every: a.revalue_every } : {}),
      }))
    );
  if (setup.outflows?.length) {
    const accounts = await ledger.accounts(book);
    for (const o of setup.outflows) {
      const found = accounts.find((a) => a.name === o.account)!;
      await ledger.setAccount(book, o.account, {
        updated_at: found.updated_at!,
        outflow: o.as,
      });
    }
  }

  if (opening) {
    const accounts = await ledger.accounts(book);
    if (!accounts.some((a) => a.name === opening.against)) {
      if (opening.against !== OPENING_BALANCES)
        throw new LoanProblem(422, `${opening.against} isn't an open account`);
      await ledger.createAccount(book, OPENING_BALANCES, { open: opening.on });
    }
    await ledger.createTransactions(book, [
      {
        date: opening.on,
        flag: opening.flag,
        payee: input.payee?.trim() || loan.name,
        narration: history.kind === "start" ? "Borrowed" : "What's owed",
        tags: [],
        links: [],
        meta: {},
        postings: [
          { account: loan.accounts.liability, units: { number: `-${opening.owed}`, currency } },
          { account: opening.against, units: { number: opening.owed, currency } },
        ],
      },
    ]);
  }
  if (history.kind === "start" || history.kind === "today") {
    // Payments before the paying account's books begin come from Opening Balances.
    const accounts = await ledger.accounts(book);
    if (!accounts.some((a) => a.name === OPENING_BALANCES))
      await ledger.createAccount(book, OPENING_BALANCES, { open: first });
  }

  const scheduleId = db.addSchedule({
    user_id: user,
    book_id: book,
    name: loan.name,
    rule: loanRule(loan),
    template: loanTemplate({ ...loan, payee: null, currency } as StoredLoan, null),
    paused: false,
    auto_confirm: input.auto_confirm ?? false,
  });
  if (lastApplied) db.setLastApplied(scheduleId, lastApplied);
  const id = db.addLoan({
    user_id: user,
    book_id: book,
    name: loan.name,
    payee: input.payee?.trim() || null,
    currency,
    accounts: loan.accounts,
    tolerance: loan.tolerance,
    schedule_id: scheduleId,
    tables: loan.tables,
    others: loan.others,
    extras: loan.extras,
    rebases: [],
    history,
  });
  await runSchedules({
    db,
    ledgerFor,
    on: today,
    id: scheduleId,
    ...(history.kind === "start" ? { flag: history.confirm ? "*" : "!" } : {}),
  });
  const made = db.loan(book, id)!;
  await syncSchedule(db, ledger, made, today);

  // Escrow, once the payments are in, holds what the lender says it does.
  if (setup.escrow_balance) {
    const { account, amount, on: day } = setup.escrow_balance;
    const balances = await ledger.dayBalances(book, account, day, day);
    const difference = cents(amount) - cents(balances.days.at(-1)?.balance ?? balances.before);
    if (difference !== 0n) {
      if (!(await ledger.accounts(book)).some((a) => a.name === OPENING_BALANCES))
        await ledger.createAccount(book, OPENING_BALANCES, { open: day });
      await ledger.createTransactions(book, [
        {
          date: day,
          flag: "*",
          payee: input.payee?.trim() || loan.name,
          narration: "What escrow holds",
          tags: [],
          links: [],
          meta: {},
          postings: [
            { account, units: { number: money(difference), currency } },
            { account: OPENING_BALANCES, units: { number: money(-difference), currency } },
          ],
        },
      ]);
    }
  }
  for (const bill of setup.bills ?? [])
    await createSchedule({ db, ledgerFor, user, book, input: bill, on: today });
  return loanView(db, ledger, made, { on: today });
}

/** The earliest date a change between two loans touches: from it on, payments change. */
function changedSince(before: StoredLoan, after: StoredLoan): string | null {
  const dates: string[] = [];
  const diff = <T extends { from: string }>(a: T[], b: T[]) => {
    const key = (x: T) => JSON.stringify(x);
    const left = new Set(a.map(key));
    const right = new Set(b.map(key));
    for (const x of a) if (!right.has(key(x))) dates.push(x.from);
    for (const x of b) if (!left.has(key(x))) dates.push(x.from);
  };
  diff(before.tables, after.tables);
  diff(before.others, after.others);
  diff(before.extras, after.extras);
  if (
    JSON.stringify(before.accounts) !== JSON.stringify(after.accounts) ||
    before.tolerance !== after.tolerance ||
    before.payee !== after.payee ||
    before.name !== after.name
  )
    dates.push("0000-00-00");
  return dates.sort()[0] ?? null;
}

/**
 * Change a loan (only the fields given), against the version read. Unconfirmed payments from the
 * earliest date a change touches are filled in again; confirmed ones stay as they are. Pausing
 * and auto-confirming are its schedule's.
 */
export async function editLoan({
  db,
  ledgerFor,
  user,
  book,
  id,
  patch,
  on,
}: Services & { id: string; patch: LoanPatch | null }): Promise<LoanView> {
  const ledger = ledgerFor(user);
  if (!(await ledger.book(book))) throw new LoanProblem(404, "not found");
  const current = db.loan(book, id);
  if (!current) throw new LoanProblem(404, "not found");
  if (!patch?.updated_at) throw new LoanProblem(422, "send the updated_at you read");
  if (patch.updated_at !== current.updated_at)
    throw new LoanProblem(409, "the loan changed since it was read");
  const merged: StoredLoan = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.payee !== undefined ? { payee: patch.payee?.trim() || null } : {}),
    ...(patch.accounts
      ? {
          accounts: {
            ...current.accounts,
            ...patch.accounts,
            liability: current.accounts.liability,
            asset:
              patch.accounts.asset !== undefined
                ? patch.accounts.asset || null
                : current.accounts.asset,
          },
        }
      : {}),
    ...(patch.tables ? { tables: patch.tables.map(filled) } : {}),
    ...(patch.others ? { others: patch.others } : {}),
    ...(patch.extras ? { extras: patch.extras } : {}),
    ...(patch.tolerance !== undefined ? { tolerance: patch.tolerance || "0" } : {}),
  };
  const problem = loanProblem(merged) ?? accountsProblem(await ledger.accounts(book), merged);
  if (problem) throw new LoanProblem(422, problem);

  db.updateLoan(book, id, current.updated_at, {
    name: merged.name,
    payee: merged.payee,
    accounts: merged.accounts,
    tolerance: merged.tolerance,
    tables: merged.tables,
    others: merged.others,
    extras: merged.extras,
  });
  const schedule = db.schedule(book, current.schedule_id);
  if (schedule && (patch.paused !== undefined || patch.auto_confirm !== undefined))
    db.updateSchedule(book, schedule.id, schedule.updated_at, {
      ...(patch.paused !== undefined ? { paused: patch.paused } : {}),
      ...(patch.auto_confirm !== undefined ? { auto_confirm: patch.auto_confirm } : {}),
    });
  const saved = db.loan(book, id)!;
  const since = changedSince(current, saved);
  if (since) await refillLoanPayments(db, ledger, saved, since);
  await runSchedules({ db, ledgerFor, id: saved.schedule_id, ...(on ? { on } : {}) });
  await syncSchedule(db, ledger, saved, on);
  return loanView(db, ledger, db.loan(book, id)!, { ...(on ? { on } : {}) });
}

/**
 * What the lender says was owed at the end of `on`: the difference from the books is written as
 * an adjustment on that date (the liability against `account`, interest by default), so the
 * books say what the lender does, and the payments after it are filled in again.
 */
export async function rebaseLoan({
  db,
  ledgerFor,
  user,
  book,
  id,
  input,
  on,
}: Services & { id: string; input: LoanRebaseIn | null }): Promise<LoanView> {
  const ledger = ledgerFor(user);
  const current = db.loan(book, id);
  if (!current || !(await ledger.book(book))) throw new LoanProblem(404, "not found");
  if (!input?.updated_at) throw new LoanProblem(422, "send the updated_at you read");
  if (input.updated_at !== current.updated_at)
    throw new LoanProblem(409, "the loan changed since it was read");
  if (!DATE.test(input.on)) throw new LoanProblem(422, "Choose the day the lender's figure is for");
  if (!/^-?\d+(\.\d{1,2})?$/.test(input.owed))
    throw new LoanProblem(422, "What's owed is an amount, like 232357.56");
  const account = input.account || current.accounts.interest;
  const problem = accountProblem(await ledger.accounts(book), account, "the adjustment");
  if (problem) throw new LoanProblem(422, problem);
  const books = await owedOn(ledger, current, input.on);
  const difference = cents(input.owed) - books;
  if (difference === 0n)
    throw new LoanProblem(422, `The books already say ${money(books)} is owed`);
  const [made] = await ledger.createTransactions(book, [
    {
      date: input.on,
      flag: "*",
      payee: current.payee || current.name,
      narration: "Adjusted to what the lender says is owed",
      tags: [],
      links: [],
      meta: {},
      postings: [
        {
          account: current.accounts.liability,
          units: { number: money(-difference), currency: current.currency },
        },
        { account, units: { number: money(difference), currency: current.currency } },
      ],
    },
  ]);
  db.updateLoan(book, id, current.updated_at, {
    rebases: [
      ...current.rebases,
      {
        on: input.on,
        owed: money(cents(input.owed)),
        difference: money(difference),
        account,
        transaction_id: made!.id,
      },
    ],
  });
  const saved = db.loan(book, id)!;
  await refillLoanPayments(db, ledger, saved, addDays(input.on, 1));
  await syncSchedule(db, ledger, saved, on);
  return loanView(db, ledger, saved, { ...(on ? { on } : {}) });
}

/**
 * An extra payment toward principal: a transaction from the paying account (or `from`) to what's
 * owed on `date`, then the payments after it filled in again, since they now owe less.
 */
export async function extraPayment({
  db,
  ledgerFor,
  user,
  book,
  id,
  input,
  on,
}: Services & {
  id: string;
  input: { date: string; amount: string; from?: string | null } | null;
}): Promise<LoanView> {
  const ledger = ledgerFor(user);
  const loan = db.loan(book, id);
  if (!loan || !(await ledger.book(book))) throw new LoanProblem(404, "not found");
  if (!input || !DATE.test(input.date)) throw new LoanProblem(422, "Choose the payment's date");
  if (!AMOUNT.test(input.amount) || cents(input.amount) <= 0n)
    throw new LoanProblem(422, "The extra payment is an amount, like 1000.00");
  const from = input.from || loan.accounts.paying;
  const problem = accountProblem(await ledger.accounts(book), from, "what pays it");
  if (problem) throw new LoanProblem(422, problem);
  const owed = await owedOn(ledger, loan, input.date);
  if (cents(input.amount) > owed)
    throw new LoanProblem(422, `That's more than the ${money(owed)} owed then`);
  const amount = money(cents(input.amount));
  await ledger.createTransactions(book, [
    {
      date: input.date,
      flag: "*",
      payee: loan.payee || loan.name,
      narration: "Extra payment toward principal",
      tags: [],
      links: [],
      meta: {},
      postings: [
        { account: from, units: { number: `-${amount}`, currency: loan.currency } },
        { account: loan.accounts.liability, units: { number: amount, currency: loan.currency } },
      ],
    },
  ]);
  await refillLoanPayments(db, ledger, loan, addDays(input.date, 1));
  await syncSchedule(db, ledger, loan, on);
  return loanView(db, ledger, loan, { ...(on ? { on } : {}) });
}

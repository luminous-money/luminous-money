/**
 * Loans: the amortization table and what each payment is, shared by the server (which stages
 * payments) and the PWA (which previews them), so both agree.
 *
 * A loan's payment is principal and interest, plus any **others** (escrow, PMI, fees), each an
 * account and an amount from a date. Its **tables** say what the payments were planned to be:
 * the first is where the loan starts (worked out from terms, or imported rows), and a later one
 * takes over from its date (the lender's new schedule). **Extras** are extra principal with every
 * payment from a date.
 *
 * **The books win; the table is where they start** (Kael). A payment is its table's row while
 * the books agree with the table (what's owed before it is what the row says was owed, to the
 * cent), so an imported table is honored as the lender wrote it. Otherwise (after an extra
 * payment, say) it's worked out from the books: interest is the rate on what's owed, and
 * principal is the rest of the table's payment, which stays the same, so the loan ends sooner.
 *
 * Amounts are decimal strings, worked in integer cents (BigInt) so nothing passes through
 * floating point but the one formula for a payment, which is rounded to cents at once.
 */
import { nominalDates, type Rule } from "./schedule.js";

/** What a table is worked out from. */
export type LoanTerms = {
  /** What was borrowed (or is owed when the table starts). */
  amount: string;
  /** The yearly rate, as a percent: "3.75". */
  rate: string;
  /** How many payments. */
  payments: number;
  /** The first payment's due date. */
  first: string;
  /** Principal and interest per payment, when the lender's differs from the worked-out one;
   * null to work it out. */
  payment: string | null;
};

/** One payment in a table. `balance` is what's owed after it. */
export type LoanRow = {
  number: number;
  date: string;
  principal: string;
  interest: string;
  balance: string;
};

/** An amortization table, from a date: worked out from terms, or imported. */
export type LoanTable = {
  /** The first payment date it governs. */
  from: string;
  source: "terms" | "csv" | "ai";
  /** What it was worked out from (`terms` tables). */
  terms: LoanTerms | null;
  /** The yearly rate, as a percent: the terms', or worked out from the rows. */
  rate: string;
  /** Principal and interest per payment: the terms', or the rows' usual one. */
  payment: string;
  rows: LoanRow[];
};

/** A part of the payment beyond principal and interest, from a date: escrow, PMI, a fee. A
 * later version of the same name changes it; an amount of 0 ends it. */
export type LoanOther = { name: string; account: string; amount: string; from: string };

/** Extra principal with every payment from a date (0 ends it). */
export type LoanExtra = { amount: string; from: string };

/** What the lender said was owed on a date, and the adjustment that made the books agree. */
export type LoanRebase = {
  on: string;
  owed: string;
  /** What the adjustment changed what's owed by (positive: more owed). */
  difference: string;
  /** The adjustment's other side. */
  account: string;
  transaction_id: string;
};

export type LoanAccounts = {
  /** What's owed. */
  liability: string;
  /** What pays it. */
  paying: string;
  /** Where interest goes. */
  interest: string;
  /** What it bought, if anything: a house, a car. */
  asset: string | null;
};

/**
 * How a loan already under way comes into the books:
 * - `start`: the borrowing on `on` (against `against`), then every payment due through today,
 *   confirmed or not;
 * - `today`: one transaction on `on` saying what's owed (`owed`, against `against`), then
 *   payments from the next one;
 * - `books`: the liability already says what's owed; payments from the next one.
 */
export type LoanHistory =
  | { kind: "start"; on: string; against: string; confirm: boolean }
  | { kind: "today"; on: string; owed: string; against: string }
  | { kind: "books" };

export type Loan = {
  id: string;
  book_id: string;
  name: string;
  payee: string | null;
  accounts: LoanAccounts;
  currency: string;
  tables: LoanTable[];
  others: LoanOther[];
  extras: LoanExtra[];
  rebases: LoanRebase[];
  /** How far the bank's amount may be from the payment's and still match it. */
  tolerance: string;
  auto_confirm: boolean;
  paused: boolean;
  history: LoanHistory;
  /** The schedule that stages its payments (M3). */
  schedule_id: string;
  created_at: string;
  updated_at: string;
};

export type LoanIn = {
  name: string;
  payee?: string | null;
  accounts: LoanAccounts;
  currency?: string;
  table: LoanTable;
  others?: LoanOther[];
  extras?: LoanExtra[];
  tolerance?: string;
  auto_confirm?: boolean;
  history: LoanHistory;
};

export type LoanPatch = {
  updated_at: string;
  name?: string;
  payee?: string | null;
  accounts?: Partial<Omit<LoanAccounts, "liability">>;
  tables?: LoanTable[];
  others?: LoanOther[];
  extras?: LoanExtra[];
  tolerance?: string;
  auto_confirm?: boolean;
  paused?: boolean;
};

/** A re-base: what the lender said was owed on a date, the difference going to `account`. */
export type LoanRebaseIn = { updated_at: string; on: string; owed: string; account: string };

/** One payment, worked out. */
export type Payment = {
  /** The due date. */
  nominal: string;
  /** Its table's row number, if it has one. */
  number: number | null;
  owed_before: string;
  interest: string;
  principal: string;
  extra: string;
  others: { name: string; account: string; amount: string }[];
  /** Everything paid. */
  total: string;
  owed_after: string;
  /** Whether it's the table's row as written (the books agreed with the table). */
  follows_table: boolean;
};

/** What a loan's page shows: what's owed, the next payment, and the rest worked out. */
export type LoanStatus = {
  /** What the books say is owed today. */
  owed: string;
  as_of: string;
  next: Payment | null;
  /** The payments still to come, worked out from what's owed, until it's paid off. */
  ahead: Payment[];
  /** Interest still to pay, over `ahead`. */
  interest_ahead: string;
  /** The payments staged so far: due date, date, and transaction. */
  paid: { nominal: string; date: string; transaction_id: string }[];
  /** Schedules paying out of the loan's others' asset accounts (escrow), for links. */
  paid_from: { schedule_id: string; name: string; account: string; next: string | null }[];
};

export type LoanView = Loan & { status: LoanStatus };

/** A schedule read by the AI: its rows, what it prints of its terms, and the escrow it shows. */
export type LoanRead = {
  rows: LoanRow[];
  lender: string | null;
  terms: {
    amount: string | null;
    rate: string | null;
    payments: number | null;
    first: string | null;
  };
  /** The usual escrow per payment, if the schedule has a column for it. */
  escrow: string | null;
  note: string | null;
  /** What reading it cost (USD), if known. */
  ai_cost: number | null;
};

// Cents

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** A decimal string as integer cents, rounded half away from zero past two places. */
export function cents(value: string): bigint {
  if (!DECIMAL.test(value)) throw new Error(`not an amount: ${value}`);
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  let units = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) units += 1n;
  return negative ? -units : units;
}

/** Cents as a decimal string with two places. */
export function money(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** `a × b / c`, rounded half away from zero, for positive c. */
function scaledDiv(a: bigint, b: bigint, c: bigint): bigint {
  const n = a * b;
  const q = n / c;
  const r = n % c;
  const up = (r < 0n ? -r : r) * 2n >= c;
  return up ? q + (n < 0n ? -1n : 1n) : q;
}

/** A rate ("3.75") as a scaled integer and its scale. */
function rateParts(rate: string): { units: bigint; scale: bigint } {
  if (!/^\d+(\.\d+)?$/.test(rate)) throw new Error(`not a rate: ${rate}`);
  const [whole = "0", fraction = ""] = rate.split(".");
  return { units: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
}

/** A month's interest on `owed` (cents) at a yearly `rate` (a percent). */
export function interestOn(owed: bigint, rate: string): bigint {
  const { units, scale } = rateParts(rate);
  return scaledDiv(owed, units, 1200n * scale);
}

/** Principal and interest per payment, to pay `amount` off over `payments` months at `rate`. */
export function paymentFor(amount: string, rate: string, payments: number): string {
  const principal = Number(amount);
  const r = Number(rate) / 1200;
  if (!(payments > 0)) return money(0n);
  const each = r === 0 ? principal / payments : (principal * r) / (1 - (1 + r) ** -payments);
  return money(BigInt(Math.round(each * 100)));
}

/** Monthly due dates from `first`, as schedules count them (a short month takes its last day). */
export const dueRule = (first: string): Rule => ({
  every: 1,
  unit: "month",
  days: [],
  start: first,
  until: null,
  weekend: "keep",
});

/** `count` monthly due dates from `first` (inclusive). */
export function dueDates(first: string, count: number): string[] {
  const end = new Date(Date.parse(`${first}T00:00:00Z`));
  end.setUTCMonth(end.getUTCMonth() + count + 1);
  return nominalDates(dueRule(first), null, end.toISOString().slice(0, 10)).slice(0, count);
}

/** Why terms can't be worked out, or null if they can. */
export function termsProblem(t: LoanTerms): string | null {
  if (!/^\d+(\.\d{1,2})?$/.test(t.amount) || cents(t.amount) <= 0n)
    return "The amount borrowed is a number, like 300000.00";
  if (!/^\d+(\.\d+)?$/.test(t.rate) || Number(t.rate) >= 100)
    return "The rate is a yearly percent, like 3.75";
  if (!Number.isInteger(t.payments) || t.payments < 1 || t.payments > 1200)
    return "The term is a number of monthly payments, 1 to 1200";
  if (!/^\d{4}-\d\d-\d\d$/.test(t.first)) return "Choose the first payment's date";
  if (t.payment !== null && (!/^\d+(\.\d{1,2})?$/.test(t.payment) || cents(t.payment) <= 0n))
    return "The payment is a number, like 1389.35";
  return null;
}

/** The table that pays `terms` off: each month's interest on what's owed, the rest of the
 * payment to principal, the last payment whatever is left. */
export function amortize(terms: LoanTerms): LoanRow[] {
  const payment = cents(terms.payment ?? paymentFor(terms.amount, terms.rate, terms.payments));
  let owed = cents(terms.amount);
  const rows: LoanRow[] = [];
  for (const [i, date] of dueDates(terms.first, terms.payments).entries()) {
    if (owed <= 0n) break;
    const interest = interestOn(owed, terms.rate);
    let principal = payment - interest;
    if (principal > owed || i === terms.payments - 1) principal = owed;
    owed -= principal;
    rows.push({
      number: i + 1,
      date,
      principal: money(principal),
      interest: money(interest),
      balance: money(owed),
    });
  }
  return rows;
}

/** A table worked out from terms. */
export function termsTable(terms: LoanTerms, from = terms.first): LoanTable {
  return {
    from,
    source: "terms",
    terms,
    rate: terms.rate,
    payment: terms.payment ?? paymentFor(terms.amount, terms.rate, terms.payments),
    rows: amortize(terms),
  };
}

/** What was owed before a row: its balance plus its principal. */
export const owedBefore = (row: LoanRow) => cents(row.balance) + cents(row.principal);

/** What's wrong with imported rows, row by row: what doesn't add up. An empty list if nothing. */
export function rowProblems(rows: LoanRow[]): { number: number; problem: string }[] {
  const out: { number: number; problem: string }[] = [];
  rows.forEach((row, i) => {
    const say = (problem: string) => void out.push({ number: row.number, problem });
    if (!/^\d{4}-\d\d-\d\d$/.test(row.date)) return say("its date doesn't read");
    if (![row.principal, row.interest, row.balance].every((v) => DECIMAL.test(v)))
      return say("its amounts don't read");
    const before = rows[i - 1];
    if (before && row.date <= before.date) say("it's dated on or before the one above it");
    if (before) {
      const gap = cents(before.balance) - cents(row.principal) - cents(row.balance);
      if (gap > 1n || gap < -1n)
        say(
          `what's owed after it should be ${money(cents(before.balance) - cents(row.principal))}`
        );
    }
  });
  return out;
}

/** The yearly rate (a percent, three places) the rows charge: the median of each row's
 * interest on what was owed before it, so a short first period doesn't skew it. */
export function rateOf(rows: LoanRow[]): string {
  const rates = rows
    .slice(0, 24)
    .filter((r) => owedBefore(r) > 0n)
    .map((r) => (Number(cents(r.interest)) / Number(owedBefore(r))) * 1200)
    .sort((a, b) => a - b);
  if (!rates.length) return "0";
  const median = rates[Math.floor(rates.length / 2)]!;
  return String(Math.round(median * 1000) / 1000);
}

/** The usual principal and interest per payment in rows: the most common, so a different
 * first or last payment doesn't count. */
export function paymentOf(rows: LoanRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const p = money(cents(r.principal) + cents(r.interest));
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "0.00";
}

/** A table from imported rows (a CSV, or read by the AI), its rate and payment worked out. */
export function importedTable(rows: LoanRow[], source: "csv" | "ai", from?: string): LoanTable {
  return {
    from: from ?? rows[0]?.date ?? "",
    source,
    terms: null,
    rate: rateOf(rows),
    payment: paymentOf(rows),
    rows,
  };
}

/** What a table starts owing: before its first row. */
export const tableStarts = (t: LoanTable) => (t.rows[0] ? money(owedBefore(t.rows[0])) : "0.00");

type Spec = Pick<Loan, "tables" | "others" | "extras">;

/** The table in force on `date`: the latest from on or before it (the first, before any). */
export function tableOn(spec: Pick<Spec, "tables">, date: string): LoanTable {
  const sorted = [...spec.tables].sort((a, b) => a.from.localeCompare(b.from));
  return sorted.filter((t) => t.from <= date).at(-1) ?? sorted[0]!;
}

/** The others in force on `date`: each name's latest version from on or before it, unless 0. */
export function othersOn(others: LoanOther[], date: string): LoanOther[] {
  const latest = new Map<string, LoanOther>();
  for (const o of [...others].sort((a, b) => a.from.localeCompare(b.from)))
    if (o.from <= date) latest.set(o.name, o);
  return [...latest.values()].filter((o) => cents(o.amount) !== 0n);
}

/** Extra principal in force on `date`, in cents. */
export function extraOn(extras: LoanExtra[], date: string): bigint {
  const latest = [...extras]
    .sort((a, b) => a.from.localeCompare(b.from))
    .filter((e) => e.from <= date)
    .at(-1);
  return latest ? cents(latest.amount) : 0n;
}

/** The row due in `nominal`'s month, if the table has one. */
const rowFor = (t: LoanTable, nominal: string) =>
  t.rows.find((r) => r.date.slice(0, 7) === nominal.slice(0, 7));

/**
 * The payment due on `nominal`, with `owed` (cents) owed before it: the table's row if the books
 * agree with it, else worked out from what's owed. Null once nothing's owed.
 */
export function paymentOn(spec: Spec, nominal: string, owed: bigint): Payment | null {
  if (owed <= 0n) return null;
  const table = tableOn(spec, nominal);
  const row = rowFor(table, nominal);
  const follows = !!row && owedBefore(row) === owed;
  const interest = follows ? cents(row.interest) : interestOn(owed, table.rate);
  let principal = follows ? cents(row.principal) : cents(table.payment) - interest;
  if (principal > owed) principal = owed;
  let extra = extraOn(spec.extras, nominal);
  if (extra > owed - principal) extra = owed - principal;
  if (extra < 0n) extra = 0n;
  const others = othersOn(spec.others, nominal).map(({ name, account, amount }) => ({
    name,
    account,
    amount: money(cents(amount)),
  }));
  const total = others.reduce((sum, o) => sum + cents(o.amount), principal + extra + interest);
  return {
    nominal,
    number: row?.number ?? null,
    owed_before: money(owed),
    interest: money(interest),
    principal: money(principal),
    extra: money(extra),
    others,
    total: money(total),
    owed_after: money(owed - principal - extra),
    follows_table: follows,
  };
}

/** The loan's due dates: monthly, on its first table's first payment's day. */
export const loanRule = (spec: Pick<Spec, "tables">): Rule =>
  dueRule(
    [...spec.tables].sort((a, b) => a.from.localeCompare(b.from))[0]?.rows[0]?.date ?? "1970-01-01"
  );

/**
 * The payments from the first due date after `after` (or from the start), with `owed` (cents)
 * owed before the first, each paying down what the next owes, until it's paid off or `limit`.
 */
export function project(spec: Spec, after: string | null, owed: bigint, limit = 1200): Payment[] {
  const rule = loanRule(spec);
  const out: Payment[] = [];
  let from = after;
  while (out.length < limit) {
    const through = new Date(Date.parse(`${from ?? rule.start}T00:00:00Z`));
    through.setUTCMonth(through.getUTCMonth() + 25);
    const dates = nominalDates(rule, from, through.toISOString().slice(0, 10));
    if (!dates.length) break;
    for (const nominal of dates) {
      const p = paymentOn(spec, nominal, owed);
      if (!p || out.length >= limit) return out;
      out.push(p);
      owed = cents(p.owed_after);
      from = nominal;
    }
  }
  return out;
}

/** The other that takes up a matched amount's difference: escrow (by name, else the first that
 * goes to an asset), or none, when principal does (Kael: a bill that differs is most often an
 * escrow change not recorded yet). */
export function absorbingOther(p: Pick<Payment, "others">): number {
  const named = p.others.findIndex((o) => /escrow/i.test(o.name));
  return named >= 0 ? named : p.others.findIndex((o) => o.account.startsWith("Assets:"));
}

/** A payment's splits: the paying account the total, the liability principal and extra,
 * interest, and each other. With `absorb` (a match tolerance, or the bank's amount kept), one is
 * left blank to take up the difference between the bank's amount and the total: escrow if the
 * payment has it, else principal. */
export function paymentPostings(
  accounts: Pick<LoanAccounts, "liability" | "paying" | "interest">,
  p: Payment,
  currency: string,
  { absorb = false }: { absorb?: boolean } = {}
): { account: string; units: { number: string; currency: string } | null }[] {
  const units = (number: string) => ({ number, currency });
  const paid = money(cents(p.principal) + cents(p.extra));
  const escrow = absorb ? absorbingOther(p) : -1;
  return [
    { account: accounts.paying, units: units(money(-cents(p.total))) },
    { account: accounts.liability, units: absorb && escrow < 0 ? null : units(paid) },
    ...(cents(p.interest) !== 0n ? [{ account: accounts.interest, units: units(p.interest) }] : []),
    ...p.others.map((o, i) => ({
      account: o.account,
      units: i === escrow ? null : units(o.amount),
    })),
  ];
}

/** Why a loan can't be saved, or null if it can. */
export function loanProblem(l: {
  name: string;
  accounts: LoanAccounts;
  tables: LoanTable[];
  others: LoanOther[];
  extras: LoanExtra[];
  tolerance: string;
}): string | null {
  if (!l.name.trim()) return "Name the loan";
  const { liability, paying, interest } = l.accounts;
  if (!liability.startsWith("Liabilities:")) return "What's owed is a liability account";
  if (!paying) return "Choose the account that pays it";
  if (!interest) return "Choose where interest goes";
  if (new Set([liability, paying, interest]).size < 3)
    return "What's owed, what pays it and where interest goes are three different accounts";
  if (!l.tables.length || l.tables.some((t) => !t.rows.length)) return "The table has no payments";
  for (const t of l.tables) {
    if (!/^\d+(\.\d+)?$/.test(t.rate)) return "A table's rate is a yearly percent, like 3.75";
    if (!DECIMAL.test(t.payment) || cents(t.payment) <= 0n)
      return "A table's payment is an amount, like 1389.35";
    const problems = rowProblems(t.rows);
    if (problems.length)
      return `Payment ${problems[0]!.number} in the table doesn't add up: ${problems[0]!.problem}`;
  }
  for (const o of l.others) {
    if (!o.name.trim()) return "Name each other part of the payment";
    if (!o.account) return `Choose an account for ${o.name}`;
    if ([liability, paying].includes(o.account))
      return `${o.name} goes to an account of its own, not what's owed or what pays it`;
    if (!/^\d+(\.\d{1,2})?$/.test(o.amount)) return `${o.name}'s amount is a number, like 450.00`;
    if (!/^\d{4}-\d\d-\d\d$/.test(o.from)) return `Choose when ${o.name}'s amount starts`;
  }
  for (const e of l.extras)
    if (!/^\d+(\.\d{1,2})?$/.test(e.amount) || !/^\d{4}-\d\d-\d\d$/.test(e.from))
      return "Extra principal is an amount from a date";
  if (!/^\d+(\.\d{1,2})?$/.test(l.tolerance)) return "The match tolerance is an amount, like 25.00";
  return null;
}

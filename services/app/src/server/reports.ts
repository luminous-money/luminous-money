/**
 * Reports (M12): `app` reads the ledger's posting stream (`transactions/compact`, only the
 * window each report needs) and runs `@luminous-money/ledger-graphs-api` over it, so the PWA
 * gets datasets ready to draw. The caller passes "today" (`on`), as budgets do.
 *
 * - **Spent this month:** expenses under the highest-level expense budgets (or all of them
 *   without budgets) against those budgets per month, and a month simulated from the last 12.
 * - **Cash flow** (6 months), **breakdowns** (6-month averages, or this month), **largest
 *   transactions** (this month), **net worth** (24 month ends), and an account's **typical
 *   periods** (12 months for weeks and months, 5 years for years).
 */
import {
  breakdown,
  cashFlow,
  DEFAULT_ROOTS,
  fromTransactions,
  largestTransactions,
  netWorth,
  spendingThisMonth,
  typicalPeriods,
  type Posting,
  type Price,
  type Roots,
} from "@luminous-money/ledger-graphs-api";

import type { BudgetStatus, LedgerPort } from "./ledger.js";

export class ReportProblem extends Error {
  constructor(
    readonly status: 404 | 422,
    message: string
  ) {
    super(message);
  }
}

/** The first of the month `n` months before `date`'s. */
function monthsBefore(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) - n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

async function context(ledger: LedgerPort, book: string) {
  const [info, accounts] = await Promise.all([ledger.book(book), ledger.accounts(book)]);
  if (!info) throw new ReportProblem(404, "not found");
  // The book's own names for its top-level accounts, by type.
  const roots: Roots = { ...DEFAULT_ROOTS };
  const keys = {
    asset: "assets",
    liability: "liabilities",
    equity: "equity",
    income: "income",
    expense: "expenses",
  } as const;
  for (const a of accounts) if (!a.name.includes(":") && a.type) roots[keys[a.type]] = a.name;
  return { currency: info.currency, accounts, roots };
}

const stream = async (ledger: LedgerPort, book: string, from: string): Promise<Posting[]> =>
  fromTransactions(await ledger.compact(book, from));

/** The highest-level expense budgets: the accounts home's budget figure covers. */
export function topExpenseBudgets(status: BudgetStatus): string[] {
  const expense = status.lines.filter((l) => l.type === "expense").map((l) => l.account);
  return expense.filter((a) => !expense.some((b) => b !== a && a.startsWith(`${b}:`)));
}

export async function spendingReport(ledger: LedgerPort, book: string, on: string) {
  const [{ currency, roots }, status, postings] = await Promise.all([
    context(ledger, book),
    ledger.budgetStatus(book, on, "month"),
    stream(ledger, book, monthsBefore(on, 12)),
  ]);
  return spendingThisMonth({
    postings,
    today: on,
    currency,
    roots,
    accounts: topExpenseBudgets(status),
    budget: status.summary ? Number(status.summary.budget.number) : null,
  });
}

export async function cashFlowReport(ledger: LedgerPort, book: string, on: string, months = 6) {
  const [{ currency, roots }, postings] = await Promise.all([
    context(ledger, book),
    stream(ledger, book, monthsBefore(on, months - 1)),
  ]);
  return cashFlow({ postings, today: on, currency, months, roots });
}

export async function breakdownReport(
  ledger: LedgerPort,
  book: string,
  on: string,
  options: {
    side: "expenses" | "income";
    of?: string;
    depth?: number;
    slices?: number;
    window?: "average" | "month";
  }
) {
  const window = options.window ?? "average";
  const [{ currency, roots }, postings] = await Promise.all([
    context(ledger, book),
    stream(ledger, book, monthsBefore(on, window === "average" ? 6 : 0)),
  ]);
  const root = roots[options.side];
  if (options.of && !(options.of === root || options.of.startsWith(`${root}:`)))
    throw new ReportProblem(422, `${options.of} isn't under ${root}`);
  return breakdown({ postings, today: on, currency, roots, root, ...options, window });
}

export async function largestReport(ledger: LedgerPort, book: string, on: string, limit = 8) {
  const [{ currency, roots }, postings] = await Promise.all([
    context(ledger, book),
    stream(ledger, book, monthsBefore(on, 0)),
  ]);
  return largestTransactions({ postings, today: on, currency, roots, limit });
}

export async function netWorthReport(ledger: LedgerPort, book: string, on: string, months = 24) {
  const [{ currency, roots }, tree, postings] = await Promise.all([
    context(ledger, book),
    ledger.accountTree(book),
    stream(ledger, book, monthsBefore(on, months - 1)),
  ]);
  const balances = tree
    .filter((a) => a.name === roots.assets || a.name === roots.liabilities)
    .flatMap((a) =>
      a.total.map((t) => ({ account: a.name, amount: t.number, currency: t.currency }))
    );
  const commodities = new Set(
    [...balances.map((b) => b.currency), ...postings.map((p) => p.currency)].filter(
      (c) => c !== currency
    )
  );
  const prices: Price[] = (
    await Promise.all([...commodities].map((c) => ledger.priceHistory(book, c)))
  ).flatMap((list) =>
    list.map((p) => ({
      commodity: p.commodity,
      date: p.date,
      number: p.price.number,
      currency: p.price.currency,
    }))
  );
  return netWorth({ balances, postings, prices, today: on, currency, months, roots });
}

export async function typicalReport(
  ledger: LedgerPort,
  book: string,
  on: string,
  account: string,
  weekStart = 1
) {
  const { currency, roots, accounts } = await context(ledger, book);
  const found = accounts.find((a) => a.name === account);
  if (!found) throw new ReportProblem(404, `no ${account}`);
  if (found.type !== "expense" && found.type !== "income")
    throw new ReportProblem(422, "typical periods are for expense and income accounts");
  const postings = await stream(ledger, book, `${Number(on.slice(0, 4)) - 5}-01-01`);
  const since = postings.reduce<string | undefined>(
    (min, p) => (!min || p.date < min ? p.date : min),
    undefined
  );
  return typicalPeriods({ postings, account, today: on, currency, since, weekStart, roots });
}

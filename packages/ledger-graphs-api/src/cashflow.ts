import { under } from "./accounts.js";
import { addMonths, monthOf } from "./dates.js";
import { cents, units } from "./money.js";
import { DEFAULT_ROOTS, type Posting, type Roots } from "./types.js";

export type CashFlowMonth = {
  month: string;
  income: number;
  expenses: number;
  net: number;
  /** The current month, so far. */
  partial: boolean;
};

export type CashFlow = {
  currency: string;
  months: CashFlowMonth[];
  totals: { income: number; expenses: number; net: number; average_net: number };
};

/** Income and expenses for each of the last `months` months, this one (so far) included. */
export function cashFlow({
  postings,
  today,
  currency,
  months = 6,
  roots = DEFAULT_ROOTS,
}: {
  postings: Posting[];
  today: string;
  currency: string;
  months?: number;
  roots?: Roots;
}): CashFlow {
  const current = monthOf(today);
  const list = Array.from({ length: months }, (_, i) => addMonths(current, i - months + 1));
  const sums = new Map(list.map((m) => [m, { income: 0, expenses: 0 }]));
  for (const posting of postings) {
    const sum = sums.get(monthOf(posting.date));
    if (!sum || posting.currency !== currency || posting.date > today) continue;
    if (under(posting.account, roots.income)) sum.income -= cents(posting.amount);
    else if (under(posting.account, roots.expenses)) sum.expenses += cents(posting.amount);
  }
  const rows = list.map((month) => {
    const { income, expenses } = sums.get(month)!;
    return {
      month,
      income: units(income),
      expenses: units(expenses),
      net: units(income - expenses),
      partial: month === current,
    };
  });
  const income = [...sums.values()].reduce((n, s) => n + s.income, 0);
  const expenses = [...sums.values()].reduce((n, s) => n + s.expenses, 0);
  return {
    currency,
    months: rows,
    totals: {
      income: units(income),
      expenses: units(expenses),
      net: units(income - expenses),
      average_net: units((income - expenses) / months),
    },
  };
}

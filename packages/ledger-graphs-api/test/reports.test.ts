import { describe, expect, it } from "vitest";

import {
  atDepth,
  breakdown,
  cashFlow,
  fromTransactions,
  largestTransactions,
  netWorth,
  percentile,
  spendingThisMonth,
  typicalPeriods,
  type Posting,
} from "../src/index.js";

let n = 0;
/** A two-posting transaction: `amount` into `to`, out of `from`. */
function tx(
  date: string,
  to: string,
  from: string,
  amount: string,
  extra: Partial<Posting> = {}
): Posting[] {
  const id = `t${n++}`;
  const base = { transaction: id, date, currency: "USD", payee: null, narration: to, ...extra };
  const out = amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
  return [
    { ...base, account: to, amount },
    { ...base, account: from, amount: out },
  ];
}

const BANK = "Assets:Bank";
const spend = (date: string, account: string, amount: string, extra: Partial<Posting> = {}) =>
  tx(date, account, BANK, amount, extra);
const earn = (date: string, account: string, amount: string) => tx(date, BANK, account, amount);

/** A year of months: rent on the 1st, groceries weekly-ish, pay on the 15th. */
function history(months: string[]): Posting[] {
  return months.flatMap((m) => [
    ...spend(`${m}-01`, "Expenses:Housing:Rent", "2000.00"),
    ...spend(`${m}-05`, "Expenses:Food:Groceries", "100.00"),
    ...spend(`${m}-19`, "Expenses:Food:Groceries", "100.00"),
    ...spend(`${m}-20`, "Expenses:Food:Restaurants", "60.00"),
    ...earn(`${m}-15`, "Income:Salary", "5000.00"),
  ]);
}
const PAST = [
  "2025-10",
  "2025-11",
  "2025-12",
  ...Array.from({ length: 9 }, (_, i) => `2026-0${i + 1}`),
];
const TODAY = "2026-10-15";

describe("accounts", () => {
  it("finds the account a level of depth holds", () => {
    expect(atDepth("Expenses:Food:Groceries", "Expenses", 1)).toBe("Expenses:Food");
    expect(atDepth("Expenses:Food:Groceries", "Expenses", 2)).toBe("Expenses:Food:Groceries");
    expect(atDepth("Expenses:Fun", "Expenses", 3)).toBe("Expenses:Fun");
  });
});

describe("spending this month", () => {
  const postings = [
    ...history(PAST),
    ...spend("2026-10-01", "Expenses:Housing:Rent", "2000.00"),
    ...spend("2026-10-03", "Expenses:Food:Groceries", "45.10"),
    ...spend("2026-10-10", "Expenses:Home:Roof", "14000.00", { budgeted: false }),
    ...spend("2026-10-20", "Expenses:Food:Groceries", "99.00"), // after today
  ];
  const report = spendingThisMonth({ postings, today: TODAY, currency: "USD", budget: 3000 });

  it("runs the total to today, leaving out what's kept out of budgets", () => {
    expect(report.actual).toHaveLength(15);
    expect(report.actual[0]).toBe(2000);
    expect(report.actual[2]).toBe(2045.1);
    expect(report.spent).toBe(2045.1);
    expect(report.budget).toBe(3000);
    expect(report.days).toBe(31);
  });

  it("projects from the same days of past months, so the 1st's rent is on the 1st", () => {
    expect(report.projection).toHaveLength(31);
    expect(report.projection![0]).toBe(2000); // every past month paid rent on the 1st
    expect(report.projection![3]).toBe(2000);
    expect(report.projection![4]).toBe(2100);
    expect(report.projected_end).toBe(2260);
    // The same seed, the same answer.
    expect(spendingThisMonth({ postings, today: TODAY, currency: "USD" }).projection).toEqual(
      report.projection
    );
  });

  it("counts only the accounts asked for, and has no projection without history", () => {
    const food = spendingThisMonth({
      postings,
      today: TODAY,
      currency: "USD",
      accounts: ["Expenses:Food"],
    });
    expect(food.spent).toBe(45.1);
    const fresh = spendingThisMonth({
      postings: postings.slice(-8),
      today: TODAY,
      currency: "USD",
    });
    expect(fresh.projection).toBeNull();
  });
});

describe("cash flow", () => {
  it("has each month's income and expenses, this one so far, and the totals", () => {
    const postings = [...history(PAST), ...spend("2026-10-03", "Expenses:Food:Groceries", "50.00")];
    const report = cashFlow({ postings, today: TODAY, currency: "USD" });
    expect(report.months.map((m) => m.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(report.months[0]).toEqual({
      month: "2026-05",
      income: 5000,
      expenses: 2260,
      net: 2740,
      partial: false,
    });
    expect(report.months[5]).toMatchObject({ income: 0, expenses: 50, partial: true });
    expect(report.totals).toEqual({
      income: 25000,
      expenses: 11350,
      net: 13650,
      average_net: 2275,
    });
  });
});

describe("breakdown", () => {
  const postings = history(PAST);

  it("averages each category over the last complete months, largest first", () => {
    const report = breakdown({ postings, today: TODAY, currency: "USD" });
    expect(report.slices.map((s) => [s.label, s.amount, s.more])).toEqual([
      ["Housing", 2000, true],
      ["Food", 260, true],
    ]);
    expect(report.total).toBe(2260);
    expect(report.slices[0]!.share).toBeCloseTo(2000 / 2260);
  });

  it("drills into a category, and groups what's past the slices as Other", () => {
    const report = breakdown({
      postings,
      today: TODAY,
      currency: "USD",
      of: "Expenses:Food",
      slices: 1,
    });
    expect(report.of).toBe("Expenses:Food");
    expect(report.slices.map((s) => s.label)).toEqual(["Groceries", "Restaurants"]); // one left: itself
    const deep = breakdown({ postings, today: TODAY, currency: "USD", depth: 2, slices: 1 });
    expect(deep.slices.map((s) => s.label)).toEqual(["Rent"]);
    expect(deep.other).toEqual({
      amount: 260,
      share: 260 / 2260,
      accounts: ["Expenses:Food:Groceries", "Expenses:Food:Restaurants"],
    });
  });

  it("breaks down income, read as earned", () => {
    const report = breakdown({ postings, today: TODAY, currency: "USD", root: "Income" });
    expect(report.slices.map((s) => [s.label, s.amount])).toEqual([["Salary", 5000]]);
  });
});

describe("largest transactions", () => {
  it("lists this month's largest, each with where most of it went", () => {
    const postings = [
      ...spend("2026-09-30", "Expenses:Fun", "999.00"),
      ...spend("2026-10-02", "Expenses:Food:Groceries", "86.13"),
      ...spend("2026-10-05", "Expenses:Food:Groceries", "109.01", { payee: "Meijer" }),
      ...spend("2026-10-06", "Expenses:Food:Groceries", "-20.00"), // a refund
    ];
    const found = largestTransactions({ postings, today: TODAY, currency: "USD", limit: 2 });
    expect(found.currency).toBe("USD");
    expect(found.transactions.map((t) => [t.payee, t.amount, t.account])).toEqual([
      ["Meijer", 109.01, "Expenses:Food:Groceries"],
      [null, 86.13, "Expenses:Food:Groceries"],
    ]);
  });
});

describe("net worth", () => {
  it("backs month ends out from today's balances, valuing holdings at their prices then", () => {
    const postings: Posting[] = [
      ...earn("2026-09-15", "Income:Salary", "5000.00"),
      ...tx("2026-10-02", "Liabilities:Card", BANK, "300.00"), // paid the card down
      {
        transaction: "buy",
        date: "2026-10-03",
        account: "Assets:Broker:VTI",
        amount: "2",
        currency: "VTI",
      },
      {
        transaction: "buy",
        date: "2026-10-03",
        account: "Assets:Broker:Cash",
        amount: "-200.00",
        currency: "USD",
      },
    ];
    const report = netWorth({
      balances: [
        { account: "Assets", amount: "9500.00", currency: "USD" },
        { account: "Assets", amount: "2", currency: "VTI" },
        { account: "Assets", amount: "3", currency: "VACHR" },
        { account: "Liabilities", amount: "-700.00", currency: "USD" },
      ],
      postings,
      prices: [
        { commodity: "VTI", date: "2026-10-03", number: "100.00", currency: "USD" },
        { commodity: "VTI", date: "2026-10-10", number: "150.00", currency: "USD" },
      ],
      today: TODAY,
      currency: "USD",
      months: 3,
    });
    expect(report.months).toEqual([
      { month: "2026-08", end: "2026-08-31", assets: 5000, liabilities: 1000, net: 4000 },
      { month: "2026-09", end: "2026-09-30", assets: 10000, liabilities: 1000, net: 9000 },
      { month: "2026-10", end: TODAY, assets: 9800, liabilities: 700, net: 9100 },
    ]);
    expect(report.unpriced).toEqual(["VACHR"]);
  });
});

describe("typical periods", () => {
  it("has the median week, month and year, and a simulated high that's at least the median", () => {
    const postings = history(PAST).filter(
      (p) => p.account.startsWith("Expenses:Food") || p.account === BANK
    );
    const report = typicalPeriods({
      postings,
      account: "Expenses:Food",
      today: TODAY,
      currency: "USD",
      since: "2025-10-01",
    });
    expect(report.month).toMatchObject({ median: 260, periods: 12 });
    expect(report.month.high).toBeGreaterThanOrEqual(260);
    expect(report.year).toMatchObject({ median: 3120, high: 3120, periods: 1 }); // the last 12 months
    expect(report.week.periods).toBe(52);
    expect(report.week.median).toBeLessThan(report.month.median);
    expect(report.week.high).toBeGreaterThan(report.week.median);
  });

  it("reads income as earned", () => {
    const report = typicalPeriods({
      postings: history(PAST),
      account: "Income",
      today: TODAY,
      currency: "USD",
    });
    expect(report.month.median).toBe(5000);
  });
});

describe("helpers", () => {
  it("interpolates percentiles, and builds the stream from transactions", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(
      fromTransactions([
        {
          id: "x",
          date: "2026-10-01",
          postings: [
            { account: "Expenses:Fun", amount: { number: "5.00", currency: "USD" } },
            { account: BANK, amount: null },
          ],
        },
      ])
    ).toEqual([
      {
        transaction: "x",
        date: "2026-10-01",
        flag: undefined,
        budgeted: undefined,
        payee: null,
        narration: null,
        account: "Expenses:Fun",
        amount: "5.00",
        currency: "USD",
      },
    ]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import type { BudgetStatus } from "./ledger.js";
import {
  breakdownReport,
  cashFlowReport,
  largestReport,
  netWorthReport,
  spendingReport,
  topExpenseBudgets,
  typicalReport,
} from "./reports.js";
import { FakeLedger } from "./testing.js";

const BANK = "Assets:Bank";
let ledger: FakeLedger;
const usd = (number: string) => ({ number, currency: "USD" });
/** A purchase from the bank, its expense split tagged. */
const spend = (date: string, account: string, amount: string, meta = {}, tags: string[] = []) =>
  ledger.addTransaction({
    date,
    flag: "*",
    payee: null,
    narration: account,
    links: [],
    meta,
    postings: [
      { account: BANK, units: usd(`-${amount}`) },
      { account, units: usd(amount), tags },
    ],
  });

beforeEach(() => {
  ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(BANK);
  ledger.addAccount("Expenses", { type: "expense", kind: "node" });
  ledger.addAccount("Expenses:Food", { type: "expense" });
  ledger.addAccount("Expenses:Home", { type: "expense" });
});

const status = (lines: [string, string][], budget: string | null): BudgetStatus =>
  ({
    on: "2026-10-15",
    basis: "month",
    lines: lines.map(([account, type]) => ({ account, type })),
    summary: budget ? { month_start: "2026-10-01", budget: usd(budget), spent: usd("0") } : null,
  }) as BudgetStatus;

describe("reports", () => {
  it("count only what has every tag asked for, the largest and All time from the start", async () => {
    spend("2025-04-03", "Expenses:Home", "600.00", {}, ["italy-2025", "reimbursable"]);
    spend("2025-04-09", "Expenses:Food", "90.00", {}, ["italy-2025"]);
    spend("2026-10-03", "Expenses:Food", "40.00");

    const all = await breakdownReport(ledger, "b", "2026-10-15", {
      side: "expenses",
      from: "start",
      total: true,
      tags: ["italy-2025"],
    });
    expect(all.slices.map((s) => [s.label, s.amount])).toEqual([
      ["Home", 600],
      ["Food", 90],
    ]);
    const both = await breakdownReport(ledger, "b", "2026-10-15", {
      side: "expenses",
      from: "start",
      total: true,
      tags: ["italy-2025", "reimbursable"],
    });
    expect(both.total).toBe(600);

    const largest = await largestReport(ledger, "b", "2026-10-15", 8, ["italy-2025"]);
    expect(largest.transactions.map((t) => t.amount)).toEqual([600, 90]);
    const thisMonth = await largestReport(ledger, "b", "2026-10-15");
    expect(thisMonth.transactions.map((t) => t.amount)).toEqual([40]);

    const flow = await cashFlowReport(ledger, "b", "2026-10-15", 6, ["italy-2025"]);
    expect(flow.totals.expenses).toBe(0); // the trip was more than 6 months ago
  });

  it("count only the splits with the tags, not the rest of their transactions", async () => {
    // A receipt: groceries, and a gift beside them.
    ledger.addTransaction({
      date: "2026-10-03",
      flag: "*",
      payee: "Megamart",
      narration: "",
      links: [],
      meta: {},
      postings: [
        { account: BANK, units: usd("-75.00") },
        { account: "Expenses:Food", units: usd("50.00") },
        { account: "Expenses:Home", units: usd("25.00"), tags: ["gift"] },
      ],
    });

    const breakdown = await breakdownReport(ledger, "b", "2026-10-15", {
      side: "expenses",
      from: "start",
      total: true,
      tags: ["gift"],
    });
    expect(breakdown.slices.map((s) => [s.label, s.amount])).toEqual([["Home", 25]]);
    const largest = await largestReport(ledger, "b", "2026-10-15", 8, ["gift"]);
    expect(largest.transactions.map((t) => t.amount)).toEqual([25]);
    const flow = await cashFlowReport(ledger, "b", "2026-10-15", 6, ["gift"]);
    expect(flow.totals.expenses).toBe(25);
  });

  it("average the breakdown over the months asked for, with each month's amounts", async () => {
    spend("2026-04-10", "Expenses:Food", "300.00");
    spend("2026-07-10", "Expenses:Food", "90.00");
    spend("2026-09-10", "Expenses:Home", "60.00");
    spend("2026-10-03", "Expenses:Food", "40.00"); // this month

    const three = await breakdownReport(ledger, "b", "2026-10-15", {
      side: "expenses",
      from: "2026-07",
      through: "2026-09",
    });
    expect([three.from, three.through, three.months]).toEqual(["2026-07", "2026-09", 3]);
    expect(three.slices.map((s) => [s.label, s.amount])).toEqual([
      ["Food", 30],
      ["Home", 20],
    ]);
    expect(three.byMonth).toEqual([
      { month: "2026-07", partial: false, amounts: [90, 0], other: 0, total: 90 },
      { month: "2026-08", partial: false, amounts: [0, 0], other: 0, total: 0 },
      { month: "2026-09", partial: false, amounts: [0, 60], other: 0, total: 60 },
    ]);
    // Through a year ahead: it stops at today, this month counting as the half of it gone.
    const ahead = await breakdownReport(ledger, "b", "2026-10-15", {
      side: "expenses",
      from: "2026-09",
      through: "2027-09",
    });
    expect([ahead.through, ahead.months]).toEqual(["2026-10", 1 + 15 / 31]);
    expect(ahead.total).toBeCloseTo(100 / (1 + 15 / 31));
    expect(ahead.byMonth.map((m) => [m.month, m.total])).toEqual([
      ["2026-09", 60],
      ["2026-10", 40],
    ]);
    // One month: what it came to.
    const october = await breakdownReport(ledger, "b", "2026-10-15", {
      side: "expenses",
      from: "2026-10",
      through: "2026-10",
    });
    expect([october.months, october.total]).toEqual([1, 40]);
    await expect(
      breakdownReport(ledger, "b", "2026-10-15", {
        side: "expenses",
        from: "2026-10",
        through: "2026-09",
      })
    ).rejects.toThrow(/after through/);
  });

  it("count what's kept out of budgets unless asked to leave it out", async () => {
    spend("2026-10-02", "Expenses:Home", "9000.00", { budget: false }); // a new roof
    spend("2026-10-03", "Expenses:Food", "40.00");

    const all = await breakdownReport(ledger, "b", "2026-10-15", {
      side: "expenses",
      from: "2026-10",
    });
    expect(all.total).toBe(9040);
    const budgeted = await breakdownReport(ledger, "b", "2026-10-15", {
      side: "expenses",
      from: "2026-10",
      budgeted: true,
    });
    expect(budgeted.slices.map((s) => [s.label, s.amount])).toEqual([["Food", 40]]);
    const largest = await largestReport(ledger, "b", "2026-10-15", 8, [], "outflows", true);
    expect(largest.transactions.map((t) => t.amount)).toEqual([40]);
    const flow = await cashFlowReport(ledger, "b", "2026-10-15", 6, [], "outflows", true);
    expect(flow.totals.expenses).toBe(40);
  });

  it("read spending as outflows unless asked for the expenses as booked; net worth as it is", async () => {
    ledger.lenses = [];
    await cashFlowReport(ledger, "b", "2026-10-15");
    await cashFlowReport(ledger, "b", "2026-10-15", 6, [], "expenses");
    await spendingReport(ledger, "b", "2026-10-15");
    await netWorthReport(ledger, "b", "2026-10-15");
    expect(ledger.lenses).toEqual(["outflows", undefined, "outflows", undefined]);
  });

  it("measure spending under the highest-level expense budgets, against them", async () => {
    spend("2026-09-03", "Expenses:Food", "100.00");
    spend("2026-10-03", "Expenses:Food", "40.00");
    spend("2026-10-04", "Expenses:Home", "500.00");
    spend("2026-10-05", "Expenses:Food", "900.00", { budget: false });
    ledger.budgets = status(
      [
        ["Expenses:Food", "expense"],
        ["Expenses:Food:Coffee", "expense"],
        ["Income", "income"],
      ],
      "400.00"
    );
    expect(topExpenseBudgets(ledger.budgets)).toEqual(["Expenses:Food"]);

    const report = await spendingReport(ledger, "b", "2026-10-15");

    expect(report).toMatchObject({ spent: 40, budget: 400, month: "2026-10" });
    expect(report.projection).toHaveLength(31);

    ledger.budgets = null; // no budgets: everything spent, and no line
    expect(await spendingReport(ledger, "b", "2026-10-15")).toMatchObject({
      spent: 540,
      budget: null,
    });
  });

  it("break down the last six months, and refuse drilling outside the side asked for", async () => {
    spend("2026-04-30", "Expenses:Food", "500.00"); // before them
    spend("2026-09-03", "Expenses:Food", "120.00");
    const report = await breakdownReport(ledger, "b", "2026-10-15", { side: "expenses" });
    expect([report.from, report.through]).toEqual(["2026-05", "2026-10"]);
    // 120 over May to September and half of October.
    expect(report.total).toBeCloseTo(120 / (5 + 15 / 31));
    await expect(
      breakdownReport(ledger, "b", "2026-10-15", { side: "income", of: "Expenses:Food" })
    ).rejects.toThrow(/isn't under Income/);
  });

  it("value net worth from today's balances", async () => {
    spend("2026-10-03", "Expenses:Food", "40.00");
    const report = await netWorthReport(ledger, "b", "2026-10-15", 2);
    expect(report.months.map((m) => m.net)).toEqual([40, 0]);
  });

  it("give typical periods for expense and income accounts only", async () => {
    spend("2026-09-03", "Expenses:Food", "100.00");
    expect((await typicalReport(ledger, "b", "2026-10-15", "Expenses:Food")).month.median).toBe(0);
    await expect(typicalReport(ledger, "b", "2026-10-15", BANK)).rejects.toThrow(
      /expense and income/
    );
  });
});

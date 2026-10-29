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
const spend = (date: string, account: string, amount: string, meta = {}, tags: string[] = []) =>
  ledger.addTransaction({
    date,
    flag: "*",
    payee: null,
    narration: account,
    tags,
    links: [],
    meta,
    postings: [
      { account: BANK, units: usd(`-${amount}`) },
      { account, units: usd(amount) },
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
  it("count only the transactions with every tag asked for, the largest and All time from the start", async () => {
    spend("2025-04-03", "Expenses:Home", "600.00", {}, ["italy-2025", "reimbursable"]);
    spend("2025-04-09", "Expenses:Food", "90.00", {}, ["italy-2025"]);
    spend("2026-10-03", "Expenses:Food", "40.00");

    const all = await breakdownReport(ledger, "b", "2026-10-15", {
      side: "expenses",
      window: "total",
      tags: ["italy-2025"],
    });
    expect(all.slices.map((s) => [s.label, s.amount])).toEqual([
      ["Home", 600],
      ["Food", 90],
    ]);
    const both = await breakdownReport(ledger, "b", "2026-10-15", {
      side: "expenses",
      window: "total",
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

  it("break down, and refuse drilling outside the side asked for", async () => {
    spend("2026-09-03", "Expenses:Food", "120.00");
    const report = await breakdownReport(ledger, "b", "2026-10-15", { side: "expenses" });
    expect(report.slices.map((s) => [s.label, s.amount])).toEqual([["Food", 20]]); // 120 over 6
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

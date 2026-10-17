import { beforeEach, describe, expect, it } from "vitest";

import type { BudgetStatus } from "./ledger.js";
import {
  breakdownReport,
  netWorthReport,
  spendingReport,
  topExpenseBudgets,
  typicalReport,
} from "./reports.js";
import { FakeLedger } from "./testing.js";

const BANK = "Assets:Bank";
let ledger: FakeLedger;
const usd = (number: string) => ({ number, currency: "USD" });
const spend = (date: string, account: string, amount: string, meta = {}) =>
  ledger.addTransaction({
    date,
    flag: "*",
    payee: null,
    narration: account,
    tags: [],
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

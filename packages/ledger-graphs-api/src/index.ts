/**
 * Reports from any double-entry ledger: give each the posting stream (see `Posting`; or
 * `fromTransactions`) and it returns a plain JSON dataset, ready to draw.
 *
 * - `spendingThisMonth`: this month's spending by day, against a budget and a simulated month
 * - `cashFlow`: income and expenses, month by month
 * - `breakdown`: the largest categories at a depth, as monthly averages, the rest as Other
 * - `largestTransactions`
 * - `netWorth`: assets, liabilities and net worth by month end, holdings at their prices then
 * - `typicalPeriods`: what an account's week, month and year come to: median, and a simulated
 *   high
 */
export { atDepth, flowSign, lastPart, under } from "./accounts.js";
export { fromTransactions, type TransactionLike } from "./adapters.js";
export { breakdown, type Breakdown, type Slice } from "./breakdown.js";
export { cashFlow, type CashFlow, type CashFlowMonth } from "./cashflow.js";
export { largestTransactions, type LargeTransaction, type LargestTransactions } from "./largest.js";
export { netWorth, type NetWorth, type NetWorthMonth } from "./networth.js";
export { spendingThisMonth, type SpendingOptions, type SpendingThisMonth } from "./spending.js";
export { median, percentile, random } from "./stats.js";
export { typicalPeriods, type Typical, type TypicalPeriods } from "./typical.js";
export { DEFAULT_ROOTS, type Balance, type Posting, type Price, type Roots } from "./types.js";

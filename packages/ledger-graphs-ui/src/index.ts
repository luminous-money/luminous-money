/**
 * Charts for `@luminous-money/ledger-graphs-api`'s datasets, drawn with Apache ECharts (a peer
 * dependency; only the parts used are bundled). Each takes its dataset, a theme, and a money
 * format, and describes itself for screen readers.
 */
export { BreakdownChart, sliceColors } from "./BreakdownChart.js";
export { CashFlowChart } from "./CashFlowChart.js";
export { Chart, fade, type ChartClick, type ChartOption } from "./Chart.js";
export { monthLabel, moneyFormat, type MoneyFormat } from "./format.js";
export { NetWorthChart } from "./NetWorthChart.js";
export { SpendingChart } from "./SpendingChart.js";
export { alpha, LIGHT, type ChartTheme } from "./theme.js";

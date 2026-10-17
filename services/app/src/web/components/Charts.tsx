/**
 * The report charts, loaded only when one is shown (ECharts is most of their weight), with a
 * placeholder of the chart's height meanwhile, so nothing jumps.
 */
import type * as Ui from "@luminous-money/ledger-graphs-ui";
import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";

const charts = () => import("@luminous-money/ledger-graphs-ui");
const Spending = lazy(async () => ({ default: (await charts()).SpendingChart }));
const CashFlow = lazy(async () => ({ default: (await charts()).CashFlowChart }));
const Breakdown = lazy(async () => ({ default: (await charts()).BreakdownChart }));
const NetWorth = lazy(async () => ({ default: (await charts()).NetWorthChart }));

const loading = (height: number | undefined, chart: ReactNode) => (
  <Suspense fallback={<div className="chart-placeholder" style={{ height: height ?? 220 }} />}>
    {chart}
  </Suspense>
);

export const SpendingChart = (props: ComponentProps<typeof Ui.SpendingChart>) =>
  loading(props.height, <Spending {...props} />);
export const CashFlowChart = (props: ComponentProps<typeof Ui.CashFlowChart>) =>
  loading(props.height, <CashFlow {...props} />);
export const BreakdownChart = (props: ComponentProps<typeof Ui.BreakdownChart>) =>
  loading(props.height, <Breakdown {...props} />);
export const NetWorthChart = (props: ComponentProps<typeof Ui.NetWorthChart>) =>
  loading(props.height, <NetWorth {...props} />);

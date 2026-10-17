import type { CashFlow } from "@luminous-money/ledger-graphs-api";
import { useMemo } from "react";

import { Chart } from "./Chart.js";
import { monthLabel, moneyFormat, type MoneyFormat } from "./format.js";
import { alpha, LIGHT, type ChartTheme } from "./theme.js";

/** Month by month: income up, expenses down, net as a point (the dashed line joins them). The
 * current month, still going, is lighter. */
export function CashFlowChart({
  data,
  theme = LIGHT,
  format: given,
  height = 230,
}: {
  data: CashFlow;
  theme?: ChartTheme;
  /** How money reads (whole units by default, in the data's currency). */
  format?: MoneyFormat;
  height?: number;
}) {
  const format = useMemo(() => given ?? moneyFormat(data.currency), [given, data.currency]);
  const option = useMemo(() => {
    const bar = (value: number, partial: boolean, color: string) => ({
      value,
      itemStyle: { color: partial ? alpha(color, 0.5) : color },
    });
    return {
      animationDuration: 600,
      aria: { enabled: true },
      textStyle: { fontFamily: theme.font, color: theme.text },
      grid: { left: 4, right: 48, top: 12, bottom: 24 },
      xAxis: {
        type: "category",
        data: data.months.map((m) => monthLabel(m.month)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.muted },
      },
      yAxis: {
        type: "value",
        position: "right",
        splitNumber: 4,
        axisLabel: { color: theme.muted, formatter: (n: number) => format(n, "compact") },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: { type: "shadow" },
        formatter: (items: { dataIndex: number }[]) => {
          const m = data.months[items[0]?.dataIndex ?? 0]!;
          return [
            `<b>${monthLabel(m.month, true)}${m.partial ? " (so far)" : ""}</b>`,
            `Income ${format(m.income, "cents")}`,
            `Expenses ${format(m.expenses, "cents")}`,
            `Net ${format(m.net, "cents")}`,
          ].join("<br/>");
        },
      },
      series: [
        {
          name: "Income",
          type: "bar",
          stack: "flow",
          barWidth: "46%",
          itemStyle: { borderRadius: [5, 5, 0, 0] },
          data: data.months.map((m) => bar(m.income, m.partial, theme.accent)),
        },
        {
          name: "Expenses",
          type: "bar",
          stack: "flow",
          itemStyle: { borderRadius: [0, 0, 5, 5] },
          data: data.months.map((m) => bar(-m.expenses, m.partial, theme.accentSoft)),
        },
        {
          name: "Net",
          type: "line",
          data: data.months.map((m) => m.net),
          symbol: "circle",
          symbolSize: 9,
          itemStyle: { color: theme.background, borderColor: theme.text, borderWidth: 2 },
          lineStyle: { type: "dashed", color: theme.muted, width: 1.5 },
          z: 3,
        },
      ],
    };
  }, [data, theme, format]);
  const label = `Cash flow over ${data.months.length} months: income ${format(data.totals.income)}, expenses ${format(data.totals.expenses)}, net ${format(data.totals.net)}`;
  return <Chart option={option} height={height} label={label} />;
}

import type { NetWorth } from "@luminous-money/ledger-graphs-api";
import { useMemo } from "react";

import { Chart, fade } from "./Chart.js";
import { monthLabel, moneyFormat, type MoneyFormat } from "./format.js";
import { alpha, LIGHT, type ChartTheme } from "./theme.js";

/** Net worth by month end (a strong line, a faded fill), with assets (quiet) and what's owed
 * (in the negative color) beside it. */
export function NetWorthChart({
  data,
  theme = LIGHT,
  format: given,
  height = 230,
}: {
  data: NetWorth;
  theme?: ChartTheme;
  /** How money reads (whole units by default, in the data's currency). */
  format?: MoneyFormat;
  height?: number;
}) {
  const format = useMemo(() => given ?? moneyFormat(data.currency), [given, data.currency]);
  const option = useMemo(
    () => ({
      animationDuration: 600,
      aria: { enabled: true },
      textStyle: { fontFamily: theme.font, color: theme.text },
      grid: { left: 4, right: 52, top: 30, bottom: 24 },
      legend: {
        top: 0,
        left: 0,
        icon: "roundRect",
        itemWidth: 12,
        itemHeight: 4,
        textStyle: { color: theme.muted, fontSize: 11 },
      },
      xAxis: {
        type: "category",
        data: data.months.map((m) => monthLabel(m.month, true)),
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.muted, hideOverlap: true },
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
        valueFormatter: (n: number) => format(n),
      },
      series: [
        {
          name: "Net worth",
          type: "line",
          data: data.months.map((m) => m.net),
          symbol: "none",
          lineStyle: { width: 3, color: theme.accent },
          itemStyle: { color: theme.accent },
          areaStyle: { color: fade(alpha(theme.accent, 0.3), alpha(theme.accent, 0.02)) },
          z: 3,
        },
        {
          name: "Assets",
          type: "line",
          data: data.months.map((m) => m.assets),
          symbol: "none",
          lineStyle: { width: 1.5, color: theme.muted },
          itemStyle: { color: theme.muted },
        },
        {
          name: "Owed",
          type: "line",
          data: data.months.map((m) => m.liabilities),
          symbol: "none",
          lineStyle: { width: 1.5, color: theme.negative },
          itemStyle: { color: theme.negative },
        },
      ],
    }),
    [data, theme, format]
  );
  const last = data.months.at(-1);
  const label = last
    ? `Net worth ${format(last.net)} at ${last.end}, from ${format(data.months[0]!.net)} ${data.months.length} months before`
    : "Net worth";
  return <Chart option={option} height={height} label={label} />;
}

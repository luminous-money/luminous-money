import type { SpendingThisMonth } from "@luminous-money/ledger-graphs-api";
import { useMemo } from "react";

import { Chart, fade } from "./Chart.js";
import { moneyFormat, type MoneyFormat } from "./format.js";
import { alpha, LIGHT, type ChartTheme } from "./theme.js";

/**
 * This month's spending: the running total to today (a strong line, a faded fill), the budget
 * (a dashed line, labeled), and what a month usually comes to by each day (dotted).
 */
export function SpendingChart({
  data,
  theme = LIGHT,
  format: given,
  height = 200,
}: {
  data: SpendingThisMonth;
  theme?: ChartTheme;
  /** How money reads (whole units by default, in the data's currency). */
  format?: MoneyFormat;
  height?: number;
}) {
  const format = useMemo(() => given ?? moneyFormat(data.currency), [given, data.currency]);
  const option = useMemo(() => {
    const days = Array.from({ length: data.days }, (_, i) => String(i + 1));
    const top = Math.max(data.budget ?? 0, ...(data.projection ?? [0]), ...data.actual, 1) * 1.12;
    const last = data.actual.length - 1;
    const month = new Date(`${data.month}-01T00:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      timeZone: "UTC",
    });
    return {
      animationDuration: 600,
      aria: { enabled: true },
      textStyle: { fontFamily: theme.font, color: theme.text },
      grid: { left: 4, right: 4, top: 26, bottom: 22 },
      xAxis: {
        type: "category",
        data: days,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: theme.muted,
          interval: (i: number) => i % 7 === 0,
          formatter: (d: string) => d.padStart(2, "0"),
        },
      },
      yAxis: { type: "value", show: false, min: 0, max: top },
      tooltip: {
        trigger: "axis",
        confine: true,
        formatter: (items: { dataIndex: number }[]) => {
          const i = items[0]?.dataIndex ?? 0;
          const lines = [`<b>${month} ${i + 1}</b>`];
          if (i <= last) lines.push(`Spent ${format(data.actual[i]!, "cents")}`);
          if (data.projection) lines.push(`Usually by now ${format(data.projection[i]!)}`);
          return lines.join("<br/>");
        },
      },
      series: [
        ...(data.projection
          ? [
              {
                name: "Usually by now",
                type: "line",
                data: data.projection,
                symbol: "none",
                silent: true,
                lineStyle: {
                  type: [2, 5],
                  width: 2,
                  color: alpha(theme.muted, 0.75),
                  cap: "round",
                },
                z: 1,
              },
            ]
          : []),
        {
          name: "Spent",
          type: "line",
          data: data.actual,
          symbol: "none",
          lineStyle: { width: 3, color: theme.accent },
          areaStyle: { color: fade(alpha(theme.accent, 0.38), alpha(theme.accent, 0.02)) },
          markPoint:
            last >= 0
              ? {
                  symbol: "circle",
                  symbolSize: 11,
                  itemStyle: { color: theme.accent, borderColor: theme.background, borderWidth: 2 },
                  label: { show: false },
                  data: [{ coord: [last, data.actual[last]] }],
                }
              : undefined,
          markLine:
            data.budget !== null
              ? {
                  symbol: "none",
                  silent: true,
                  lineStyle: { type: "dashed", color: theme.muted, width: 1 },
                  label: {
                    formatter: `${format(data.budget)} budget`,
                    position: "insideStartTop",
                    color: theme.muted,
                    fontSize: 11,
                  },
                  data: [{ yAxis: data.budget }],
                }
              : undefined,
          z: 2,
        },
      ],
    };
  }, [data, theme, format]);
  const label =
    `Spent ${format(data.spent)} this month` +
    (data.budget !== null ? ` of a ${format(data.budget)} budget` : "") +
    (data.projected_end !== null
      ? `; a month usually comes to about ${format(data.projected_end)}`
      : "");
  return <Chart option={option} height={height} label={label} />;
}

import type { Breakdown } from "@luminous-money/ledger-graphs-api";
import { useCallback, useMemo } from "react";

import { Chart, type ChartClick } from "./Chart.js";
import { moneyFormat, type MoneyFormat } from "./format.js";
import { LIGHT, type ChartTheme } from "./theme.js";

/** The color of each slice of a breakdown, in order, and Other's: so a list beside the donut
 * can match it. */
export const sliceColors = (data: Breakdown, theme: ChartTheme) => ({
  slices: data.slices.map((_, i) => theme.palette[i % theme.palette.length]!),
  other: theme.muted,
});

/**
 * A breakdown as a donut, the total in the middle. Tapping a slice that has accounts under it
 * calls `onSelect` with it, to drill in.
 */
export function BreakdownChart({
  data,
  caption,
  theme = LIGHT,
  format: given,
  height = 240,
  onSelect,
}: {
  data: Breakdown;
  /** Under the total: "a month, on average". */
  caption: string;
  theme?: ChartTheme;
  /** How money reads (whole units by default, in the data's currency). */
  format?: MoneyFormat;
  height?: number;
  onSelect?: (account: string) => void;
}) {
  const format = useMemo(() => given ?? moneyFormat(data.currency), [given, data.currency]);
  const option = useMemo(() => {
    const colors = sliceColors(data, theme);
    const items = [
      ...data.slices.map((s, i) => ({
        name: s.label,
        value: s.amount,
        account: s.account,
        more: s.more,
        itemStyle: { color: colors.slices[i] },
      })),
      ...(data.other
        ? [{ name: "Other", value: data.other.amount, itemStyle: { color: colors.other } }]
        : []),
    ];
    return {
      animationDuration: 500,
      aria: { enabled: true },
      textStyle: { fontFamily: theme.font },
      title: {
        text: format(data.total),
        subtext: caption,
        left: "center",
        top: "center",
        itemGap: 4,
        textStyle: { color: theme.text, fontSize: 22, fontWeight: 700 },
        subtextStyle: { color: theme.muted, fontSize: 12 },
      },
      tooltip: {
        trigger: "item",
        confine: true,
        formatter: (item: { name: string; value: number; percent: number }) =>
          `${item.name}: ${format(item.value)} (${Math.round(item.percent)}%)`,
      },
      series: [
        {
          type: "pie",
          radius: ["64%", "84%"],
          padAngle: 2,
          minAngle: 3,
          avoidLabelOverlap: false,
          label: { show: false },
          itemStyle: { borderRadius: 6, borderColor: theme.background, borderWidth: 1 },
          emphasis: { scaleSize: 5 },
          data: items,
        },
      ],
    };
  }, [data, theme, format, caption]);
  const click = useCallback(
    (item: ChartClick) => {
      const d = item.data as { account?: string; more?: boolean } | undefined;
      if (d?.account && d.more) onSelect?.(d.account);
    },
    [onSelect]
  );
  const label = `${format(data.total)} ${caption}: ${data.slices
    .map((s) => `${s.label} ${Math.round(s.share * 100)}%`)
    .join(", ")}${data.other ? `, Other ${Math.round(data.other.share * 100)}%` : ""}`;
  return <Chart option={option} height={height} label={label} onClick={click} />;
}

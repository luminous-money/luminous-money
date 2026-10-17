import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

// Only what these charts use is bundled. SVG: crisp on phones, and small data.
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
  SVGRenderer,
]);

export type ChartOption = echarts.EChartsCoreOption;
export type ChartClick = { name?: string; data?: unknown; seriesName?: string; dataIndex: number };

/** One ECharts chart, sized to its box (it follows the box as it resizes). */
export function Chart({
  option,
  height = 220,
  label,
  onClick,
}: {
  option: ChartOption;
  height?: number;
  /** What it shows, for those who can't see it. */
  label: string;
  onClick?: (item: ChartClick) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    const el = box.current!;
    const created = echarts.init(el, null, { renderer: "svg" });
    chart.current = created;
    const resize = new ResizeObserver(() => created.resize());
    resize.observe(el);
    return () => {
      resize.disconnect();
      created.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);
  useEffect(() => {
    const current = chart.current;
    if (!current || !onClick) return;
    const handler = (item: unknown) => onClick(item as ChartClick);
    current.on("click", handler);
    return () => void current.off("click", handler);
  }, [onClick]);
  // ECharts labels its own box (its `aria` description), so ours is the box around it.
  return (
    <div role="img" aria-label={label}>
      <div ref={box} style={{ width: "100%", height }} />
    </div>
  );
}

/** A vertical fade, from the `top` color to the `bottom` one. */
export const fade = (top: string, bottom: string): object =>
  new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: top },
    { offset: 1, color: bottom },
  ]);

/** The charts' theme, from the app's own palette (styles.css), light or dark as the device is. */
// A type only: the charts' package (and ECharts with it) loads when a chart does.
import type { ChartTheme } from "@luminous-money/ledger-graphs-ui";
import { useEffect, useState } from "react";

const DARK = window.matchMedia("(prefers-color-scheme: dark)");

/** Harmonious with the app's greens: its own green first. */
const PALETTE = [
  "#3c9a4a",
  "#2f6fd6",
  "#d9a441",
  "#8e5bc9",
  "#d0603f",
  "#2aa3a3",
  "#c94f8a",
  "#7a8c3b",
];

function read(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    text: v("--ink", "#333333"),
    muted: v("--muted", "#666666"),
    grid: v("--line", "#dcdcdc"),
    background: v("--card", "#ffffff"),
    accent: v("--good", "#3c9a4a"),
    accentSoft: v("--accent-soft", "#c8e4f8"),
    positive: v("--good", "#3c9a4a"),
    negative: v("--bad", "#c2453a"),
    palette: PALETTE,
    font: style.fontFamily,
  };
}

/** The chart theme, following the device into and out of dark mode. */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const changed = () => setTheme(read());
    DARK.addEventListener("change", changed);
    return () => DARK.removeEventListener("change", changed);
  }, []);
  return theme;
}

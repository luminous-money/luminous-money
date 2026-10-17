/** Colors and type for the charts: the host passes its own (light, dark, its brand). */
export type ChartTheme = {
  text: string;
  muted: string;
  /** Grid lines and tracks. */
  grid: string;
  /** Behind the charts: rings and gaps are drawn in it. */
  background: string;
  /** The main series: spending, income, net worth. */
  accent: string;
  /** The second: expenses beside income. */
  accentSoft: string;
  positive: string;
  negative: string;
  /** Breakdown slices, in order; Other is drawn in `muted`. */
  palette: string[];
  font?: string;
};

export const LIGHT: ChartTheme = {
  text: "#1d2a1f",
  muted: "#5d6b5f",
  grid: "#e2dfd3",
  background: "#ffffff",
  accent: "#2f6fd6",
  accentSoft: "#8cb4f0",
  positive: "#3c9a4a",
  negative: "#c2453a",
  palette: ["#2f6fd6", "#3c9a4a", "#d9a441", "#8e5bc9", "#d0603f", "#2aa3a3", "#c94f8a", "#7a8c3b"],
};

/** `color` (#rgb, #rrggbb or rgb()) at `opacity`, as rgba(). */
export function alpha(color: string, opacity: number): string {
  const c = color.trim();
  let rgb: number[] | null = null;
  if (c.startsWith("#")) {
    const hex = c.length === 4 ? [...c.slice(1)].map((x) => x + x).join("") : c.slice(1, 7);
    rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  } else {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m)
      rgb = m[1]!
        .split(/[ ,/]+/)
        .slice(0, 3)
        .map(Number);
  }
  return rgb && rgb.every((n) => Number.isFinite(n)) ? `rgba(${rgb.join(", ")}, ${opacity})` : c;
}

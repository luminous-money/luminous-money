/** Statistics for reports: medians, percentiles, and a seeded random generator, so simulations
 * come out the same for the same data. */

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low);
}

export const median = (values: number[]) => percentile(values, 0.5);

/** Mulberry32: small, fast, and good enough to sample with. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of `items`, at random. */
export const pick = <T>(items: T[], next: () => number): T =>
  items[Math.floor(next() * items.length)]!;

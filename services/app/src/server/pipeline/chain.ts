/**
 * Running a batch through the resolver chain. Each resolver sees the rows no earlier resolver
 * settled (`final`); every resolution is kept, per row, in chain order.
 */
import type { Context, Incoming, Resolution, Resolver } from "./types.js";

export async function runChain(
  resolvers: Resolver[],
  batch: Incoming[],
  context: Context
): Promise<Map<number, Resolution[]>> {
  const results = new Map<number, Resolution[]>(batch.map((row) => [row.line, []]));
  let open = batch;
  for (const resolver of resolvers) {
    if (!open.length) break;
    const resolutions = await resolver.resolve(open, context);
    for (const r of resolutions) results.get(r.line)?.push(r);
    const settled = new Set(resolutions.filter((r) => r.final).map((r) => r.line));
    open = open.filter((row) => !settled.has(row.line));
  }
  return results;
}

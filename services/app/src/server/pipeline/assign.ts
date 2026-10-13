/**
 * Assignment: which existing transaction each row of a batch takes. A transaction can be the
 * same event as only one row, so the best-scoring (row, candidate) pairs are taken first, and
 * each transaction goes to at most one row; ties break by row, then transaction ID. A row whose
 * candidates were all taken by other rows gets none, and keeps them linked, so review can swap.
 *
 * Known miss (accepted for now; see docs/PLAN.md, Polish): this pairs by proximity alone. Two
 * $5 coffees entered on the 5th and 7th, arriving in the CSV on the 7th and 8th, pair 7th-7th
 * and 8th-5th, where order says 7th-5th and 8th-7th.
 */
import type { Candidate } from "./types.js";

export function assign(candidates: Map<number, Candidate[]>): Map<number, string> {
  const pairs = [...candidates].flatMap(([line, found]) => found.map((c) => ({ line, c })));
  pairs.sort(
    (a, b) =>
      b.c.score - a.c.score ||
      a.line - b.line ||
      a.c.transaction_id.localeCompare(b.c.transaction_id)
  );
  const taken = new Set<string>();
  const assigned = new Map<number, string>();
  for (const { line, c } of pairs) {
    if (assigned.has(line) || taken.has(c.transaction_id)) continue;
    assigned.set(line, c.transaction_id);
    taken.add(c.transaction_id);
  }
  return assigned;
}

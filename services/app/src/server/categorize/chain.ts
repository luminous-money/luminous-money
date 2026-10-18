/**
 * The categorization chain. Categorizers run in order (built-ins first, then external providers
 * as configured). Each is asked about the transactions not yet **settled**: a proposal with
 * postings at `SETTLE` confidence or more settles one. Every proposal is kept; at the end, the
 * most confident postings and the most confident payee are chosen per transaction (the earlier
 * categorizer wins a tie). Whatever the confidence, a proposal is applied: weak ones get
 * corrected in review.
 *
 * Proposals are checked before they count: postings must name open leaf accounts, and a split's
 * amounts must balance the transaction. A categorizer that fails or times out is skipped for
 * the batch; the others carry on.
 */
import type { CategorizeRequest, Proposal } from "../../shared/categorizer-api.js";
import { add, isZero } from "../../shared/decimal.js";
import type { Categorizer, Chosen, Decision, InternalProposal } from "./types.js";

export const SETTLE = 0.9;

/** Why a proposal can't be used for `request`, or null if it can. */
export function invalid(p: Proposal, request: CategorizeRequest): string | null {
  const t = request.transactions.find((x) => x.id === p.id);
  if (!t) return "unknown transaction";
  if (typeof p.confidence !== "number" || !(p.confidence >= 0 && p.confidence <= 1))
    return "confidence must be 0 to 1";
  if (!p.postings) return null;
  if (!p.postings.length) return "no postings";
  const leaves = new Set(
    request.context.accounts
      .filter((a) => a.kind === "leaf" && !a.close && a.name !== t.account)
      .map((a) => a.name)
  );
  const bad = p.postings.find((x) => !leaves.has(x.account));
  if (bad) return `${bad.account} isn't an open leaf account`;
  if (p.postings.length > 1) {
    if (p.postings.some((x) => !x.amount || x.amount.currency !== t.amount.currency))
      return "a split needs amounts in the transaction's currency";
    const total = p.postings.reduce((sum, x) => add(sum, x.amount!.number), "0");
    if (!isZero(add(total, t.amount.number))) return "the split doesn't balance";
  }
  return null;
}

export async function categorize(
  categorizers: Categorizer[],
  request: CategorizeRequest,
  log: (message: string) => void = console.warn
): Promise<Map<string, Decision>> {
  const all: Chosen[] = [];
  const settled = new Set<string>();
  for (const c of categorizers) {
    const pending = request.transactions.filter((t) => !settled.has(t.id));
    if (!pending.length) break;
    let proposals: InternalProposal[];
    try {
      ({ proposals } = await c.categorize({ ...request, transactions: pending }));
    } catch (error) {
      log(`categorizer ${c.name} failed: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    for (const p of proposals ?? []) {
      const problem = invalid(p, { ...request, transactions: pending });
      if (problem) {
        log(`categorizer ${c.name}: dropped a proposal (${problem})`);
        continue;
      }
      all.push({ ...p, categorizer: c.name });
      if (p.postings && p.confidence >= SETTLE) settled.add(p.id);
    }
  }
  const best = (field: "postings" | "payee", id: string) =>
    all
      .filter((p) => p.id === id && p[field])
      .reduce<Chosen | undefined>((a, b) => (!a || b.confidence > a.confidence ? b : a), undefined);
  return new Map(
    request.transactions.map((t) => [
      t.id,
      { category: best("postings", t.id), payee: best("payee", t.id) },
    ])
  );
}

/** The postings to stage for a transaction: its own, then the chosen category's (or
 * `fallback`, uncategorized, with the amount left for Beancount to balance). */
export function stagedPostings(
  account: string,
  amount: { number: string; currency: string },
  category: (Proposal & { part?: string }) | undefined,
  fallback: string
) {
  const other = category?.postings ?? [{ account: fallback }];
  return [
    // A rule may land it in another part of the divided account it came into (M15).
    { account: category?.part ?? account, units: amount },
    ...other.map((p) => ({
      account: p.account,
      units: other.length > 1 && p.amount ? p.amount : null,
    })),
  ];
}

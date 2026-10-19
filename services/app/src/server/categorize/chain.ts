/**
 * The categorization chain. Categorizers run in order (built-ins first, then external providers
 * as configured). Each is asked about the transactions, and the splits, not yet **settled**:
 *
 * - **A split** is settled by a proposal for it at `SETTLE` confidence or more.
 * - **A proposal's postings** are the other side of a transaction with one split to place (a
 *   bank row), and settle it the same way; with several splits they're a **fallback**, one
 *   account for whatever isn't placed otherwise, and settle nothing (so a payee's rule doesn't
 *   stop a receipt being itemized; it catches what's missed).
 *
 * Every proposal is kept; at the end each split takes its most confident proposal, else the
 * most confident fallback, and the payee its most confident one (the earlier categorizer wins a
 * tie). Whatever the confidence, a proposal is applied: weak ones get corrected in review.
 *
 * Proposals are checked before they count: accounts must be open leaves (or ones the proposal
 * would open, well named), a split proposal's indexes the transaction's open splits, and a
 * split's amounts must balance the transaction. A categorizer that fails or times out is
 * skipped for the batch; the others carry on.
 */
import { isUncategorized } from "../../shared/accounts.js";
import { add, isZero, negate } from "../../shared/decimal.js";
import type {
  Categorizer,
  Chosen,
  Decision,
  Incoming,
  InternalProposal,
  Request,
} from "./types.js";

export const SETTLE = 0.9;

/** A new account's name: under Expenses or Income, each part capitalized. */
const NEW_NAME = /^(Expenses|Income)(:[\p{Lu}\p{Nd}][\p{L}\p{Nd}-]*)+$/u;

/** Why a proposal can't be used for `request`, or null if it can. */
export function invalid(p: InternalProposal, request: Request): string | null {
  const t = request.transactions.find((x) => x.id === p.id);
  if (!t) return "unknown transaction";
  if (typeof p.confidence !== "number" || !(p.confidence >= 0 && p.confidence <= 1))
    return "confidence must be 0 to 1";
  const leaves = new Set(
    request.context.accounts
      .filter((a) => a.kind === "leaf" && !a.close && a.name !== t.account)
      .map((a) => a.name)
  );
  const names = new Set(request.context.accounts.map((a) => a.name));
  for (const name of p.opens ?? []) {
    if (!NEW_NAME.test(name) || names.has(name)) return `${name} can't be opened`;
    const parents = name.split(":").map((_, i, all) => all.slice(0, i).join(":"));
    if (parents.some((above) => leaves.has(above))) return `${name} would be under a leaf`;
  }
  const usable = (account: string) => leaves.has(account) || !!p.opens?.includes(account);
  if (p.splits) {
    const open = new Set(t.splits.map((s) => s.index));
    const seen = new Set<number>();
    for (const s of p.splits) {
      if (!open.has(s.index) || seen.has(s.index)) return `split ${s.index} isn't one to place`;
      if (!usable(s.account)) return `${s.account} isn't an open leaf account`;
      seen.add(s.index);
    }
  }
  if (!p.postings) return null;
  if (!p.postings.length) return "no postings";
  const bad = p.postings.find((x) => !usable(x.account));
  if (bad) return `${bad.account} isn't an open leaf account`;
  if (p.postings.length > 1) {
    if (t.splits.length > 1) return "a fallback is one account";
    if (p.postings.some((x) => !x.amount || x.amount.currency !== t.amount.currency))
      return "a split needs amounts in the transaction's currency";
    const total = p.postings.reduce((sum, x) => add(sum, x.amount!.number), "0");
    if (!isZero(add(total, t.amount.number))) return "the split doesn't balance";
  }
  return null;
}

/** Whether a transaction's postings proposal settles it: only with one split to place. */
const settles = (t: Incoming, p: InternalProposal) =>
  !!p.postings && p.confidence >= SETTLE && t.splits.length <= 1;

export async function categorize(
  categorizers: Categorizer[],
  request: Request,
  log: (message: string) => void = console.warn
): Promise<Map<string, Decision>> {
  const all: Chosen[] = [];
  /** Each transaction's settled splits; one with none left to place isn't asked again. */
  const settled = new Map<string, Set<number>>(request.transactions.map((t) => [t.id, new Set()]));
  const pending = () =>
    request.transactions.flatMap((t) => {
      const splits = t.splits.filter((s) => !settled.get(t.id)!.has(s.index));
      return splits.length ? [{ ...t, splits }] : [];
    });
  for (const c of categorizers) {
    const asked = pending();
    if (!asked.length) break;
    let proposals: InternalProposal[];
    try {
      ({ proposals } = await c.categorize({ ...request, transactions: asked }));
    } catch (error) {
      log(`categorizer ${c.name} failed: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    for (const p of proposals ?? []) {
      const problem = invalid(p, { ...request, transactions: asked });
      if (problem) {
        log(`categorizer ${c.name}: dropped a proposal (${problem})`);
        continue;
      }
      all.push({ ...p, categorizer: c.name });
      const t = asked.find((x) => x.id === p.id)!;
      const done = settled.get(p.id)!;
      if (settles(t, p)) for (const s of t.splits) done.add(s.index);
      if (p.confidence >= SETTLE) for (const s of p.splits ?? []) done.add(s.index);
    }
  }
  const most = (proposals: Chosen[]) =>
    proposals.reduce<Chosen | undefined>(
      (a, b) => (!a || b.confidence > a.confidence ? b : a),
      undefined
    );
  return new Map(
    request.transactions.map((t) => {
      const mine = all.filter((p) => p.id === t.id);
      const splits = new Map<number, Chosen>();
      for (const s of t.splits) {
        const best = most(mine.filter((p) => p.splits?.some((x) => x.index === s.index)));
        if (best) splits.set(s.index, best);
      }
      return [
        t.id,
        {
          category: most(mine.filter((p) => p.postings)),
          ...(splits.size ? { splits } : {}),
          payee: most(mine.filter((p) => p.payee)),
        },
      ];
    })
  );
}

/** A posting as it's staged or rewritten. */
type PostingIn = {
  account: string;
  units?: { number: string; currency: string } | null;
  flag?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * `postings` with a decision applied to the transaction's open splits, each flagged `!` (a split
 * still to confirm). A split takes the account proposed for it, else the fallback (the
 * category), else stays where it is. With one split the category is its other side, and
 * replaces it (several postings: a provider's split of a bank row); with several, the fallback
 * only fills splits that are still uncategorized, never one placed by name. A rule may land the
 * transaction's own side (its first posting) in a part of the divided account it came into
 * (M15).
 */
export function placed<P extends PostingIn>(postings: P[], t: Incoming, d: Decision): PostingIn[] {
  const open = new Set(t.splits.map((s) => s.index));
  const other = d.category?.postings;
  return postings.flatMap((p, i): PostingIn[] => {
    if (i === 0 && d.category?.part) return [{ ...p, account: d.category.part }];
    if (!open.has(i)) return [p];
    const own = d.splits?.get(i)?.splits?.find((s) => s.index === i)?.account;
    if (own) return [{ ...p, account: own, flag: "!" }];
    if (other && other.length > 1 && t.splits.length === 1)
      return other.map((x) => ({ account: x.account, units: x.amount ?? null, flag: "!" }));
    const fills = t.splits.length === 1 || isUncategorized(p.account);
    return [{ ...p, account: (fills && other?.[0]?.account) || p.account, flag: "!" }];
  });
}

/** The postings to stage for a bank row: its own side, then the other side to categorize. */
export function stagedPostings(
  account: string,
  amount: { number: string; currency: string },
  decision: Decision,
  fallback: string
): PostingIn[] {
  const row: Incoming = {
    id: "",
    date: "",
    account,
    amount,
    description: "",
    payee: null,
    splits: [{ index: 1, amount: { ...amount, number: negate(amount.number) }, memo: null }],
  };
  return placed(
    [
      { account, units: amount },
      { account: fallback, units: null },
    ],
    row,
    decision
  );
}

/** One proposal standing for a decision, to record and show in review: the category, or with
 * splits placed, the first split's maker, its postings the accounts the open splits took. */
export function representative(
  d: Decision,
  postings: PostingIn[],
  t: Incoming
): Chosen | undefined {
  const first = d.splits?.values().next().value as Chosen | undefined;
  if (!first || t.splits.length <= 1) return d.category ?? first;
  const accounts = t.splits.map((s) => ({ account: postings[s.index]?.account ?? "" }));
  return { ...first, postings: accounts };
}

/**
 * Funds (Funds A): what a transaction does to funds, worked out the way the ledger does
 * (`services/ledger/src/ledger/fundlines.py`), so the PWA can say it before saving and the server
 * can write lines the ledger will take.
 *
 * - A line is a fund and a signed amount: `+` into the fund, `-` out of it. Unallocated is never
 *   a line: it's what isn't in a fund.
 * - A transaction's **kind** comes from its change in net worth (its asset and liability splits):
 *   money in goes *to* funds, money out comes *from* them, a transfer (between your own accounts,
 *   paying a card, a trade) puts money *toward* them (and, with More options, takes from them).
 * - Its **size** is what came in or went out, or for a transfer what moved. Lines add up to no
 *   more than that, each way.
 */
import { add, isNegative, isZero, negate } from "./decimal.js";

/** a − b, compared with 0. */
const compare = (a: string, b: string) => {
  const difference = add(a, negate(b));
  return isZero(difference) ? 0 : isNegative(difference) ? -1 : 1;
};

export const UNALLOCATED = "Unallocated";

export type FundLine = { fund: string; amount: { number: string; currency: string } };

/** What funds see of a transaction: its kind (null: not worked out yet, as when the splits don't
 * balance, or in another currency) and its size. */
export type FundShape = {
  kind: "in" | "out" | "transfer" | null;
  size: string;
  currency: string;
};

type PostingLike = {
  account: string;
  units?: { number: string; currency: string } | null;
  cost?: { number?: string | null; total?: string | null; currency?: string | null } | null;
  price?: { number: string; currency: string } | null;
};

const BALANCE_SHEET = /^(Assets|Liabilities):/;

/** What a posting weighs, as booking would: its units, or units times a cost or price. */
function weight(p: PostingLike): { number: string; currency: string } | null {
  if (!p.units) return null;
  if (p.cost) {
    if (!p.cost.currency) return null;
    if (p.cost.total) {
      const total = isNegative(p.units.number) ? negate(p.cost.total) : p.cost.total;
      return { number: total, currency: p.cost.currency };
    }
    if (!p.cost.number) return null;
    return { number: multiply(p.units.number, p.cost.number), currency: p.cost.currency };
  }
  if (p.price)
    return { number: multiply(p.units.number, p.price.number), currency: p.price.currency };
  return p.units;
}

/** a × b, for decimal strings (cents are what matter here). */
function multiply(a: string, b: string): string {
  return (Number(a) * Number(b)).toFixed(2);
}

/**
 * A transaction's shape for funds. `postings` may have one blank amount (it balances the rest,
 * when they're all in one currency), as an editor holds them.
 */
export function shapeOf(postings: PostingLike[], currency: string): FundShape {
  const unknown: FundShape = { kind: null, size: "0", currency };
  const weights = postings.map(weight);
  const blanks = postings.filter((p) => !p.units);
  if (blanks.length > 1) return unknown;
  if (blanks.length === 1) {
    const known = weights.filter((w): w is NonNullable<typeof w> => !!w);
    if (known.some((w) => w.currency !== known[0]?.currency) || !known.length) return unknown;
    const rest = known.reduce((sum, w) => add(sum, w.number), "0");
    weights[postings.indexOf(blanks[0]!)] = { number: negate(rest), currency: known[0]!.currency };
  }
  let delta = "0";
  let moved = "0";
  for (const [i, p] of postings.entries()) {
    if (!BALANCE_SHEET.test(p.account)) continue;
    const w = weights[i];
    if (!w || w.currency !== currency) return unknown;
    delta = add(delta, w.number);
    if (!isNegative(w.number)) moved = add(moved, w.number);
  }
  if (isZero(delta)) return { kind: "transfer", size: moved, currency };
  return isNegative(delta)
    ? { kind: "out", size: negate(delta), currency }
    : { kind: "in", size: delta, currency };
}

/** The line that puts all of a transaction into a fund, or takes all of it from one. */
export function wholeLine(shape: FundShape, fund: string): FundLine | null {
  if (!shape.kind || isZero(shape.size)) return null;
  const number = shape.kind === "out" ? negate(shape.size) : shape.size;
  return { fund, amount: { number, currency: shape.currency } };
}

/** Money as the ledger words it: "1,200.00 USD". */
export const ledgerMoney = (number: string, currency: string) =>
  `${Number(number).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

/** What's wrong with these lines on a transaction of this shape (worded as the ledger words it,
 * unless `money` says otherwise); null if nothing is, or its shape isn't known. */
export function linesProblem(
  shape: FundShape,
  lines: FundLine[],
  money: (number: string, currency: string) => string = ledgerMoney
): string | null {
  if (!shape.kind) return null;
  const into = lines
    .filter((l) => !isNegative(l.amount.number))
    .reduce((s, l) => add(s, l.amount.number), "0");
  const outOf = negate(
    lines.filter((l) => isNegative(l.amount.number)).reduce((s, l) => add(s, l.amount.number), "0")
  );
  const taken = lines.find((l) => isNegative(l.amount.number))?.fund;
  const given = lines.find((l) => !isNegative(l.amount.number) && !isZero(l.amount.number))?.fund;
  const more = (a: string, b: string) => compare(a, b) > 0;
  const size = money(shape.size, shape.currency);
  if (shape.kind === "in") {
    if (taken) return `money coming in goes to funds, not from them (${taken})`;
    if (more(into, shape.size))
      return `its funds get ${money(into, shape.currency)}, more than the ${size} that came in`;
  } else if (shape.kind === "out") {
    if (given) return `money going out comes from funds, not to them (${given})`;
    if (more(outOf, shape.size))
      return `its funds give ${money(outOf, shape.currency)}, more than the ${size} that went out`;
  } else {
    if (more(into, shape.size))
      return `its funds get ${money(into, shape.currency)}, more than the ${size} it moves`;
    if (more(outOf, shape.size))
      return `its funds give ${money(outOf, shape.currency)}, more than the ${size} it moves`;
  }
  return null;
}

/** Lines summed per fund, zeros dropped: two transactions' lines made one (a paired transfer). */
export function mergedLines(...sets: (FundLine[] | null | undefined)[]): FundLine[] {
  const out: FundLine[] = [];
  for (const line of sets.flatMap((s) => s ?? [])) {
    const same = out.find(
      (l) => l.fund === line.fund && l.amount.currency === line.amount.currency
    );
    if (same) same.amount = { ...same.amount, number: add(same.amount.number, line.amount.number) };
    else out.push({ fund: line.fund, amount: { ...line.amount } });
  }
  return out.filter((l) => !isZero(l.amount.number));
}

const NOT_IN_NAMES = /[;"\\/]/;

/** A fund's name as it's kept (trimmed, inner spaces made one), or why it can't be one. */
export function fundName(name: string): { name: string } | { problem: string } {
  const clean = name.split(/\s+/).filter(Boolean).join(" ");
  if (!clean) return { problem: "a fund needs a name" };
  if (clean.length > 60) return { problem: "a fund's name is at most 60 characters" };
  if (NOT_IN_NAMES.test(clean)) return { problem: "a fund's name can't hold ; \" \\ or /" };
  if (clean.toLowerCase() === UNALLOCATED.toLowerCase())
    return { problem: "Unallocated is what isn't in a fund: it can't be a fund's name" };
  return { name: clean };
}

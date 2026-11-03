/**
 * Funds as an editor holds them: rows being edited, and what they come to. The rules (a
 * transaction's kinds and sizes, the cap) are in `shared/funds.ts`, as the ledger has them; this
 * is the PWA's side: rows as typed, the line that follows the transaction's amount, and what a
 * transaction does to each fund, Unallocated included.
 *
 * - A **row** is a fund and an amount as typed (positive) of one commodity, on a side: `into` a
 *   fund or `from` it. Money in is always into, money out always from; only a transfer has both
 *   (More options). Funds read a transaction per commodity (Funds B), so each commodity has its
 *   own rows, and the functions here take one commodity's shape and rows.
 * - The first row on a side **follows**: until an amount is typed in it, it holds what the
 *   transaction has left on that side (all of it, alone). So choosing a fund puts the whole
 *   amount there, and typing $300 into a second one leaves $700 in the first.
 */
import { add, formatMoney, isDecimal, isMoney, isNegative, isZero, negate } from "./decimal.js";
import {
  UNALLOCATED,
  effectsOf,
  type DefaultFund,
  type FundLine,
  type FundShape,
} from "../../shared/funds.js";

export type Side = "into" | "from";

export type FundRow = {
  key: number;
  /** The fund's name; "" is none yet (Unallocated, or "No fund" on a transfer). */
  fund: string;
  /** As typed: a positive number, or "". */
  amount: string;
  /** Holds what's left on its side, until an amount is typed. */
  follows: boolean;
  side: Side;
  /** The commodity it's in. */
  currency: string;
};

let nextKey = 0;

export const blankRow = (side: Side, currency: string, follows = true): FundRow => ({
  key: nextKey++,
  fund: "",
  amount: "",
  follows,
  side,
  currency,
});

/** The side money goes on a transaction of this kind: in is into, out is from, a transfer (and
 * one not worked out yet) where the row says. */
export const sideOf = (shape: FundShape, row: FundRow): Side =>
  shape.kind === "in" ? "into" : shape.kind === "out" ? "from" : row.side;

/** The side a new row starts on. */
export const mainSide = (shape: FundShape): Side => (shape.kind === "out" ? "from" : "into");

/** A commodity's rows. */
export const rowsIn = (rows: FundRow[], currency: string) =>
  rows.filter((r) => r.currency === currency);

/**
 * Rows for saved lines, per commodity. A line that's all of its commodity, alone on its side,
 * follows it (so changing the splits keeps it whole). No lines: one empty row per commodity, which
 * follows once it's given a fund.
 */
export function rowsFrom(
  saved: FundLine[] | null | undefined,
  shapes: FundShape[],
  operating: string
): FundRow[] {
  const lines = saved ?? [];
  const currencies = [
    ...new Set([
      ...(shapes.length ? shapes.map((s) => s.currency) : [operating]),
      ...lines.map((l) => l.amount.currency),
    ]),
  ];
  return currencies.flatMap((currency) => {
    const shape = shapes.find((s) => s.currency === currency) ?? {
      kind: null,
      size: "0",
      currency,
    };
    const mine = lines.filter((l) => l.amount.currency === currency);
    if (!mine.length) return [blankRow(mainSide(shape), currency)];
    const rows = mine.map((l): FundRow => ({
      key: nextKey++,
      fund: l.fund,
      amount: isNegative(l.amount.number) ? negate(l.amount.number) : l.amount.number,
      follows: false,
      side: isNegative(l.amount.number) ? "from" : "into",
      currency,
    }));
    for (const side of ["into", "from"] as const) {
      const theirs = rows.filter((r) => r.side === side);
      if (theirs.length === 1 && shape.kind && same(theirs[0]!.amount, shape.size))
        theirs[0]!.follows = true;
    }
    return rows;
  });
}

const same = (a: string, b: string) => isDecimal(a) && isZero(add(a, negate(b)));

/** An amount as typed, without what people type around one ("$1,000.00"). */
const clean = (amount: string) => amount.replace(/[$,\s]/g, "");

const valid = (amount: string) => isDecimal(amount) && !isNegative(amount);

/** Each row's amount as it stands: a following row holds what's left on its side (never below
 * zero); the rest, what was typed. While the kind isn't known, a following row keeps its last.
 * `rows` are the shape's commodity's. */
export function amountsOf(rows: FundRow[], shape: FundShape): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of rows) out.set(r.key, clean(r.amount));
  if (!shape.kind) return out;
  for (const side of ["into", "from"] as const) {
    const mine = rows.filter((r) => sideOf(shape, r) === side);
    const follower = mine.find((r) => r.follows && r.fund);
    if (!follower) continue;
    const others = mine
      .filter((r) => r !== follower && r.fund && valid(clean(r.amount)))
      .reduce((sum, r) => add(sum, clean(r.amount)), "0");
    const left = add(shape.size, negate(others));
    out.set(follower.key, isNegative(left) ? zero(shape.currency) : written(left, shape.currency));
  }
  return out;
}

const zero = (currency: string) => (isMoney(currency) ? "0.00" : "0");

/** Money with its cents, however it was typed: "500" is "500.00" (and "1.505" stays). */
export const fixed = (number: string) => {
  const [whole = "0", fraction = ""] = number.replace(/^-/, "").split(".");
  return `${isNegative(number) ? "-" : ""}${whole}.${fraction.padEnd(2, "0")}`;
};

/** An amount as it's written: money with its cents, shares as typed. */
export const written = (number: string, currency: string) =>
  isMoney(currency) ? fixed(number) : number;

/** The lines a commodity's rows make (a row with a fund and an amount), signed by side. */
export function linesOf(rows: FundRow[], shape: FundShape): FundLine[] {
  const amounts = amountsOf(rows, shape);
  return rows.flatMap((r) => {
    const amount = amounts.get(r.key) ?? "";
    if (!r.fund || !valid(amount) || isZero(amount)) return [];
    const number = written(sideOf(shape, r) === "from" ? negate(amount) : amount, shape.currency);
    return [{ fund: r.fund, amount: { number, currency: shape.currency } }];
  });
}

/** What's wrong with a commodity's rows themselves (an amount that isn't one, a fund given
 * nothing), before the cap is checked. */
export function rowsProblem(rows: FundRow[], shape: FundShape): string | null {
  const amounts = amountsOf(rows, shape);
  for (const r of rows) {
    const amount = amounts.get(r.key) ?? "";
    if (amount && !valid(amount))
      return isMoney(shape.currency)
        ? "Amounts are numbers, like 500.00"
        : "Amounts are numbers, like 10";
    if (r.fund && (!amount || isZero(amount))) return `Give ${r.fund} an amount, or remove it`;
  }
  return null;
}

/** Two sets of lines are the same (in any order, however their numbers are written). */
export function sameLines(a: FundLine[] | null | undefined, b: FundLine[] | null | undefined) {
  const x = a ?? [];
  const y = b ?? [];
  return (
    x.length === y.length &&
    x.every((l) =>
      y.some(
        (m) =>
          m.fund === l.fund &&
          m.amount.currency === l.amount.currency &&
          same(m.amount.number, l.amount.number)
      )
    )
  );
}

/** An amount with its sign, always: "+$500.00", "−$300.00", "+$0.00", "+10 VTI". */
export function signedMoney(number: string, currency: string): string {
  const shown = formatMoney(number, currency);
  return isNegative(number) ? shown : `+${shown}`;
}

/** What a transaction does to each fund, Unallocated last: per fund, its amounts per commodity.
 * Without lines or defaults, all of its change in net worth is Unallocated's. */
export function effects(
  postings: Parameters<typeof effectsOf>[0],
  lines: FundLine[],
  defaults: DefaultFund[],
  date: string
): { fund: string; amounts: { number: string; currency: string }[] }[] | null {
  const found = effectsOf(postings, lines, defaults, date);
  if (!found) return null;
  const funds = [...new Set(found.map((e) => e.fund))].filter((f) => f !== UNALLOCATED);
  return [...funds, UNALLOCATED].map((fund) => ({
    fund,
    amounts: found
      .filter((e) => e.fund === fund)
      .map((e) => ({ number: e.number, currency: e.currency })),
  }));
}

/** The effects in words: "Emergency −$3,000.00 and +10 VTI · Unallocated +$0.00". A fund with no
 * change says so in the operating currency. */
export const effectsInWords = (found: ReturnType<typeof effects>, operating: string): string =>
  (found ?? [])
    .map(
      (e) =>
        `${e.fund} ${
          e.amounts.length
            ? e.amounts.map((a) => signedMoney(a.number, a.currency)).join(" and ")
            : signedMoney("0", operating)
        }`
    )
    .join(" · ");

/** What a fund holds of each commodity, by fund (Unallocated included), from the funds list. */
export type Holdings = Map<string, Map<string, string>>;

export function holdingsOf(listing: {
  funds: { name: string; holdings: { amount: { number: string; currency: string } }[] }[];
  unallocated_holdings?: { amount: { number: string; currency: string } }[];
}): Holdings {
  const out: Holdings = new Map();
  for (const f of listing.funds)
    out.set(f.name, new Map(f.holdings.map((h) => [h.amount.currency, h.amount.number])));
  out.set(
    UNALLOCATED,
    new Map((listing.unallocated_holdings ?? []).map((h) => [h.amount.currency, h.amount.number]))
  );
  return out;
}

/**
 * Funds this transaction would take below zero: each fund's holding of each commodity it takes
 * from, less what the transaction did as saved, plus what it does now. In shares that's a
 * problem (nothing by hand leaves a fund short of a share); in money, a note.
 */
export function belowZero(
  now: ReturnType<typeof effects>,
  saved: ReturnType<typeof effects>,
  holdings: Holdings
): { fund: string; currency: string; number: string; had: string; takes: string }[] {
  const before = new Map<string, string>();
  for (const e of saved ?? [])
    for (const a of e.amounts) before.set(`${e.fund}\u0000${a.currency}`, a.number);
  return (now ?? []).flatMap((e) =>
    e.amounts.flatMap((a) => {
      if (!isNegative(a.number)) return [];
      const holding = holdings.get(e.fund)?.get(a.currency);
      if (holding === undefined && e.fund !== UNALLOCATED && isMoney(a.currency)) return [];
      const had = add(holding ?? "0", negate(before.get(`${e.fund}\u0000${a.currency}`) ?? "0"));
      const after = add(had, a.number);
      return isNegative(after)
        ? [{ fund: e.fund, currency: a.currency, number: after, had, takes: negate(a.number) }]
        : [];
    })
  );
}

/** The fund a transaction's lines put all of it in (or take all of it from), every commodity: ""
 * for no lines; null for anything else (split, partial, or several funds). */
export function wholeFund(
  lines: FundLine[] | null | undefined,
  shapes: FundShape[] | null
): string | null {
  if (!lines?.length) return "";
  if (!shapes?.length || shapes.some((s) => !s.kind)) return null;
  const funds = new Set(lines.map((l) => l.fund));
  if (funds.size !== 1 || lines.length !== shapes.filter((s) => !isZero(s.size)).length)
    return null;
  const ok = shapes.every((s) => {
    if (isZero(s.size)) return true;
    const line = lines.find((l) => l.amount.currency === s.currency);
    return !!line && same(line.amount.number, s.kind === "out" ? negate(s.size) : s.size);
  });
  return ok ? [...funds][0]! : null;
}

/** The fund that has the whole of one commodity's side of a trade alone: "" for none (no lines
 * in it), null for anything else. */
export function wholeSide(lines: FundLine[] | null | undefined, shape: FundShape): string | null {
  const mine = (lines ?? []).filter((l) => l.amount.currency === shape.currency);
  if (!mine.length) return "";
  if (mine.length !== 1 || !shape.kind) return null;
  return same(mine[0]!.amount.number, shape.kind === "out" ? negate(shape.size) : shape.size)
    ? mine[0]!.fund
    : null;
}

/** The verb a line reads with: "To" a fund (money in), "From" one (money out, or taken on a
 * transfer), "For" one (set aside on a transfer). */
export function verb(shape: FundShape, side: Side): string {
  if (shape.kind === "in") return "To";
  if (shape.kind === "out") return "From";
  return side === "from" ? "From" : "For";
}

/**
 * The only fund that could have made a sale (Funds B): when exactly one active fund holds enough
 * of every share the transaction takes from Unallocated, which doesn't have it. Null otherwise.
 */
export function suggestedFund(
  takes: { fund: string; currency: string; takes: string }[],
  holdings: Holdings,
  active: string[]
): string | null {
  const short = takes.filter((t) => t.fund === UNALLOCATED && !isMoney(t.currency));
  if (!short.length) return null;
  const able = active.filter((f) =>
    short.every((t) => {
      const have = holdings.get(f)?.get(t.currency);
      return have !== undefined && !isNegative(add(have, negate(t.takes)));
    })
  );
  return able.length === 1 ? able[0]! : null;
}

/**
 * Funds (Funds A) as an editor holds them: rows being edited, and what they come to. The rules
 * (a transaction's kind and size, the cap) are in `shared/funds.ts`, as the ledger has them; this
 * is the PWA's side: rows as typed, the line that follows the transaction's amount, and what a
 * transaction does to each fund, Unallocated included.
 *
 * - A **row** is a fund and an amount as typed (positive), on a side: `into` a fund or `from` it.
 *   Money in is always into, money out always from; only a transfer has both (More options).
 * - The first row on a side **follows**: until an amount is typed in it, it holds what the
 *   transaction has left on that side (all of it, alone). So choosing a fund puts the whole
 *   amount there, and typing $300 into a second one leaves $700 in the first.
 */
import { add, formatMoney, isDecimal, isNegative, isZero, negate } from "./decimal.js";
import { UNALLOCATED, type FundLine, type FundShape } from "../../shared/funds.js";

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
};

let nextKey = 0;

export const blankRow = (side: Side, follows = true): FundRow => ({
  key: nextKey++,
  fund: "",
  amount: "",
  follows,
  side,
});

/** The side money goes on a transaction of this kind: in is into, out is from, a transfer (and
 * one not worked out yet) where the row says. */
export const sideOf = (shape: FundShape, row: FundRow): Side =>
  shape.kind === "in" ? "into" : shape.kind === "out" ? "from" : row.side;

/** The side a new row starts on. */
export const mainSide = (shape: FundShape): Side => (shape.kind === "out" ? "from" : "into");

/**
 * Rows for saved lines. A line that's all of the transaction, alone on its side, follows it (so
 * changing the splits keeps it whole). No lines: one empty row, which follows once it's given a
 * fund.
 */
export function rowsFrom(saved: FundLine[] | null | undefined, shape: FundShape): FundRow[] {
  const lines = saved ?? [];
  if (!lines.length) return [blankRow(mainSide(shape))];
  const rows = lines.map((l): FundRow => ({
    key: nextKey++,
    fund: l.fund,
    amount: isNegative(l.amount.number) ? negate(l.amount.number) : l.amount.number,
    follows: false,
    side: isNegative(l.amount.number) ? "from" : "into",
  }));
  for (const side of ["into", "from"] as const) {
    const mine = rows.filter((r) => r.side === side);
    if (mine.length === 1 && shape.kind && same(mine[0]!.amount, shape.size))
      mine[0]!.follows = true;
  }
  return rows;
}

const same = (a: string, b: string) => isDecimal(a) && isZero(add(a, negate(b)));

/** An amount as typed, without what people type around one ("$1,000.00"). */
const clean = (amount: string) => amount.replace(/[$,\s]/g, "");

const valid = (amount: string) => isDecimal(amount) && !isNegative(amount);

/** Each row's amount as it stands: a following row holds what's left on its side (never below
 * zero); the rest, what was typed. While the kind isn't known, a following row keeps its last. */
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
    out.set(follower.key, isNegative(left) ? "0.00" : fixed(left));
  }
  return out;
}

/** Money with its cents, however it was typed: "500" is "500.00" (and "1.505" stays). */
export const fixed = (number: string) => {
  const [whole = "0", fraction = ""] = number.replace(/^-/, "").split(".");
  return `${isNegative(number) ? "-" : ""}${whole}.${fraction.padEnd(2, "0")}`;
};

/** The lines the rows make (a row with a fund and an amount), signed by side. */
export function linesOf(rows: FundRow[], shape: FundShape): FundLine[] {
  const amounts = amountsOf(rows, shape);
  return rows.flatMap((r) => {
    const amount = amounts.get(r.key) ?? "";
    if (!r.fund || !valid(amount) || isZero(amount)) return [];
    const number = fixed(sideOf(shape, r) === "from" ? negate(amount) : amount);
    return [{ fund: r.fund, amount: { number, currency: shape.currency } }];
  });
}

/** What's wrong with the rows themselves (an amount that isn't one, a fund given nothing), before
 * the cap is checked. */
export function rowsProblem(rows: FundRow[], shape: FundShape): string | null {
  const amounts = amountsOf(rows, shape);
  for (const r of rows) {
    const amount = amounts.get(r.key) ?? "";
    if (amount && !valid(amount)) return "Amounts are numbers, like 500.00";
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

/** Money with its sign, always: "+$500.00", "−$300.00", "+$0.00". */
export function signedMoney(number: string, currency: string): string {
  const shown = formatMoney(number, currency);
  return isNegative(number) ? shown : `+${shown}`;
}

/**
 * What a transaction does to each fund, Unallocated last: its lines, then what's left of its
 * change in net worth (money in less what went to funds; a transfer moves Unallocated by what
 * its lines take or give).
 */
export function effects(shape: FundShape, lines: FundLine[]): { fund: string; number: string }[] {
  if (!shape.kind) return [];
  const delta = shape.kind === "in" ? shape.size : shape.kind === "out" ? negate(shape.size) : "0";
  const inFunds = lines.reduce((sum, l) => add(sum, l.amount.number), "0");
  return [
    ...lines.map((l) => ({ fund: l.fund, number: l.amount.number })),
    { fund: UNALLOCATED, number: add(delta, negate(inFunds)) },
  ];
}

/** The effects in words: "Emergency +$500.00 · Unallocated +$0.00". */
export const effectsInWords = (shape: FundShape, lines: FundLine[]) =>
  effects(shape, lines)
    .map((e) => `${e.fund} ${signedMoney(e.number, shape.currency)}`)
    .join(" · ");

/**
 * Funds these lines would take below zero: each one's balance, less what this transaction gave or
 * took when it was saved, plus what it does now.
 */
export function belowZero(
  lines: FundLine[],
  saved: FundLine[] | null | undefined,
  balances: Map<string, string>
): { fund: string; number: string }[] {
  return lines.flatMap((l) => {
    const balance = balances.get(l.fund);
    if (balance === undefined || !isNegative(l.amount.number)) return [];
    const before = (saved ?? []).find((s) => s.fund === l.fund)?.amount.number ?? "0";
    const after = add(add(balance, negate(before)), l.amount.number);
    return isNegative(after) ? [{ fund: l.fund, number: after }] : [];
  });
}

/** The fund a transaction's lines put all of it in (or take all of it from), if that's what
 * they are: one line, the whole amount, the way it goes. "" for no lines; null for anything
 * else (split, partial, or taken from on a transfer). */
export function wholeFund(lines: FundLine[] | null | undefined, shape: FundShape): string | null {
  if (!lines?.length) return "";
  if (lines.length !== 1 || !shape.kind) return null;
  const [line] = lines as [FundLine];
  const signed = shape.kind === "out" ? negate(shape.size) : shape.size;
  return same(line.amount.number, signed) ? line.fund : null;
}

/** The verb a line reads with: "To" a fund (money in), "From" one (money out, or taken on a
 * transfer), "For" one (set aside on a transfer). */
export function verb(shape: FundShape, side: Side): string {
  if (shape.kind === "in") return "To";
  if (shape.kind === "out") return "From";
  return side === "from" ? "From" : "For";
}

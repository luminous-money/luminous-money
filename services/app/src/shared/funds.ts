/**
 * Funds: what a transaction does to funds, worked out the way the ledger does
 * (`services/ledger/src/ledger/fundlines.py`), so the PWA can say it before saving and the server
 * can write lines the ledger will take.
 *
 * - A line is a fund and a signed amount of one commodity: `+` into the fund, `-` out of it.
 *   Unallocated is never a line: it's what isn't in a fund.
 * - Funds read a transaction **one commodity at a time** (Funds B): each commodity's change is the
 *   sum of its asset and liability splits' units. More of it is money *in* (lines go *to*
 *   funds), less is money *out* (lines come *from* them), none changed but some moved is a
 *   *transfer* (lines put it *toward* funds, and with More options take from them). A buy is
 *   dollars out and shares in, so one fund can make a whole trade: `-3000.00 USD`, `+10 VTI`.
 * - Its **size** is what came in or went out, or for a transfer what moved. Lines add up to no
 *   more than that, each way, per commodity.
 * - **Default funds:** each balance-sheet split counts for its account's default fund (else
 *   Unallocated); a line takes over from the side it's on, and the rest stays with the defaults.
 */
import { add, isMoney, isNegative, isZero, negate } from "./decimal.js";

/** a − b, compared with 0. */
const compare = (a: string, b: string) => {
  const difference = add(a, negate(b));
  return isZero(difference) ? 0 : isNegative(difference) ? -1 : 1;
};

export const UNALLOCATED = "Unallocated";

export type FundLine = { fund: string; amount: { number: string; currency: string } };

/** One commodity of a transaction as funds see it: its kind (null: not worked out yet, as when
 * the splits don't balance) and its size. */
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

/** A transaction's balance-sheet splits (account, units), a lone blank amount filled in as
 * booking would; null when that can't be done. */
export function splitsOf(
  postings: PostingLike[]
): { account: string; number: string; currency: string }[] | null {
  const blanks = postings.filter((p) => !p.units);
  const units = postings.map((p) => p.units ?? null);
  // A blank that isn't on the balance sheet (the category) doesn't need filling in.
  if (!blanks.some((p) => BALANCE_SHEET.test(p.account)))
    return postings.flatMap((p, i) =>
      BALANCE_SHEET.test(p.account) ? [{ account: p.account, ...units[i]! }] : []
    );
  if (blanks.length > 1) return null;
  if (blanks.length === 1) {
    const known = postings.filter((p) => p.units).map(weight);
    if (known.some((w) => !w) || !known.length) return null;
    const currency = known[0]!.currency;
    if (known.some((w) => w!.currency !== currency)) return null;
    const rest = known.reduce((sum, w) => add(sum, w!.number), "0");
    units[postings.indexOf(blanks[0]!)] = { number: negate(rest), currency };
  }
  return postings.flatMap((p, i) =>
    BALANCE_SHEET.test(p.account) ? [{ account: p.account, ...units[i]! }] : []
  );
}

/**
 * A transaction's shapes for funds: one per commodity on its balance sheet, the operating
 * currency first. `postings` may have one blank amount (it balances the rest, when they're all
 * in one currency), as an editor holds them. Null when it can't be read.
 */
export function shapesOf(postings: PostingLike[], operating: string): FundShape[] | null {
  const found = splitsOf(postings);
  if (!found) return null;
  const currencies = [...new Set(found.map((s) => s.currency))].sort((a, b) =>
    a === operating ? -1 : b === operating ? 1 : a.localeCompare(b)
  );
  return currencies.map((currency) => {
    const mine = found.filter((s) => s.currency === currency).map((s) => s.number);
    const delta = mine.reduce((sum, n) => add(sum, n), "0");
    if (isZero(delta)) {
      const moved = mine.filter((n) => !isNegative(n)).reduce((sum, n) => add(sum, n), "0");
      return { kind: "transfer", size: moved, currency };
    }
    return isNegative(delta)
      ? { kind: "out", size: negate(delta), currency }
      : { kind: "in", size: delta, currency };
  });
}

/** One commodity's shape, from the list (the operating currency's, with no commodity given). */
export const shapeIn = (shapes: FundShape[] | null, currency: string): FundShape | undefined =>
  shapes?.find((s) => s.currency === currency);

/** The lines that put all of a transaction into a fund, or take all of it from one: one per
 * commodity, by that commodity's kind. */
export function wholeLines(shapes: FundShape[] | null, fund: string): FundLine[] {
  return (shapes ?? []).flatMap((shape) => {
    if (!shape.kind || isZero(shape.size)) return [];
    const number = shape.kind === "out" ? negate(shape.size) : shape.size;
    return [{ fund, amount: { number, currency: shape.currency } }];
  });
}

/** Whether these shapes are a trade: one commodity out and another in. */
export const isTrade = (shapes: FundShape[] | null) =>
  !!shapes &&
  shapes.length === 2 &&
  shapes.some((s) => s.kind === "out") &&
  shapes.some((s) => s.kind === "in");

/** An amount as the ledger words it: money with its cents ("1,200.00 USD"), anything else as
 * it's written ("12 VTI"). */
export const ledgerMoney = (number: string, currency: string) =>
  isMoney(currency)
    ? `${Number(number).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
    : `${number} ${currency}`;

/** What's wrong with these lines on a transaction of these shapes (worded as the ledger words
 * it, unless `money` says otherwise); null if nothing is, or the shapes aren't known. */
export function linesProblem(
  shapes: FundShape[] | null,
  lines: FundLine[],
  money: (number: string, currency: string) => string = ledgerMoney
): string | null {
  if (!shapes || shapes.some((s) => !s.kind)) return null;
  const stray = lines.find((l) => !shapes.some((s) => s.currency === l.amount.currency));
  if (stray) return `it moves no ${stray.amount.currency} (${stray.fund})`;
  for (const shape of shapes) {
    const mine = lines.filter((l) => l.amount.currency === shape.currency);
    const into = mine
      .filter((l) => !isNegative(l.amount.number))
      .reduce((s, l) => add(s, l.amount.number), "0");
    const outOf = negate(
      mine.filter((l) => isNegative(l.amount.number)).reduce((s, l) => add(s, l.amount.number), "0")
    );
    const taken = mine.find((l) => isNegative(l.amount.number))?.fund;
    const given = mine.find((l) => !isNegative(l.amount.number) && !isZero(l.amount.number))?.fund;
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
  }
  return null;
}

/** Lines summed per fund and commodity, zeros dropped: two transactions' lines made one. */
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

/** An account's default fund from a day (Funds B); `fund` null: none of its own from then on. */
export type DefaultFund = { account: string; fund: string | null; date: string };

/** The fund an account's unmarked changes on `date` belong to: the nearest account (itself, then
 * up) whose latest default by then names one; else Unallocated. */
export function fundFor(defaults: DefaultFund[], account: string, date: string): string {
  const parts = account.split(":");
  for (let i = parts.length; i > 0; i--) {
    const at = parts.slice(0, i).join(":");
    const latest = defaults
      .filter((d) => d.account === at && d.date <= date)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
    if (latest?.fund) return latest.fund;
  }
  return UNALLOCATED;
}

/** What a transaction does to each fund (Unallocated included), per commodity: its lines, and
 * the rest of each side by its accounts' default funds, in proportion to their splits. Null when
 * its splits can't be read. */
export function effectsOf(
  postings: PostingLike[],
  lines: FundLine[],
  defaults: DefaultFund[],
  date: string
): { fund: string; currency: string; number: string }[] | null {
  const found = splitsOf(postings);
  if (!found) return null;
  const out = new Map<string, { fund: string; currency: string; number: string }>();
  const bump = (fund: string, currency: string, number: string) => {
    const key = `${fund}\u0000${currency}`;
    const was = out.get(key);
    out.set(key, { fund, currency, number: add(was?.number ?? "0", number) });
  };
  for (const l of lines) bump(l.fund, l.amount.currency, l.amount.number);
  for (const currency of new Set(found.map((s) => s.currency))) {
    for (const up of [true, false]) {
      const side = found.filter(
        (s) =>
          s.currency === currency &&
          !isZero(s.number) &&
          (up ? !isNegative(s.number) : isNegative(s.number))
      );
      const total = side.reduce((sum, s) => add(sum, s.number), "0");
      const taken = lines
        .filter(
          (l) =>
            l.amount.currency === currency &&
            !isZero(l.amount.number) &&
            (up ? !isNegative(l.amount.number) : isNegative(l.amount.number))
        )
        .reduce((sum, l) => add(sum, l.amount.number), "0");
      const rest = add(total, negate(taken));
      if (!side.length || isZero(rest) || isNegative(rest) === up) continue;
      const byFund = new Map<string, string>();
      for (const s of side) {
        const fund = fundFor(defaults, s.account, date);
        byFund.set(fund, add(byFund.get(fund) ?? "0", s.number));
      }
      if (byFund.size === 1) {
        bump([...byFund.keys()][0]!, currency, rest);
        continue;
      }
      const places = Math.max(...side.map((s) => s.number.split(".")[1]?.length ?? 0));
      const largest = [...byFund].sort(
        (a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1]))
      )[0]![0];
      let given = "0";
      for (const [fund, n] of byFund) {
        if (fund === largest) continue;
        const share = ((Number(rest) * Number(n)) / Number(total)).toFixed(places);
        bump(fund, currency, share);
        given = add(given, share);
      }
      bump(largest, currency, add(rest, negate(given)));
    }
  }
  return [...out.values()].filter((e) => !isZero(e.number));
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

import { under } from "./accounts.js";
import { addMonths, lastOf, monthOf } from "./dates.js";
import { DEFAULT_ROOTS, type Balance, type Posting, type Price, type Roots } from "./types.js";

export type NetWorthMonth = {
  month: string;
  /** The month's last day (today, for this month). */
  end: string;
  assets: number;
  /** What's owed, as a positive number. */
  liabilities: number;
  net: number;
};

export type NetWorth = {
  currency: string;
  months: NetWorthMonth[];
  /** Commodities held with no price to value them by: not counted. */
  unpriced: string[];
};

/**
 * Assets, liabilities and net worth at each of the last `months` month ends, backed out from
 * today's balances and the postings since (so no history before the window is needed), with
 * holdings valued at their latest price on or before each month end.
 */
export function netWorth({
  balances,
  postings,
  prices,
  today,
  currency,
  months = 24,
  roots = DEFAULT_ROOTS,
}: {
  /** Today's balances of the assets and liabilities (per account or per root). */
  balances: Balance[];
  /** Every posting from the first month's end on. */
  postings: Posting[];
  prices: Price[];
  today: string;
  currency: string;
  months?: number;
  roots?: Roots;
}): NetWorth {
  const side = (account: string) =>
    under(account, roots.assets)
      ? "assets"
      : under(account, roots.liabilities)
        ? "liabilities"
        : null;
  // Units held now, per side and commodity, as floats: holdings may have many decimals.
  const held = { assets: new Map<string, number>(), liabilities: new Map<string, number>() };
  for (const b of balances) {
    const s = side(b.account);
    if (s) held[s].set(b.currency, (held[s].get(b.currency) ?? 0) + Number(b.amount));
  }
  const byDate = [...postings]
    .filter((p) => side(p.account) && p.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  const priceList = new Map<string, Price[]>();
  for (const p of prices.filter((p) => p.currency === currency))
    priceList.set(p.commodity, [...(priceList.get(p.commodity) ?? []), p]);
  for (const list of priceList.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  const priceOn = (commodity: string, date: string): number | null => {
    if (commodity === currency) return 1;
    let found: number | null = null;
    for (const p of priceList.get(commodity) ?? []) {
      if (p.date > date) break;
      found = Number(p.number);
    }
    return found;
  };

  const unpriced = new Set<string>();
  const value = (units: Map<string, number>, date: string) => {
    let total = 0;
    for (const [commodity, n] of units) {
      if (Math.abs(n) < 1e-9) continue;
      const price = priceOn(commodity, date);
      if (price === null) unpriced.add(commodity);
      else total += n * price;
    }
    return Math.round(total * 100) / 100;
  };

  const current = monthOf(today);
  const ends = Array.from({ length: months }, (_, i) => addMonths(current, -i)).map((m) => ({
    month: m,
    end: m === current ? today : lastOf(m),
  }));
  // Walk back from today, taking each posting back out once its date is past the month end.
  const out: NetWorthMonth[] = [];
  let i = 0;
  for (const { month, end } of ends) {
    while (i < byDate.length && byDate[i]!.date > end) {
      const p = byDate[i++]!;
      const map = held[side(p.account)!];
      map.set(p.currency, (map.get(p.currency) ?? 0) - Number(p.amount));
    }
    const assets = value(held.assets, end);
    const liabilities = -value(held.liabilities, end);
    out.push({
      month,
      end,
      assets,
      liabilities,
      net: Math.round((assets - liabilities) * 100) / 100,
    });
  }
  return { currency, months: out.reverse(), unpriced: [...unpriced].sort() };
}

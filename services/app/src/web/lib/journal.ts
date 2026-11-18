/** The book's journal (every account's transactions), as rows read: where the money went. */
import { shortName } from "./accounts.js";
import { add, isMoney, isNegative, isZero, negate } from "./decimal.js";
import type { JournalRow } from "./ledger.js";

type Amount = { number: string; currency: string };

/** Where money is held: the balance sheet's accounts, rather than the categories it's spent on
 * or earned from. */
const holds = (account: string) => /^(Assets|Liabilities):/.test(account);

/**
 * Where a transaction's money came from and went: the accounts it left (their splits sum to
 * less than zero) and reached (more), each once, and how much moved. The amount is in money (USD,
 * not shares) when there's any, and it's what left the accounts money is held in (a card's
 * charge, discounts and gift cards bought with it aside), or failing that what reached them (a
 * paycheck's deposit); only between categories, the larger of what went in and came out. One
 * split only booking could say (elided) is the rest; of several, each is on whichever side needs
 * it, uncounted.
 */
export function movement(postings: JournalRow["postings"]): {
  from: string[];
  to: string[];
  amount: Amount | null;
} {
  const known = postings.filter((p): p is typeof p & { amount: Amount } => !!p.amount);
  const unknown = postings.filter((p) => !p.amount).map((p) => p.account);
  const nets = new Map<string, Map<string, string>>();
  const book = (account: string, { number, currency }: Amount) => {
    const net = nets.get(account) ?? new Map<string, string>();
    net.set(currency, add(net.get(currency) ?? "0", number));
    nets.set(account, net);
  };
  for (const p of known) book(p.account, p.amount);
  const over = new Map<string, string>();
  for (const { amount } of known)
    over.set(amount.currency, add(over.get(amount.currency) ?? "0", amount.number));
  if (unknown.length === 1)
    for (const [currency, number] of over) book(unknown[0]!, { number: negate(number), currency });

  const from: string[] = [];
  const to: string[] = [];
  for (const [account, net] of nets) {
    const first = [...net.values()].find((n) => !isZero(n));
    if (first) (isNegative(first) ? from : to).push(account);
  }
  if (unknown.length > 1) {
    // Money in if the known splits leave money out over.
    const total = [...over.values()].reduce(add, "0");
    for (const account of new Set(unknown))
      if (!from.includes(account) && !to.includes(account))
        (isNegative(total) ? to : from).push(account);
  }

  const currency =
    known.find((p) => isMoney(p.amount.currency))?.amount.currency ?? known[0]?.amount.currency;
  if (!currency) return { from, to, amount: null };
  const sides = (accounts: [string, Map<string, string>][]) => {
    let into = "0";
    let out = "0";
    for (const [, net] of accounts) {
      const n = net.get(currency) ?? "0";
      if (isNegative(n)) out = add(out, negate(n));
      else into = add(into, n);
    }
    return { into, out };
  };
  const held = sides([...nets].filter(([account]) => holds(account)));
  const all = sides([...nets]);
  const number = !isZero(held.out)
    ? held.out
    : !isZero(held.into)
      ? held.into
      : isNegative(add(all.into, negate(all.out)))
        ? all.out
        : all.into;
  return { from, to, amount: { number, currency } };
}

/** Accounts for a row: one by its short name, several by count. */
export const accountsLabel = (accounts: string[]) =>
  accounts.length === 1 ? shortName(accounts[0]!) : `${accounts.length} accounts`;

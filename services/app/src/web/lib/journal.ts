/** The book's journal (every account's transactions), as rows read: where the money went. */
import { shortName } from "./accounts.js";
import { add, isMoney, isNegative, isZero, negate } from "./decimal.js";
import type { JournalRow } from "./ledger.js";

type Amount = { number: string; currency: string };

/**
 * Where a transaction's money came from and went: the accounts it left (negative splits) and
 * reached (positive), and how much moved. The amount is in money (USD, not shares) when there's
 * any, and the larger of what went in and what came out in it: a buy's cash, not its fee; a
 * paycheck's gross. A split only booking could say (elided) is on whichever side needs it.
 */
export function movement(postings: JournalRow["postings"]): {
  from: string[];
  to: string[];
  amount: Amount | null;
} {
  const from: string[] = [];
  const to: string[] = [];
  const unknown: string[] = [];
  for (const p of postings) {
    if (!p.amount) unknown.push(p.account);
    else if (isZero(p.amount.number)) continue;
    else (isNegative(p.amount.number) ? from : to).push(p.account);
  }
  const known = postings.filter((p): p is typeof p & { amount: Amount } => !!p.amount);
  // An elided split balances the rest: money in if the known splits leave money out over.
  const over = known.reduce((n, p) => add(n, p.amount.number), "0");
  (isNegative(over) ? to : from).push(...unknown);
  const currency =
    known.find((p) => isMoney(p.amount.currency))?.amount.currency ?? known[0]?.amount.currency;
  if (!currency) return { from, to, amount: null };
  let into = "0";
  let out = "0";
  for (const p of known.filter((p) => p.amount.currency === currency)) {
    if (isNegative(p.amount.number)) out = add(out, negate(p.amount.number));
    else into = add(into, p.amount.number);
  }
  const larger = isNegative(add(into, negate(out))) ? out : into;
  return { from, to, amount: { number: larger, currency } };
}

/** Accounts for a row: one by its short name, several by count. */
export const accountsLabel = (accounts: string[]) =>
  accounts.length === 1 ? shortName(accounts[0]!) : `${accounts.length} accounts`;

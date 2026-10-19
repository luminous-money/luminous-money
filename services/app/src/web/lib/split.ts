/**
 * How the review queue reads a transaction.
 *
 * The happy path is a transaction with two plain postings, as a bank feed delivers it. The
 * **anchor** is the side on a bank or card account (Assets:/Liabilities:), which the import came
 * from. The **counterpart** is the side being categorized. Anything else (more postings, lots,
 * prices) is a split, and is edited in the detail view.
 */
import type { Posting, Transaction, TransactionIn } from "@fava-beans/ledger-client";

import { UNKNOWN } from "../../shared/accounts.js";
import { add, isZero, negate } from "./decimal.js";

export const UNCATEGORIZED = "Expenses:Uncategorized";
export { UNKNOWN };

/** A posting's account still to choose: no category yet, or (a receipt's) no account it was
 * paid from. A transaction on one can't be confirmed. */
export const unresolved = (account: string) => account === UNCATEGORIZED || account === UNKNOWN;

const BALANCE_SHEET = /^(Assets|Liabilities):/;

export type Simple = {
  anchor: Posting;
  counterpart: Posting;
  counterpartIndex: number;
  /** The anchor account's change: negative is money out. */
  amount: string;
  currency: string;
};

export function simple(t: Pick<TransactionIn, "postings">): Simple | null {
  const { postings } = t;
  if (postings.length !== 2 || postings.some((p) => p.cost || p.price)) return null;
  const onBalanceSheet = postings.map((p) => BALANCE_SHEET.test(p.account));
  const anchorIndex = onBalanceSheet[1] && !onBalanceSheet[0] ? 1 : 0;
  const anchor = postings[anchorIndex]!;
  const counterpart = postings[1 - anchorIndex]!;
  const units =
    anchor.units ??
    (counterpart.units && {
      number: negate(counterpart.units.number),
      currency: counterpart.units.currency,
    });
  if (!units) return null;
  return {
    anchor,
    counterpart,
    counterpartIndex: 1 - anchorIndex,
    amount: units.number,
    currency: units.currency,
  };
}

/** The writable part of a stored transaction. */
export function toInput(t: Transaction): TransactionIn {
  const { date, flag, payee, narration, tags, links, meta, postings } = t;
  return { date, flag, payee, narration, tags, links, meta, postings };
}

/** A posting moved to the account you chose: it's yours now, so its flag (`!`, a split still to
 * confirm) goes (M16). */
export const chosen = <P extends { account: string; flag?: string | null }>(
  { flag: _flag, ...p }: P,
  account: string
) => ({ ...p, account }) as P;

/** Recategorize the happy path: same amounts, the counterpart moved to another account. */
export function withCounterpart(t: TransactionIn, account: string): TransactionIn {
  const view = simple(t);
  if (!view) throw new Error("not a simple transaction");
  return {
    ...t,
    postings: t.postings.map((p, i) => (i === view.counterpartIndex ? chosen(p, account) : p)),
  };
}

export type Balance =
  | { state: "balanced"; auto: { number: string; currency: string }[] }
  | { state: "invalid"; message: string }
  | { state: "deferred" };

/**
 * Whether postings balance, checked live while editing. Beancount fills in one blank amount, so
 * one blank is fine and its value is shown. With lots or prices, the weights depend on booking,
 * so the check is left to the ledger on save.
 */
export function checkBalance(postings: Posting[]): Balance {
  if (postings.some((p) => !p.account)) {
    return { state: "invalid", message: "Every split needs an account" };
  }
  if (postings.some((p) => p.cost || p.price)) return { state: "deferred" };

  const blanks = postings.filter((p) => !p.units).length;
  if (blanks > 1) return { state: "invalid", message: "Leave at most one amount blank" };

  const totals = new Map<string, string>();
  for (const p of postings) {
    if (p.units) {
      totals.set(p.units.currency, add(totals.get(p.units.currency) ?? "0", p.units.number));
    }
  }
  const off = [...totals].filter(([, total]) => !isZero(total));
  if (blanks === 1) {
    return {
      state: "balanced",
      auto: off.map(([currency, total]) => ({ number: negate(total), currency })),
    };
  }
  if (off.length) {
    return {
      state: "invalid",
      message: `Off by ${off.map(([currency, total]) => `${total} ${currency}`).join(", ")}`,
    };
  }
  return { state: "balanced", auto: [] };
}

/**
 * `t` with its other side set to `account`, relative to `own` (the account being viewed, or one
 * under it): for a two-posting transaction touching it, the posting that isn't its. Null for
 * anything else (more postings, or not touching `own`).
 */
export function withOtherSide(
  t: TransactionIn,
  own: string,
  account: string
): TransactionIn | null {
  if (t.postings.length !== 2) return null;
  const mine = (name: string) => name === own || name.startsWith(`${own}:`);
  const index = mine(t.postings[0]!.account) ? 1 : mine(t.postings[1]!.account) ? 0 : -1;
  if (index === -1) return null;
  return { ...t, postings: t.postings.map((p, i) => (i === index ? chosen(p, account) : p)) };
}

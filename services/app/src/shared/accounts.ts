/**
 * Accounts the code relies on, and which accounts money comes from, for the server and the PWA
 * alike. The ledger protects the system accounts (its `chart.PROTECTED`).
 */
import { negate } from "./decimal.js";
import { partOf } from "./divided.js";

/** Where money in or out goes until it's categorized. */
export const UNCATEGORIZED = { out: "Expenses:Uncategorized", in: "Income:Uncategorized" };
export const isUncategorized = (account: string) =>
  account === UNCATEGORIZED.out || account === UNCATEGORIZED.in;

/** Where a receipt's money came from until someone says (M16): opened when it's needed, and
 * chosen in review before the transaction can be confirmed. */
export const UNKNOWN = "Assets:Unknown";

type Named = {
  name: string;
  kind?: string;
  type?: string | null;
  implicit?: boolean;
  close?: string | null;
  divided?: boolean;
  main_part?: string | null;
};

/** Accounts money comes from or goes to: open asset and liability accounts that take postings
 * (a divided account itself, not its parts), but not the placeholder. */
export function baseAccounts(accounts: Named[]): string[] {
  return accounts
    .filter(
      (a) =>
        (a.type === "asset" || a.type === "liability") &&
        !a.close &&
        a.name !== UNKNOWN &&
        ((a.kind === "leaf" && !a.implicit && !partOf(accounts, a.name)) || a.divided)
    )
    .map((a) => a.name);
}

/**
 * Whether an account's amounts are shown with their signs flipped: liabilities and income, so a
 * card shows what's owed and income shows as positive. Only for reading (balances, ledgers,
 * previews); editors show stored signs, since splits sum to zero.
 */
export function shownInverted(type: string | null | undefined): boolean {
  return type === "liability" || type === "income";
}

/** A stored amount as it's shown for an account of `type`, and back (the same flip). */
export function shown(number: string, type: string | null | undefined): string {
  return shownInverted(type) ? negate(number) : number;
}

/**
 * Accounts the code relies on, and which accounts money comes from, for the server and the PWA
 * alike. The ledger protects the system accounts (its `chart.PROTECTED`).
 */
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

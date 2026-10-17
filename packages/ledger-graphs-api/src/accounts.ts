/** Account names: where one sits in the tree. */

/** Whether `account` is `root` or under it. */
export function under(account: string, root: string): boolean {
  return account === root || account.startsWith(`${root}:`);
}

/** The account `levels` below `base` that `account` falls in: `Expenses:Food:Groceries` is
 * `Expenses:Food` one level below `Expenses`. An account shallower than that is itself. */
export function atDepth(account: string, base: string, levels: number): string {
  const parts = account.split(":");
  const baseLength = base.split(":").length;
  return parts.slice(0, Math.min(parts.length, baseLength + levels)).join(":");
}

/** The last part of a name, for labels: `Expenses:Food:Groceries` is "Groceries". */
export const lastPart = (account: string) => account.slice(account.lastIndexOf(":") + 1);

/** How an account's flow reads: income and equity are credits, so theirs flips to read as earned.
 * Expenses, assets and liabilities read as they are (spent, put in, paid down). */
export function flowSign(account: string, roots: { income: string; equity: string }): 1 | -1 {
  return under(account, roots.income) || under(account, roots.equity) ? -1 : 1;
}

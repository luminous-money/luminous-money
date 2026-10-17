/**
 * Divided accounts (M14): an asset or liability node that's one real account (at a bank, say),
 * the accounts under it dividing what's in it. It's reconciled and linked as one; its
 * sub-accounts can't be reconciled, linked or divided themselves. The ledger keeps the mode
 * (`divided: TRUE` on its `open`) and enforces it there; these say what follows from it, for the
 * server and the PWA alike.
 */

type Named = { name: string; kind?: string; type?: string | null; divided?: boolean };

/** The divided account `name` is part of (one above it), if any. */
export function partOf(accounts: Named[], name: string): string | undefined {
  const divided = new Set(accounts.filter((a) => a.divided).map((a) => a.name));
  const parts = name.split(":");
  for (let i = 1; i < parts.length; i++) {
    const above = parts.slice(0, i).join(":");
    if (divided.has(above)) return above;
  }
  return undefined;
}

/** Whether the account is reconciled itself: an asset or liability leaf that isn't part of a
 * divided account, or a divided account. */
export function reconciledItself(accounts: Named[], name: string): boolean {
  const account = accounts.find((a) => a.name === name);
  if (!account || (account.type !== "asset" && account.type !== "liability")) return false;
  if (partOf(accounts, name)) return false;
  return account.kind === "leaf" || !!account.divided;
}

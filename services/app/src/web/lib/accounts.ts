import type { Account } from "@luminous-money/ledger-client";

import { shown, shownInverted } from "../../shared/accounts.js";

import { normalizeName, toSegment, typed } from "../../shared/names.js";

export { normalizeName, shown, shownInverted, toSegment, typed };

/** Accounts a transaction dated `date` (ISO) can post to: leaves, open on that date. */
export function postable(accounts: Account[], date: string): string[] {
  return accounts
    .filter((a) => a.kind === "leaf" && (!a.open || a.open <= date) && (!a.close || a.close > date))
    .map((a) => a.name);
}

export const TYPE_LABELS: Record<NonNullable<Account["type"]>, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

/** Roots to list first, given which way money moved on the anchor side. */
export function preferredRoots(outflow: boolean): string[] {
  return outflow
    ? ["Expenses", "Liabilities", "Assets", "Income", "Equity"]
    : ["Income", "Assets", "Liabilities", "Expenses", "Equity"];
}

/**
 * Account search for the picker. Every word of the query must appear in the name. Matches at the
 * start of a segment rank first (so "food rest" finds Expenses:Food:Restaurant), then preferred
 * roots, then shorter names.
 */
export function search(names: string[], query: string, prefer: string[] = []): string[] {
  const words = query
    .toLowerCase()
    .split(/[\s:]+/)
    .filter(Boolean);
  const rootRank = (name: string) => {
    const i = prefer.indexOf(name.split(":")[0]!);
    return i === -1 ? prefer.length : i;
  };
  const scored = names
    .map((name) => {
      const lower = name.toLowerCase();
      if (!words.every((w) => lower.includes(w))) return null;
      const segments = lower.split(":");
      const score = words.filter((w) => segments.some((s) => s.startsWith(w))).length;
      return { name, score };
    })
    .filter((x): x is { name: string; score: number } => x !== null);
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        rootRank(a.name) - rootRank(b.name) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name)
    )
    .map((x) => x.name);
}

/** The last two segments, for compact display ("Food:Restaurant"). */
export function shortName(account: string): string {
  return account.split(":").slice(-2).join(":");
}

/** One segment of an account name, as Beancount requires: a capital letter or digit, then
 * letters, digits and dashes. */
const SEGMENT = /^[\p{Lu}\p{Nd}][\p{L}\p{Nd}-]*$/u;

export function isSegment(text: string): boolean {
  return SEGMENT.test(text);
}

/**
 * A fully qualified name to start a new account from, given what was searched.
 *
 * - "Groceries" goes under the preferred root: `Expenses:Groceries`.
 * - A typed root is kept: "assets:cash wallet" becomes `Assets:Cash-Wallet`.
 * - A typed path whose front names a node goes under it: "utilities:power" becomes
 *   `Expenses:Utilities:Power` when `Expenses:Utilities` is a node.
 *
 * It's only a starting point; the name stays editable.
 */
export function suggestName(query: string, accounts: Account[], preferredRoot: string): string {
  const parts = query
    .split(":")
    .map((p) => p.trim())
    .filter((p, i, all) => p || i === all.length - 1);
  const roots = accounts.filter((a) => !a.name.includes(":")).map((a) => a.name);
  if (!parts.join("")) return `${preferredRoot}:`;

  const root = roots.find((r) => r.toLowerCase() === parts[0]!.toLowerCase());
  if (root && parts.length > 1) return [root, ...parts.slice(1).map(toSegment)].join(":");

  if (parts.length > 1) {
    const path = parts.slice(0, -1).join(":").toLowerCase();
    const nodes = accounts.filter((a) => a.kind === "node" && !a.close).map((a) => a.name);
    const parent =
      nodes.find((n) => n.toLowerCase() === path) ??
      nodes.find((n) => n.toLowerCase().endsWith(`:${path}`));
    if (parent) return `${parent}:${toSegment(parts.at(-1)!)}`;
  }
  return [preferredRoot, ...parts.map(toSegment)].join(":");
}

/**
 * Node accounts the name could continue into: the open nodes that start with what's typed
 * (ignoring case), other than exactly what's typed. Shortest first, then alphabetically.
 */
export function completions(input: string, accounts: Account[]): string[] {
  const prefix = input.toLowerCase();
  return accounts
    .filter((a) => a.kind === "node" && !a.close)
    .map((a) => a.name)
    .filter((name) => name.toLowerCase().startsWith(prefix) && name.length > input.length)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/**
 * Fill in the next portion of `account` after what's typed: up to and including the next colon,
 * or to the end of the account's name, whichever comes first. What's already typed takes the
 * account's own capitalization.
 */
export function completeWith(input: string, account: string): string {
  const rest = account.slice(input.length);
  const colon = rest.indexOf(":", 1);
  return account.slice(0, input.length) + (colon === -1 ? rest : rest.slice(0, colon + 1));
}

export type NewAccountCheck =
  { ok: true; type: Account["type"]; creates: string[] } | { ok: false; message: string };

/**
 * Whether `name` can be created as a new leaf, by the ledger's rules, so the dialog can say why
 * before submitting. The ledger checks again on create.
 *
 * - The root must be one of the top-level accounts, and the name must go below it.
 * - Each part starts with a capital letter or digit, then letters, digits and dashes.
 * - The nearest existing ancestor must be an open node. Levels in between that don't exist yet
 *   are created as nodes along the way (`creates`).
 */
export function checkNewAccount(name: string, accounts: Account[]): NewAccountCheck {
  const byName = new Map(accounts.map((a) => [a.name, a]));
  const roots = accounts.filter((a) => !a.name.includes(":")).map((a) => a.name);
  const parts = name.split(":");
  const root = byName.get(parts[0]!);

  if (!root || !roots.includes(root.name))
    return { ok: false, message: `Start with one of ${roots.join(", ")}` };
  if (parts.length < 2 || !parts.at(-1))
    return { ok: false, message: `Name an account under ${root.name}` };
  const bad = parts.slice(1).find((p) => !isSegment(p));
  if (bad !== undefined) {
    return {
      ok: false,
      message: `"${bad}" isn't valid: start each part with a capital letter or digit, then letters, digits and dashes`,
    };
  }

  const existing = byName.get(name);
  if (existing && !existing.implicit) return { ok: false, message: `${name} already exists` };
  if (existing)
    return {
      ok: false,
      message: `${name} already has accounts under it, so it can't hold transactions`,
    };

  const creates: string[] = [];
  for (let i = parts.length - 1; i > 0; i--) {
    const ancestor = byName.get(parts.slice(0, i).join(":"));
    if (!ancestor) {
      creates.unshift(parts.slice(0, i).join(":"));
      continue;
    }
    if (ancestor.kind === "leaf")
      return {
        ok: false,
        message: `${ancestor.name} holds transactions, so it can't have sub-accounts`,
      };
    if (ancestor.close) return { ok: false, message: `${ancestor.name} is closed` };
    break;
  }
  return { ok: true, type: root.type, creates };
}

/** An account's human name: its `display-name` if set, else its last segment with dashes as
 * spaces ("PNC-Shared-Checking" → "PNC Shared Checking"). */
export function displayName(account: { name: string; display_name?: string | null }): string {
  return account.display_name ?? account.name.split(":").at(-1)!.replace(/-/g, " ");
}

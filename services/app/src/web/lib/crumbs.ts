/**
 * Breadcrumbs: where a page sits, as the links above it. A page's place is its structure (an
 * account under its parents under Accounts; a rule under Rules; everything in a book under its
 * home), unless it was opened from somewhere with `?back=`: then it's under that page, with that
 * page's own trail above it (a transaction opened from Groceries' ledger is Home › Accounts ›
 * Expenses › Food › Groceries › Transaction), and that crumb goes back to exactly where it was
 * (the same review card, the same filter).
 */

export type Crumb = { label: string; href: string };

/** What the trail needs to know about the book's accounts. */
export type Known = {
  /** An account's name to show (its display name, or its last part). */
  label(account: string): string;
  /** Whether an account is a node whose page is its editor (not a ledger). */
  isNode(account: string): boolean;
  /** A fund's name, as shown. */
  fund?(name: string): string;
};

const SECTIONS: Record<string, string> = {
  review: "Review",
  transactions: "Transactions",
  accounts: "Accounts",
  budgets: "Budgets",
  funds: "Funds",
  reports: "Reports",
  schedules: "Schedules",
  loans: "Loans",
  rules: "Rules",
  commodities: "Commodities",
  connections: "Bank connections",
  amazon: "Amazon",
  ai: "AI",
  import: "Import transactions",
  notifications: "Notifications",
  sharing: "Sharing",
  migrate: "Migrate",
  receipt: "Receipt",
};

/** Under a list, by what's in it: its "new" page, and an item's. */
const ITEMS: Record<string, { item: string; fresh: string }> = {
  transactions: { item: "Transaction", fresh: "New transaction" },
  rules: { item: "Rule", fresh: "New rule" },
  schedules: { item: "Schedule", fresh: "New schedule" },
  loans: { item: "Loan", fresh: "New loan" },
};

const ACCOUNT_PAGES: Record<string, string> = {
  edit: "Edit",
  reconcile: "Reconcile",
  trade: "Trade",
};

const decode = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/** An account's page: a node's is its editor, a leaf's (or a divided one's) its ledger. */
export const accountHref = (book: string, account: string, known: Known) =>
  `/books/${book}/accounts/${encodeURIComponent(account)}${known.isNode(account) ? "/edit" : ""}`;

/** The account and the accounts above it, each a crumb to its page (a root, Expenses, goes to
 * the Accounts page, which shows them). */
function accountTrail(book: string, account: string, known: Known): Crumb[] {
  const parts = account.split(":");
  return parts.map((_, i) => {
    const name = parts.slice(0, i + 1).join(":");
    return {
      label: known.label(name),
      href: i === 0 ? `/books/${book}/accounts` : accountHref(book, name, known),
    };
  });
}

/** A page by its path (without the query): what it's called, and the crumbs above it by its
 * structure. Null for a path that isn't a page. */
export function placeOf(path: string, known: Known): { label: string; above: Crumb[] } | null {
  const parts = path.split("/").filter(Boolean).map(decode);
  if (parts[0] === "books" && parts.length === 1) return { label: "Manage books", above: [] };
  if (parts[0] === "account") return { label: "Your account", above: [] };
  if (parts[0] === "system") return { label: "System", above: [] };
  if (parts[0] !== "books" || !parts[1]) return null;
  const book = parts[1];
  const home: Crumb = { label: "Home", href: `/books/${book}` };
  const [section, item, page] = parts.slice(2);
  if (!section) return { label: "Home", above: [] };
  const list: Crumb = { label: SECTIONS[section] ?? section, href: `/books/${book}/${section}` };
  if (!item) return { label: list.label, above: [home] };

  if (section === "accounts") {
    if (item === "new") return { label: "New account", above: [home, list] };
    if (item === "import") return { label: "Import a chart", above: [home, list] };
    const trail = accountTrail(book, item, known);
    const self = trail.at(-1)!;
    // A node's editor is its page; a leaf's editor, reconciling and trading are under its ledger.
    if (!page || (page === "edit" && known.isNode(item)))
      return { label: self.label, above: [home, list, ...trail.slice(0, -1)] };
    return {
      label: ACCOUNT_PAGES[page] ?? page,
      above: [home, list, ...trail.slice(0, -1), { ...self, href: accountHref(book, item, known) }],
    };
  }
  if (section === "funds") return { label: known.fund?.(item) ?? item, above: [home, list] };
  const items = ITEMS[section];
  if (items) return { label: item === "new" ? items.fresh : items.item, above: [home, list] };
  return { label: item, above: [home, list] };
}

/** The crumbs above the page at `path`, opened from `back` (a path in the app, with its query)
 * or not. */
export function trail(path: string, back: string | null, known: Known, depth = 0): Crumb[] {
  if (back && back.startsWith("/") && depth < 5) {
    const [backPath = "", query = ""] = back.split("?");
    const from = placeOf(backPath, known);
    // That page's own trail, as it was opened (it may have come from somewhere too).
    const above = trail(backPath, new URLSearchParams(query).get("back"), known, depth + 1);
    if (from && backPath !== path) return [...above, { label: from.label, href: back }];
  }
  return placeOf(path, known)?.above ?? [];
}

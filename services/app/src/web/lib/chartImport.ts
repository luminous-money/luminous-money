/**
 * Importing a chart of accounts: a CSV, one account a row, read into what it would add, before
 * anything is written. The ledger then opens what can be added in one write
 * (`POST /accounts/batch`), in `batchOrder`.
 */
import type { Account, AccountIn } from "@luminous-money/ledger-client";
import { detectDateFormat, parseAmount, parseCsv, parseDate } from "@luminous-money/csv-import";

import { normalizeName, shown } from "./accounts.js";

/** The columns read, and the headers each is read from (case, spaces, dashes and underscores
 * ignored), the first that's there winning: a GnuCash export's `full_name` beats its `name`. */
const COLUMNS = {
  account: ["account", "fullname", "accountname", "name"],
  displayName: ["displayname"],
  description: ["description", "notes", "note"],
  balance: ["openingbalance", "balance"],
  asOf: ["asof", "balanceasof", "balancedate", "openingbalancedate", "date"],
  currency: ["currency", "commodity"],
  opened: ["opened", "opendate", "opens", "open"],
  booking: ["booking"],
  revalueEvery: ["revalueevery", "revalueeverydays"],
} as const;
type Column = keyof typeof COLUMNS;

const BOOKINGS = ["FIFO", "LIFO", "HIFO", "STRICT", "NONE"] as const;
// The ledger's: a currency or commodity.
const CURRENCY = /^[A-Z][A-Z0-9'._-]{0,22}[A-Z0-9]$/;

/** A row that will be added: the account as it's sent, and what the preview shows. */
export type Planned = {
  line: number;
  /** The name as the file has it. */
  written: string;
  account: AccountIn;
  /** Its opening balance as it was written (a card's: what's owed), to show. */
  balance: string | null;
};

export type ChartPlan = {
  add: Planned[];
  /** Rows naming an account the book has: left as it is. */
  existing: { line: number; written: string; name: string }[];
  problems: { line: number; written: string; problem: string }[];
  /** Headers that aren't read, as the file has them. */
  ignored: string[];
  /** Why the file can't be read at all. */
  error: string | null;
};

const headerKey = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which cell holds each column, by the header row; null if there's no Account column. */
function mapHeader(header: string[]): Partial<Record<Column, number>> | null {
  const found: Partial<Record<Column, number>> = {};
  const keys = header.map(headerKey);
  for (const [column, names] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
    for (const name of names) {
      const index = keys.indexOf(name);
      if (index !== -1 && !Object.values(found).includes(index)) {
        found[column] = index;
        break;
      }
    }
  }
  return found.account === undefined ? null : found;
}

/**
 * What a chart of accounts would do to the book: each row's account, normalized (`normalizeName`),
 * and whether it's added, already here or can't be added (and why). `currency` is the book's,
 * for balances that don't say.
 *
 * - A row is a node if another row's account goes under it, else a leaf.
 * - A name listed twice is a problem the second time.
 * - What it's under must be a node or not exist yet (then opened on the way), and not archived.
 * - An opening balance (as written: a card's, what's owed) needs its date, and only a leaf has one.
 */
export function planChart(text: string, accounts: Account[], currency: string): ChartPlan {
  const plan: ChartPlan = { add: [], existing: [], problems: [], ignored: [], error: null };
  // Each row with its line in the file, blank lines aside.
  const rows = parseCsv(text, undefined, { keepBlank: true })
    .rows.map((cells, i) => ({ cells, line: i + 1 }))
    .filter(({ cells }) => cells.some(Boolean));
  if (!rows.length) return { ...plan, error: "The file is empty." };

  // A header row, or (no header) a list of full names.
  const header = rows[0]!.cells;
  let columns = mapHeader(header);
  let body = rows.slice(1);
  if (!columns) {
    if (!/^[^:]+:/.test(header[0] ?? ""))
      return {
        ...plan,
        error:
          "The file needs an Account column: a header row naming it, then each account's full name (like Expenses:Food:Groceries).",
      };
    columns = { account: 0 };
    body = rows;
  } else {
    const read = new Set(Object.values(columns));
    plan.ignored = header.filter((h, i) => !read.has(i) && h);
  }
  const cell = (row: string[], column: Column) =>
    columns[column] === undefined ? "" : (row[columns[column]!] ?? "").trim();

  const byName = new Map(accounts.map((a) => [a.name, a]));
  const roots = accounts.filter((a) => !a.name.includes(":")).map((a) => a.name);
  // A column's date format: the one all its dates are in, else most (a bad one is the row's).
  const dates = (column: Column) => {
    const cells = body.map((row) => cell(row.cells, column)).filter(Boolean);
    return detectDateFormat(cells) ?? detectDateFormat(cells, 0.5);
  };
  const asOfFormat = dates("asOf");
  const openedFormat = dates("opened");
  const date = (row: string[], column: Column, format: typeof asOfFormat) => {
    const value = cell(row, column);
    if (!value) return { value: null };
    const iso = format && parseDate(value, format);
    return iso ? { value: iso } : { problem: `"${value}" isn't a date` };
  };

  // Each row on its own: its name and its fields.
  type Read = Omit<Planned, "account"> & {
    name: string;
    fields: Omit<AccountIn, "name" | "kind">;
    amount: string | null;
  };
  const read: Read[] = [];
  const seen = new Map<string, number>();
  body.forEach(({ cells: row, line }): void => {
    const written = cell(row, "account");
    const problem = (problem: string) => void plan.problems.push({ line, written, problem });
    if (!written) return problem("No account name");
    const normal = normalizeName(written, roots);
    if ("problem" in normal) return problem(normal.problem);
    const { name } = normal;
    if (seen.has(name)) return problem(`${name} is also on line ${seen.get(name)}`);
    seen.set(name, line);
    if (byName.has(name)) return void plan.existing.push({ line, written, name });

    const balance = cell(row, "balance");
    const amount = balance ? parseAmount(balance) : null;
    if (balance && amount === null) return problem(`"${balance}" isn't an amount`);
    const asOf = date(row, "asOf", asOfFormat);
    if ("problem" in asOf) return problem(asOf.problem!);
    if (amount !== null && !asOf.value)
      return problem("An opening balance needs its date (an As of column)");
    const money = (cell(row, "currency") || currency).toUpperCase();
    if (amount !== null && !CURRENCY.test(money)) return problem(`"${money}" isn't a currency`);
    const opened = date(row, "opened", openedFormat);
    if ("problem" in opened) return problem(opened.problem!);
    const booking = cell(row, "booking").toUpperCase();
    if (booking && !(BOOKINGS as readonly string[]).includes(booking))
      return problem(`Booking is one of ${BOOKINGS.join(", ")}`);
    const every = cell(row, "revalueEvery");
    if (every && !/^[1-9]\d*$/.test(every))
      return problem(`Revalue every is a number of days, not "${every}"`);
    const displayName = cell(row, "displayName");
    if (displayName.length > 100) return problem("The display name is over 100 characters");
    const description = cell(row, "description").replace(/\s+/g, " ");
    if (description.length > 500) return problem("The description is over 500 characters");

    read.push({
      line,
      written,
      name,
      amount,
      balance: amount,
      fields: {
        open: opened.value,
        opening_balance:
          amount === null
            ? null
            : {
                amount: shown(amount, byName.get(name.split(":")[0]!)?.type),
                currency: money,
                date: asOf.value!,
              },
        booking: (booking || null) as AccountIn["booking"],
        revalue_every: every ? Number(every) : null,
        display_name: displayName || null,
        description: description || null,
      },
    });
  });

  // Then each against the rest: what's a node, and what it can go under (the nearest account
  // above it the book has: rows above it are nodes, and levels no row names are opened on the way).
  const isNode = (name: string) => read.some((r) => r.name.startsWith(`${name}:`));
  for (const r of read) {
    const problem = (problem: string) =>
      plan.problems.push({ line: r.line, written: r.written, problem });
    const kind = isNode(r.name) ? "node" : "leaf";
    if (kind === "node" && r.amount !== null) {
      problem(`${r.name} has accounts under it, so it can't have an opening balance`);
      continue;
    }
    const parts = r.name.split(":");
    let refused: string | null = null;
    for (let i = parts.length - 1; i > 0; i--) {
      const ancestor = parts.slice(0, i).join(":");
      const found = byName.get(ancestor);
      if (!found) continue;
      if (found.kind === "leaf")
        refused = `${ancestor} holds transactions, so it can't have sub-accounts`;
      else if (found.close) refused = `${ancestor} is archived`;
      break;
    }
    if (refused) {
      problem(refused);
      continue;
    }
    plan.add.push({
      line: r.line,
      written: r.written,
      balance: r.balance,
      account: { name: r.name, kind, ...r.fields },
    });
  }
  plan.problems.sort((a, b) => a.line - b.line);
  return plan;
}

/** The order the ledger opens them in: what has no balance first (so a node comes before what's
 * under it, and `Equity:Opening-Balances`, if the chart names it, before a balance needs it),
 * each by name. */
export function batchOrder(add: Planned[]): AccountIn[] {
  const rank = (a: AccountIn) => (a.opening_balance ? 1 : 0);
  return add
    .map((p) => p.account)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

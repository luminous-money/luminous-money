/**
 * GnuCash's transactions export (File → Export → Export Transactions to CSV, Simple layout
 * unchecked), read into another system's history: one line per split, each with its
 * transaction's ID, date and description (older versions leave them blank on a transaction's
 * later lines, so they carry on from the line before). Amounts are `Value Num.`, in the
 * transaction's currency (a share purchase's cost, not its shares), else `Amount Num.`.
 * Voided transactions are left out.
 *
 * Account names go through `mapping` (the chart's: GnuCash's full name to the account here),
 * else the chart import's normalization; GnuCash's `Imbalance-*` and `Orphan-*` are
 * uncategorized, and its trading accounts' splits are dropped.
 */
import { detectDateFormat, parseAmount, parseCsv, parseDate } from "@luminous-money/csv-import";

import { UNCATEGORIZED } from "../../shared/accounts.js";
import { normalizeName } from "../../shared/names.js";

/** A transaction from another system, as it's kept: never written to the ledger. */
export type OldTransaction = {
  /** The other system's ID for it, if it had one. */
  source_id: string | null;
  date: string;
  /** What it was called there: GnuCash's description. */
  description: string;
  postings: { account: string; amount: string; currency: string; memo: string | null }[];
};

export type HistoryRead = {
  transactions: OldTransaction[];
  /** Lines (or transactions, by their first line) that couldn't be read, and why. */
  problems: { line: number; problem: string }[];
  /** GnuCash's names that weren't in the chart's mapping, to what they became (or null if
   * nothing could be made of them). */
  unmapped: Record<string, string | null>;
  voided: number;
  error: string | null;
};

const COLUMNS = {
  date: ["date"],
  id: ["transactionid"],
  description: ["description"],
  currency: ["commoditycurrency"],
  void: ["voidreason"],
  memo: ["memo"],
  account: ["fullaccountname"],
  value: ["valuenum"],
  amount: ["amountnum"],
} as const;
type Column = keyof typeof COLUMNS;

const headerKey = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");
const GNUCASH_OWN = /^(imbalance|orphan)-[a-z]{3}(:|$)/i;

export function readGnucashHistory(
  text: string,
  { mapping, roots }: { mapping: Record<string, string>; roots: string[] }
): HistoryRead {
  const read: HistoryRead = {
    transactions: [],
    problems: [],
    unmapped: {},
    voided: 0,
    error: null,
  };
  const rows = parseCsv(text, undefined, { keepBlank: true })
    .rows.map((cells, i) => ({ cells, line: i + 1 }))
    .filter(({ cells }) => cells.some(Boolean));
  if (!rows.length) return { ...read, error: "The file is empty." };
  const keys = rows[0]!.cells.map(headerKey);
  if (keys.includes("fullcategorypath"))
    return {
      ...read,
      error:
        "This was exported with Simple layout: export again with Simple layout unchecked, so every split is there.",
    };
  const at = Object.fromEntries(
    Object.entries(COLUMNS).map(([column, names]) => [
      column,
      names.map((n) => keys.indexOf(n)).find((i) => i !== -1) ?? -1,
    ])
  ) as Record<Column, number>;
  if (at.date === -1 || at.account === -1 || (at.value === -1 && at.amount === -1))
    return {
      ...read,
      error:
        "This isn't GnuCash's transactions export: it needs Date, Full Account Name and Value Num. (or Amount Num.) columns.",
    };
  const cell = (row: string[], column: Column) =>
    at[column] === -1 ? "" : (row[at[column]] ?? "").trim();
  const body = rows.slice(1);
  const dates = body.map((r) => cell(r.cells, "date")).filter(Boolean);
  const format = detectDateFormat(dates) ?? detectDateFormat(dates, 0.8);
  if (!format) return { ...read, error: "The dates aren't in a format this can read." };

  const accountFor = (written: string): string | null => {
    if (GNUCASH_OWN.test(written)) return UNCATEGORIZED.out;
    if (/^trading(:|$)/i.test(written)) return null;
    const mapped = mapping[written];
    if (mapped) return mapped;
    if (!(written in read.unmapped)) {
      const normal = normalizeName(written, roots);
      read.unmapped[written] = "name" in normal ? normal.name : null;
    }
    return read.unmapped[written] ?? null;
  };

  // Lines into transactions: a new ID starts one (without IDs, a line with a date: older
  // exports date only a transaction's first line).
  type Draft = OldTransaction & { line: number; voided: boolean; bad: string | null };
  const drafts: Draft[] = [];
  let current: Draft | undefined;
  for (const { cells: row, line } of body) {
    const id = cell(row, "id");
    const dateText = cell(row, "date");
    const description = cell(row, "description");
    const starts = id ? id !== current?.source_id : !current || !!dateText;
    if (starts) {
      const date = dateText ? parseDate(dateText, format) : null;
      current = {
        source_id: id || null,
        date: date ?? "",
        description,
        postings: [],
        line,
        voided: !!cell(row, "void"),
        bad: date ? null : `"${dateText}" isn't a date`,
      };
      drafts.push(current);
    }
    const draft = current!;
    const written = cell(row, "account");
    const number = parseAmount(cell(row, "value") || cell(row, "amount"));
    if (!written || number === null) {
      draft.bad ??= `line ${line} has no account or amount`;
      continue;
    }
    const account = accountFor(written);
    if (account === null) {
      if (!/^trading(:|$)/i.test(written)) draft.bad ??= `"${written}" can't be an account name`;
      continue;
    }
    const currency = cell(row, "currency").split("::").at(-1)?.trim() || "USD";
    draft.postings.push({ account, amount: number, currency, memo: cell(row, "memo") || null });
  }

  for (const { line, voided, bad, ...t } of drafts) {
    if (voided) read.voided++;
    else if (bad) read.problems.push({ line, problem: bad });
    else if (t.postings.length) read.transactions.push(t);
  }
  return read;
}

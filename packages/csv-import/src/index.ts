/**
 * Bank CSVs. Pure functions shared by the browser (previewing a file while profiling it) and the
 * app server (importing it), so both read a file exactly the same way.
 *
 * A **profile** says how one account's CSV export is laid out: where the data starts, which
 * column holds what, the date format, and how amounts are signed. It's guessed from the first
 * file (`guessProfile`), confirmed or corrected by the user, saved with the account, and applied
 * to every later file (`applyProfile`).
 */
import Papa from "papaparse";

export type DateFormat =
  | "YYYY-MM-DD"
  | "YYYY/MM/DD"
  | "YYYYMMDD"
  | "MM/DD/YYYY"
  | "MM/DD/YY"
  | "MM-DD-YYYY"
  | "DD/MM/YYYY"
  | "DD.MM.YYYY";

export const DATE_FORMATS: DateFormat[] = [
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  "YYYYMMDD",
  "MM/DD/YYYY",
  "MM/DD/YY",
  "MM-DD-YYYY",
  "DD/MM/YYYY",
  "DD.MM.YYYY",
];

/** Amounts are one signed column, or a debit column and a credit column. */
export type AmountColumns =
  | {
      kind: "signed";
      column: number;
      /** Flip the sign: for files where money leaving the account is positive. */
      negate: boolean;
    }
  | {
      kind: "split";
      /** Money leaving the account (withdrawals). */
      debit: number;
      /** Money arriving (deposits). */
      credit: number;
    };

export type CsvProfile = {
  delimiter: string;
  /** Rows before the header (or before the data, without one): banks' preambles. Blank lines
   * aren't counted. */
  skip: number;
  /** Whether the first row after `skip` names the columns. */
  header: boolean;
  /** The columns' names: the header's, or "Column 1", "Column 2", ... Also how a later file is
   * checked to have the same layout. */
  columns: string[];
  date: { column: number; format: DateFormat };
  amount: AmountColumns;
  description: number;
  payee: number | null;
  /** The bank's own transaction ID, if the file has one: the most reliable way to recognize a
   * row seen before. */
  id: number | null;
  /** The account's running balance after each row, if the file has one. */
  balance: number | null;
};

export type Row = {
  /** The row's line in the file, 1-based, for pointing at problems. */
  line: number;
  date: string | null;
  /** A decimal string; positive is money into the account. */
  amount: string | null;
  description: string;
  payee: string | null;
  id: string | null;
  balance: string | null;
  /** Why the row couldn't be read, if it couldn't. */
  error: string | null;
};

/** Split a file into rows of cells. The delimiter is detected unless given. Blank lines are
 * left out, unless `keepBlank` (so each row's index is its line, a quoted line break aside). */
export function parseCsv(
  text: string,
  delimiter?: string,
  { keepBlank = false }: { keepBlank?: boolean } = {}
): { rows: string[][]; delimiter: string } {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), {
    delimiter: delimiter ?? "",
    skipEmptyLines: keepBlank ? false : "greedy",
  });
  return {
    rows: result.data.map((row) => row.map((cell) => cell.trim())),
    delimiter: result.meta.delimiter,
  };
}

/**
 * A money amount as a decimal string, or null if the cell isn't one (or is empty). Handles the
 * usual bank spellings: currency symbols, thousands separators, parentheses or a trailing minus
 * for negatives. (Decimal commas, as in "1.234,56", aren't supported yet.)
 */
export function parseAmount(cell: string): string | null {
  let text = cell.replace(/[\s$€£¥]/g, "").replace(/,/g, "");
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) [negative, text] = [true, text.slice(1, -1)];
  if (text.endsWith("-")) [negative, text] = [!negative, text.slice(0, -1)];
  if (text.startsWith("-")) [negative, text] = [!negative, text.slice(1)];
  else if (text.startsWith("+")) text = text.slice(1);
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(text)) return null;
  if (text.startsWith(".")) text = `0${text}`;
  return /^0+(\.0+)?$/.test(text) ? text : `${negative ? "-" : ""}${text}`;
}

const PATTERNS: Record<DateFormat, { pattern: RegExp; order: ("y" | "m" | "d")[] }> = {
  "YYYY-MM-DD": { pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ["y", "m", "d"] },
  "YYYY/MM/DD": { pattern: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, order: ["y", "m", "d"] },
  YYYYMMDD: { pattern: /^(\d{4})(\d{2})(\d{2})$/, order: ["y", "m", "d"] },
  "MM/DD/YYYY": { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["m", "d", "y"] },
  "MM/DD/YY": { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, order: ["m", "d", "y"] },
  "MM-DD-YYYY": { pattern: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: ["m", "d", "y"] },
  "DD/MM/YYYY": { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["d", "m", "y"] },
  "DD.MM.YYYY": { pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ["d", "m", "y"] },
};

/** An ISO date (YYYY-MM-DD) from a cell in `format`, or null if it isn't a real date in it. */
export function parseDate(cell: string, format: DateFormat): string | null {
  const { pattern, order } = PATTERNS[format];
  const match = pattern.exec(cell.trim().split(/[ T]/)[0]!);
  if (!match) return null;
  const parts = Object.fromEntries(order.map((key, i) => [key, Number(match[i + 1])])) as Record<
    "y" | "m" | "d",
    number
  >;
  const year = format === "MM/DD/YY" ? 2000 + parts.y : parts.y;
  const date = new Date(Date.UTC(year, parts.m - 1, parts.d));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== parts.m - 1 ||
    date.getUTCDate() !== parts.d
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * The format `cells` parse in: all of them, or at least `share` of them (for guessing, where a
 * stray bad row shouldn't hide what a column is). When several formats do (every day is 12 or
 * under, so 03/04 could be either), the earlier in `DATE_FORMATS` wins, so month-first beats
 * day-first.
 */
export function detectDateFormat(cells: string[], share = 1): DateFormat | null {
  const values = cells.filter(Boolean);
  if (!values.length) return null;
  const fits = (format: DateFormat) =>
    values.filter((cell) => parseDate(cell, format)).length >= share * values.length;
  return DATE_FORMATS.find(fits) ?? null;
}

/** How much of a column must look right for a guess: a stray bad row is reported as unreadable
 * on import, not allowed to hide what the column is. */
const GUESS_SHARE = 0.8;

/** Header names that suggest what a column holds, most telling first: when several columns
 * match, the one matching the earliest hint wins ("Description" beats "Details"). */
const HEADER_HINTS: Record<string, RegExp[]> = {
  date: [/^(transaction |trans\.? |posting |post(ed)? )?date$/i, /date/i],
  amount: [/^(transaction )?amount$/i, /amount|^amt\b/i],
  debit: [/debit|withdrawal|money out|^out$|paid out/i],
  credit: [/credit|deposit|money in|^in$|paid in/i],
  description: [
    /^description$/i,
    /description/i,
    /^memo$/i,
    /narrative|details/i,
    /^name$|transaction$/i,
  ],
  payee: [/payee|merchant|counterparty/i],
  id: [
    /^(transaction |ref(erence)? |fit)?id$/i,
    /reference|^ref\b|confirmation/i,
    /check|slip|#$/i,
  ],
  balance: [/balance|running bal/i],
};

/**
 * A first guess at how a file is laid out, for the user to confirm or correct. Null if the file
 * doesn't look like a table of transactions at all.
 */
export function guessProfile(text: string): CsvProfile | null {
  const { rows, delimiter } = parseCsv(text);
  // Transactions are the rows with a date cell in them, and the table is as wide as most of them
  // (not most rows: a preamble can outnumber a short file's transactions).
  const dated = (row: string[]) => row.some((cell) => detectDateFormat([cell]));
  const width = mostCommon(rows.filter(dated).map((row) => row.length));
  if (!width || width < 2) return null;

  // The data starts at the first full-width dated row; a header, if any, is the full-width row
  // just before it, and anything earlier is a preamble.
  const looksLikeData = (row: string[]) => row.length === width && dated(row);
  const firstData = rows.findIndex(looksLikeData);
  if (firstData < 0) return null;
  const header = firstData > 0 && rows[firstData - 1]!.length === width;
  const skip = header ? firstData - 1 : firstData;
  const columns = header
    ? rows[skip]!.map((name, i) => name || `Column ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const sample = rows
    .slice(firstData)
    .filter((row) => row.length === width)
    .slice(0, 50);
  const values = (i: number) => sample.map((row) => row[i] ?? "");
  const named = (hints: RegExp[], exclude: number[] = []) => {
    if (!header) return -1;
    for (const hint of hints) {
      const found = columns.findIndex((name, i) => !exclude.includes(i) && hint.test(name));
      if (found >= 0) return found;
    }
    return -1;
  };
  const indexes = columns.map((_, i) => i);

  const dateColumn =
    [named(HEADER_HINTS.date), ...indexes].find(
      (i) => i >= 0 && detectDateFormat(values(i), GUESS_SHARE)
    ) ?? -1;
  if (dateColumn < 0) return null;
  const format = detectDateFormat(values(dateColumn), GUESS_SHARE)!;

  const numeric = (i: number) => {
    const filled = values(i).filter(Boolean);
    return (
      filled.length > 0 &&
      filled.filter((v) => parseAmount(v) !== null).length >= GUESS_SHARE * filled.length
    );
  };
  const balance = named(HEADER_HINTS.balance);
  const used = [dateColumn, balance];
  const debit = named(HEADER_HINTS.debit, used);
  const credit = named(HEADER_HINTS.credit, used);
  let amount: AmountColumns;
  if (debit >= 0 && credit >= 0 && debit !== credit) {
    amount = { kind: "split", debit, credit };
  } else {
    const column =
      [named(HEADER_HINTS.amount, used), ...indexes].find(
        (i) => i >= 0 && !used.includes(i) && numeric(i)
      ) ?? -1;
    if (column < 0) return null;
    amount = { kind: "signed", column, negate: false };
  }
  const amountColumns = amount.kind === "signed" ? [amount.column] : [amount.debit, amount.credit];

  const taken = [dateColumn, balance, ...amountColumns];
  const textColumns = indexes.filter((i) => !taken.includes(i) && !numeric(i));
  const averageLength = (i: number) =>
    values(i).reduce((sum, v) => sum + v.length, 0) / Math.max(1, sample.length);
  const description =
    [named(HEADER_HINTS.description, taken)].find((i) => i >= 0) ??
    [...textColumns].sort((a, b) => averageLength(b) - averageLength(a))[0] ??
    -1;
  if (description < 0) return null;
  const payee = named(HEADER_HINTS.payee, [...taken, description]);
  const id = named(HEADER_HINTS.id, [...taken, description, payee]);

  return {
    delimiter,
    skip,
    header,
    columns,
    date: { column: dateColumn, format },
    amount,
    description,
    payee: payee >= 0 ? payee : null,
    id: id >= 0 ? id : null,
    balance: balance >= 0 ? balance : null,
  };
}

/** Whether `text` has the layout `profile` was made from: the same columns, in the same order. */
export function fits(profile: CsvProfile, text: string): boolean {
  const { rows } = parseCsv(text, profile.delimiter);
  const first = rows[profile.skip];
  if (!first || first.length !== profile.columns.length) return false;
  return (
    !profile.header || first.every((name, i) => (name || `Column ${i + 1}`) === profile.columns[i])
  );
}

/** Read every data row of `text` with `profile`. Rows that can't be read say why (`error`). */
export function applyProfile(text: string, profile: CsvProfile): Row[] {
  const { rows } = parseCsv(text, profile.delimiter);
  const start = profile.skip + (profile.header ? 1 : 0);
  const cell = (row: string[], i: number | null) => (i === null ? "" : (row[i] ?? ""));

  return rows.slice(start).map((row, i) => {
    const line = start + i + 1;
    const date = parseDate(cell(row, profile.date.column), profile.date.format);
    const amount = readAmount(row, profile.amount);
    const description = cell(row, profile.description);
    const error =
      row.length !== profile.columns.length
        ? `expected ${profile.columns.length} columns, found ${row.length}`
        : !date
          ? `"${cell(row, profile.date.column)}" isn't a ${profile.date.format} date`
          : amount === null
            ? "no amount"
            : null;
    return {
      line,
      date,
      amount,
      description,
      payee: cell(row, profile.payee) || null,
      id: cell(row, profile.id) || null,
      balance: profile.balance === null ? null : parseAmount(cell(row, profile.balance)),
      error,
    };
  });
}

function readAmount(row: string[], amount: AmountColumns): string | null {
  if (amount.kind === "signed") {
    const value = parseAmount(row[amount.column] ?? "");
    if (value === null) return null;
    return amount.negate ? negate(value) : value;
  }
  const debit = parseAmount(row[amount.debit] ?? "");
  const credit = parseAmount(row[amount.credit] ?? "");
  if (debit === null && credit === null) return null;
  // Withdrawals sometimes come signed already; either way they take money out.
  const out = debit === null ? null : debit.replace(/^-/, "");
  const into = credit === null ? null : credit.replace(/^-/, "");
  if (out !== null && !isZero(out)) return negate(out);
  return into ?? (out !== null ? out : null);
}

function negate(value: string): string {
  if (isZero(value)) return value;
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

function isZero(value: string): boolean {
  return /^-?0+(\.0+)?$/.test(value);
}

function mostCommon(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
}

/**
 * A lender's amortization schedule as a CSV: its columns guessed from their headers (and
 * changeable), then read into a table's rows. Shared so it can be tested; the PWA reads the file.
 */
import {
  detectDateFormat,
  parseAmount,
  parseCsv,
  parseDate,
  type DateFormat,
} from "@luminous-money/csv-import";

import { cents, money, type LoanRow } from "./loans.js";

export const LOAN_COLUMNS = [
  "number",
  "date",
  "principal",
  "interest",
  "escrow",
  "balance",
] as const;
export type LoanColumn = (typeof LOAN_COLUMNS)[number];

/** Which column (by index) holds each field; null where none does. */
export type LoanCsvMapping = Record<LoanColumn, number | null>;

const GUESSES: [LoanColumn, RegExp][] = [
  ["principal", /princ/i],
  ["interest", /interest|int\b/i],
  ["escrow", /escrow|tax|insur|other/i],
  ["balance", /balance|remaining|owed|outstanding|ending/i],
  ["date", /date|due|month/i],
  ["number", /^(#|no\.?|num(ber)?|pmt\s*(#|no)|payment\s*(#|no\.?|number)|period|installment)$/i],
];

/** A schedule's header row and data rows, and its columns guessed from the headers. */
export function readLoanCsv(text: string): {
  headers: string[];
  data: string[][];
  mapping: LoanCsvMapping;
} {
  const { rows } = parseCsv(text);
  // The header is the first row with a principal or interest heading (a title may come first).
  const at = Math.max(
    0,
    rows.findIndex((r) => r.some((c) => /princ|interest/i.test(c)))
  );
  const headers = rows[at] ?? [];
  const mapping = Object.fromEntries(LOAN_COLUMNS.map((c) => [c, null])) as LoanCsvMapping;
  const used = new Set<number>();
  for (const [column, pattern] of GUESSES) {
    const i = headers.findIndex((h, i) => !used.has(i) && pattern.test(h));
    if (i >= 0) {
      mapping[column] = i;
      used.add(i);
    }
  }
  return { headers, data: rows.slice(at + 1), mapping };
}

const MONTH = /^(\d{1,2})\/(\d{4})$|^(\d{4})-(\d{1,2})$/;

/** "08/2016" or "2016-08" as that month's `day`. */
function monthDate(cell: string, day: number): string | null {
  const m = MONTH.exec(cell.trim());
  if (!m) return null;
  const [year, month] = m[1] ? [Number(m[2]), Number(m[1])] : [Number(m[3]), Number(m[4])];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(day, last))).toISOString().slice(0, 10);
}

/**
 * The rows a mapping reads, skipping lines that aren't payments (no principal, interest and
 * balance: totals, notes, blanks). Dates are read in the format the column is in; a column of
 * months ("08/2016") falls on `day`. Escrow is each row's, if mapped.
 */
export function loanCsvRows(
  data: string[][],
  mapping: LoanCsvMapping,
  day = 1
): { rows: LoanRow[]; escrow: string[]; problem: string | null } {
  const { date: dateAt, principal, interest, balance } = mapping;
  if (principal === null || interest === null || balance === null)
    return { rows: [], escrow: [], problem: "Choose the principal, interest and balance columns" };
  if (dateAt === null) return { rows: [], escrow: [], problem: "Choose the date column" };
  const payments = data.filter((r) =>
    [principal, interest, balance].every((i) => parseAmount(r[i] ?? "") !== null)
  );
  const cells = payments.map((r) => r[dateAt] ?? "");
  const format: DateFormat | null = detectDateFormat(cells, 0.9);
  const rows: LoanRow[] = [];
  const escrow: string[] = [];
  for (const [i, r] of payments.entries()) {
    const cell = r[dateAt] ?? "";
    const date = (format && parseDate(cell, format)) ?? monthDate(cell, day);
    if (!date)
      return { rows: [], escrow: [], problem: `Row ${i + 1}'s date doesn't read: ${cell}` };
    const number = mapping.number === null ? NaN : Number(r[mapping.number]);
    const amount = (at: number) => money(cents(parseAmount(r[at] ?? "")!));
    rows.push({
      number: Number.isInteger(number) ? number : i + 1,
      date,
      principal: amount(principal),
      interest: amount(interest),
      balance: amount(balance),
    });
    if (mapping.escrow !== null) {
      const e = parseAmount(r[mapping.escrow] ?? "");
      if (e && cents(e) > 0n) escrow.push(money(cents(e)));
    }
  }
  if (!rows.length) return { rows, escrow, problem: "No payments were found under those columns" };
  return { rows, escrow, problem: null };
}

/** The most usual of some amounts, if any. */
export function usual(amounts: string[]): string | null {
  const counts = new Map<string, number>();
  for (const a of amounts) counts.set(a, (counts.get(a) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

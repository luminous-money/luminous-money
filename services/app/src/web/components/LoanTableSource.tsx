import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import {
  loanCsvRows,
  LOAN_COLUMNS,
  readLoanCsv,
  usual,
  type LoanColumn,
  type LoanCsvMapping,
} from "../../shared/loan-csv.js";
import {
  cents,
  importedTable,
  money,
  paymentFor,
  rowProblems,
  tableStarts,
  termsProblem,
  termsTable,
  type LoanRead,
  type LoanRow,
  type LoanTable,
} from "../../shared/loans.js";
import { appApi } from "../lib/appApi.js";
import { formatDay } from "../lib/format.js";
import { explain, useAiSettings } from "../lib/queries.js";
import { RowsTable, usd } from "./Loans.js";

type Source = "terms" | "csv" | "ai";

const COLUMN_LABELS: Record<LoanColumn, string> = {
  number: "Payment number",
  date: "Due date",
  principal: "Principal",
  interest: "Interest",
  escrow: "Escrow",
  balance: "Owed after",
};

/** What a schedule showed beyond its rows: the lender, and its usual escrow. */
export type TableExtras = { lender: string | null; escrow: string | null; from: string | null };

/**
 * Where a loan's table comes from: worked out from terms, a lender's CSV (its columns guessed,
 * and changeable), or a PDF or image the book's AI reads. Says what it makes (`onChange`, null
 * until there's a table that adds up), and what else the schedule showed (`onExtras`).
 * `starting` prefills the terms (a new table from a date starts from what's owed then).
 */
export function LoanTableSource({
  book,
  currency,
  onChange,
  onExtras,
  starting,
}: {
  book: string;
  currency: string;
  onChange: (table: LoanTable | null) => void;
  onExtras?: (extras: TableExtras) => void;
  starting?: { amount?: string; first?: string; rate?: string };
}) {
  const ai = useAiSettings(book);
  const [source, setSource] = useState<Source>("terms");
  const [amount, setAmount] = useState(starting?.amount ?? "");
  const [rate, setRate] = useState(starting?.rate ?? "");
  const [payments, setPayments] = useState("360");
  const [first, setFirst] = useState(starting?.first ?? "");
  const [payment, setPayment] = useState("");
  const [csv, setCsv] = useState<{ headers: string[]; data: string[][] } | null>(null);
  const [mapping, setMapping] = useState<LoanCsvMapping | null>(null);
  const [read, setRead] = useState<LoanRead | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const csvRead = useMemo(
    () => (csv && mapping ? loanCsvRows(csv.data, mapping) : null),
    [csv, mapping]
  );
  const built: { table: LoanTable | null; problem: string | null } = useMemo(() => {
    if (source === "terms") {
      if (!amount || !rate || !first) return { table: null, problem: null };
      const terms = {
        amount: amount.replace(/[$,]/g, ""),
        rate: rate.replace(/%/g, "").trim(),
        payments: Number(payments),
        first,
        payment: payment.trim() ? payment.replace(/[$,]/g, "") : null,
      };
      const problem = termsProblem(terms);
      return problem ? { table: null, problem } : { table: termsTable(terms), problem: null };
    }
    if (source === "csv" && csvRead?.problem) return { table: null, problem: csvRead.problem };
    const rows: LoanRow[] | null =
      source === "csv" ? (csvRead?.rows ?? null) : (read?.rows ?? null);
    if (!rows?.length) return { table: null, problem: null };
    const problems = rowProblems(rows);
    if (problems.length)
      return {
        table: null,
        problem: `Payment ${problems[0]!.number} doesn't add up: ${problems[0]!.problem}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`,
      };
    return { table: importedTable(rows, source), problem: null };
  }, [source, amount, rate, payments, first, payment, csvRead, read]);
  const table = built.table;

  useEffect(() => onChange(table), [table]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (file: File) => {
    setReadError(null);
    if (source === "csv") {
      const { headers, data, mapping } = readLoanCsv(await file.text());
      setCsv({ headers, data });
      setMapping(mapping);
      const found = loanCsvRows(data, mapping);
      onExtras?.({ lender: null, escrow: usual(found.escrow), from: found.rows[0]?.date ?? null });
      return;
    }
    setReading(true);
    try {
      const result = await appApi.readLoanTable(book, file, file.name);
      setRead(result);
      onExtras?.({
        lender: result.lender,
        escrow: result.escrow,
        from: result.rows[0]?.date ?? null,
      });
    } catch (e) {
      setReadError(explain(e));
    } finally {
      setReading(false);
    }
  };

  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Where the table comes from">
        {(
          [
            ["terms", "Work it out"],
            ["csv", "Import a CSV"],
            ["ai", "Read a PDF or image"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={source === value}
            className={source === value ? "on" : ""}
            onClick={() => setSource(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {source === "terms" && (
        <>
          <div className="pair">
            <label>
              {starting?.amount ? "Owed" : "Borrowed"}
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="300000.00"
              />
            </label>
            <label>
              Rate (% a year)
              <input
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="3.75"
              />
            </label>
          </div>
          <div className="pair">
            <label>
              Monthly payments
              <input
                inputMode="numeric"
                value={payments}
                onChange={(e) => setPayments(e.target.value)}
              />
              <span className="small muted">30 years is 360; 15 is 180</span>
            </label>
            <label>
              First payment
              <input type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
            </label>
          </div>
          <label>
            Principal and interest each month <span className="muted">(optional)</span>
            <input
              inputMode="decimal"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              placeholder={
                amount && rate && Number(payments) > 0
                  ? paymentFor(
                      amount.replace(/[$,]/g, ""),
                      rate.replace(/%/g, ""),
                      Number(payments)
                    )
                  : "Worked out"
              }
            />
            <span className="small muted">If the lender&apos;s differs by a cent, type it.</span>
          </label>
        </>
      )}

      {source !== "terms" && (
        <label>
          {source === "csv" ? "The lender's schedule, as a CSV" : "The lender's schedule"}
          <input
            type="file"
            accept={source === "csv" ? ".csv,text/csv" : "application/pdf,image/*,.heic,.heif"}
            disabled={reading || (source === "ai" && !ai.data?.ready)}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void pick(file);
            }}
          />
          {source === "ai" && ai.data && !ai.data.ready && (
            <span className="small muted">
              Reading it needs the book&apos;s AI: <Link href={`/books/${book}/ai`}>set it up</Link>
              .
            </span>
          )}
        </label>
      )}
      {reading && (
        <p className="muted" aria-live="polite">
          Reading the schedule… a long one can take a few minutes.
        </p>
      )}
      {readError && <p className="error">{readError}</p>}
      {source === "ai" && read?.note && <p className="small muted">The AI says: {read.note}</p>}

      {source === "csv" && csv && mapping && (
        <div className="loan-columns">
          {LOAN_COLUMNS.map((column) => (
            <label key={column}>
              {COLUMN_LABELS[column]}
              <select
                value={mapping[column] ?? ""}
                onChange={(e) =>
                  setMapping({
                    ...mapping,
                    [column]: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              >
                <option value="">None</option>
                {csv.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `Column ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      {built.problem && <p className="error">{built.problem}</p>}
      {table && (
        <div className="loan-preview" aria-live="polite">
          <p>
            {table.rows.length} payments of {usd(table.payment, currency)} at {table.rate}%, from{" "}
            {formatDay(table.rows[0]!.date)} to {formatDay(table.rows.at(-1)!.date)}.{" "}
            {starting?.amount ? "Owed" : "Borrowed"} {usd(tableStarts(table), currency)}; interest
            in all{" "}
            {usd(money(table.rows.reduce((sum, r) => sum + cents(r.interest), 0n)), currency)}.
          </p>
          <RowsTable rows={table.rows} currency={currency} />
        </div>
      )}
    </>
  );
}

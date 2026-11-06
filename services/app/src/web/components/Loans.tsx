import type { Account } from "@luminous-money/ledger-client";
import { useState, type ComponentProps } from "react";

import { cents, money, type LoanRow, type Payment } from "../../shared/loans.js";
import { formatMoney } from "../lib/decimal.js";
import { formatFullDay, formatMonth } from "../lib/format.js";
import { AccountPicker, type AccountCreation } from "./AccountPicker.js";

/** Amounts in the loan's currency. */
export const usd = (n: string, currency = "USD") => formatMoney(n, currency);

/** A date as a month: "Jul 2046". */
export const monthOf = formatMonth;

/** Leaves that can take postings (archived ones aside), under the given roots. */
export function leavesUnder(accounts: Account[] | undefined, roots: string[]): string[] {
  return (accounts ?? [])
    .filter(
      (a) =>
        a.kind === "leaf" &&
        !a.implicit &&
        !a.close &&
        roots.some((r) => a.name.startsWith(`${r}:`))
    )
    .map((a) => a.name);
}

/**
 * "Create account" that makes nothing: the name is only picked, and opened by Confirm. A name
 * that isn't in the chart is a new account.
 */
export const planned = (chart: Account[]): AccountCreation => ({
  accounts: chart,
  submit: async (name) => ({ name, kind: "leaf", implicit: false }) as Account,
});

/** Whether a name is in the chart already (not one Confirm will open). */
export const inChart = (chart: Account[], name: string) =>
  chart.some((a) => a.name === name && !a.implicit);

/** An account picker with its label shown above it, as the app's forms have them. */
export function PickerField(props: ComponentProps<typeof AccountPicker>) {
  return (
    <div className="picker-field">
      <span className="small muted">{props.label}</span>
      <AccountPicker {...props} />
    </div>
  );
}

const SHOWN = 12;

/** A table's rows (as a lender's), the first year and "Show all". */
export function RowsTable({ rows, currency }: { rows: LoanRow[]; currency: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <>
      <div className="loan-table-wrap">
        <table className="loan-table" aria-label="Payments">
          <thead>
            <tr>
              <th>#</th>
              <th>Due</th>
              <th className="num">Principal</th>
              <th className="num">Interest</th>
              <th className="num">Owed after</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.number}>
                <td>{r.number}</td>
                <td className="due">{formatFullDay(r.date)}</td>
                <td className="num">{usd(r.principal, currency)}</td>
                <td className="num">{usd(r.interest, currency)}</td>
                <td className="num">{usd(r.balance, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN && (
        <button type="button" className="link-button" onClick={() => setAll((a) => !a)}>
          {all ? "Show the first year" : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

/** Payments worked out (what's ahead), each with its parts. */
export function PaymentsTable({
  payments,
  currency,
  label = "Payments ahead",
}: {
  payments: Payment[];
  currency: string;
  label?: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? payments : payments.slice(0, SHOWN);
  const others = payments.some((p) => p.others.length || cents(p.extra) > 0n);
  return (
    <>
      <div className="loan-table-wrap">
        <table className="loan-table" aria-label={label}>
          <thead>
            <tr>
              <th>Due</th>
              <th className="num">Principal</th>
              <th className="num">Interest</th>
              {others && <th className="num">Other</th>}
              <th className="num">Paid</th>
              <th className="num">Owed after</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.nominal}>
                <td className="due">{formatFullDay(p.nominal)}</td>
                <td className="num">{usd(money(cents(p.principal) + cents(p.extra)), currency)}</td>
                <td className="num">{usd(p.interest, currency)}</td>
                {others && (
                  <td className="num">
                    {usd(money(p.others.reduce((sum, o) => sum + cents(o.amount), 0n)), currency)}
                  </td>
                )}
                <td className="num">{usd(p.total, currency)}</td>
                <td className="num">{usd(p.owed_after, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {payments.length > SHOWN && (
        <button type="button" className="link-button" onClick={() => setAll((a) => !a)}>
          {all ? "Show the next year" : `Show all ${payments.length}`}
        </button>
      )}
    </>
  );
}

/** A payment's parts in words: "$451.85 principal, $937.50 interest, $450.00 escrow". */
export function paymentParts(p: Payment, currency: string): string {
  return [
    `${usd(money(cents(p.principal) + cents(p.extra)), currency)} principal${cents(p.extra) > 0n ? ` (${usd(p.extra, currency)} extra)` : ""}`,
    `${usd(p.interest, currency)} interest`,
    // An initialism (PMI) stays as it's written; a word reads as one ("escrow").
    ...p.others.map(
      (o) =>
        `${usd(o.amount, currency)} ${o.name === o.name.toUpperCase() ? o.name : o.name.toLowerCase()}`
    ),
  ].join(", ");
}

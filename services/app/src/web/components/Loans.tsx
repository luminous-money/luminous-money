import type { Account } from "@luminous-money/ledger-client";
import { useState, type ComponentProps } from "react";

import { cents, money, type LoanOther, type LoanRow, type Payment } from "../../shared/loans.js";
import { formatMoney } from "../lib/decimal.js";
import { AccountPicker, type AccountCreation } from "./AccountPicker.js";

/** Amounts in the loan's currency. */
export const usd = (n: string, currency = "USD") => formatMoney(n, currency);

/** A date as a month: "Jul 2046". */
export const monthOf = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
    new Date(`${iso}T00:00:00Z`)
  );

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
                <td className="due">{monthOf(r.date)}</td>
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
                <td className="due">{monthOf(p.nominal)}</td>
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
    ...p.others.map((o) => `${usd(o.amount, currency)} ${o.name.toLowerCase()}`),
  ].join(", ");
}

/** Where a new escrow account goes for a loan: `Assets:Escrow:<its name>`. */
export const escrowAccount = (loan: string) =>
  `Assets:Escrow:${loan.trim().replace(/\s+/g, "-") || "Loan"}`;

/**
 * The parts of a payment beyond principal and interest (escrow, PMI, fees): each a name, an
 * account and an amount. `from` is when they start; changing one later is a dated change, made
 * on the loan's page.
 */
export function OthersFieldset({
  others,
  onChange,
  accounts,
  create,
  from,
  loanName,
}: {
  others: LoanOther[];
  onChange: (others: LoanOther[]) => void;
  accounts: Account[] | undefined;
  create?: AccountCreation;
  from: string;
  loanName: string;
}) {
  const names = leavesUnder(accounts, ["Assets", "Expenses", "Liabilities"]);
  const set = (i: number, patch: Partial<LoanOther>) =>
    onChange(others.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const add = (name: string, account: string) =>
    onChange([...others, { name, account, amount: "", from }]);
  return (
    <fieldset className="loan-others">
      <legend>Paid with it</legend>
      <p className="muted small">
        Beyond principal and interest: escrow (the taxes and insurance the lender pays for you),
        PMI, a fee. Each goes to an account of its own.
      </p>
      {others.map((o, i) => (
        <div className="loan-other" key={i}>
          <div className="pair">
            <label>
              Name
              <input value={o.name} onChange={(e) => set(i, { name: e.target.value })} />
            </label>
            <label>
              Amount
              <input
                inputMode="decimal"
                value={o.amount}
                onChange={(e) => set(i, { amount: e.target.value.trim() })}
                placeholder="450.00"
              />
            </label>
          </div>
          <PickerField
            label={`${o.name || "It"} goes to`}
            accounts={names}
            value={o.account}
            onChange={(account) => set(i, { account })}
            prefer={["Assets", "Expenses"]}
            {...(create ? { create } : {})}
          />
          <button
            type="button"
            className="link-button"
            onClick={() => onChange(others.filter((_, j) => j !== i))}
          >
            Remove {o.name || "it"}
          </button>
        </div>
      ))}
      <div className="actions">
        {!others.some((o) => /escrow/i.test(o.name)) && (
          <button type="button" onClick={() => add("Escrow", escrowAccount(loanName))}>
            + Escrow
          </button>
        )}
        {!others.some((o) => /pmi/i.test(o.name)) && (
          <button type="button" onClick={() => add("PMI", "")}>
            + PMI
          </button>
        )}
        <button type="button" onClick={() => add("", "")}>
          + Other
        </button>
      </div>
    </fieldset>
  );
}

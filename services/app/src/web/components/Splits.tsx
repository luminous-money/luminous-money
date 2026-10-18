import type { Posting } from "@fava-beans/ledger-client";
import { useEffect, useState } from "react";

import { formatMoney, isDecimal } from "../lib/decimal.js";
import { checkBalance, unresolved } from "../lib/split.js";
import { AccountPicker, type AccountCreation } from "./AccountPicker.js";

/** A posting being edited. The amount stays a raw string until it's valid; anything the form
 * doesn't edit (cost, price, flag, metadata) rides along untouched in `original`. */
type Row = {
  key: number;
  account: string;
  number: string;
  currency: string;
  /** A schedule's match tolerance for the split (see `SplitsFieldset`'s `tolerances`). */
  tolerance: string;
  original: Partial<Posting>;
};

/** A posting, with a schedule's match tolerance if it has one. */
type Split = Posting & { tolerance?: string | null };

let nextKey = 0;

/** Blank amounts get the transaction's currency, so typing a number into one just works. */
function toRows(postings: Split[], currency: string): Row[] {
  return postings.map(({ tolerance, ...p }) => ({
    key: nextKey++,
    account: p.account,
    number: p.units?.number ?? "",
    currency: p.units?.currency ?? currency,
    tolerance: tolerance ?? "",
    original: p,
  }));
}

function toPostings(rows: Row[]): Split[] {
  return rows.map((r) => ({
    ...r.original,
    account: r.account,
    units: r.number.trim() ? { number: r.number.trim(), currency: r.currency.trim() } : null,
    ...(r.tolerance.trim() ? { tolerance: r.tolerance.trim() } : {}),
  }));
}

/** A transaction's splits being edited: the rows, the postings they make, and whether they
 * balance. Reset whenever `postings` changes (a saved or refreshed transaction). */
export function useSplits(postings: Split[], currency: string) {
  const [rows, setRows] = useState(() => toRows(postings, currency));
  useEffect(() => setRows(toRows(postings, currency)), [postings, currency]);
  const badAmount = rows.some(
    (r) => r.number.trim() && (!isDecimal(r.number.trim()) || !r.currency.trim())
  );
  const badTolerance = rows.some(
    (r) => r.tolerance.trim() && !/^\d+(\.\d+)?$/.test(r.tolerance.trim())
  );
  const edited = toPostings(rows);
  const balance = badAmount
    ? ({
        state: "invalid",
        message: "Amounts must be numbers like 12.50, with a currency",
      } as const)
    : badTolerance
      ? ({ state: "invalid", message: "A match tolerance is an amount, like 25.00" } as const)
      : checkBalance(edited);
  return {
    rows,
    setRows,
    currency,
    postings: edited,
    balance,
    unresolved: rows.some((r) => unresolved(r.account)),
  };
}

export type Splits = ReturnType<typeof useSplits>;

/** The splits editor: an account and amount per split, add and remove, and the balance. */
export function SplitsFieldset({
  splits,
  accounts,
  create,
  tolerances = false,
}: {
  splits: Splits;
  /** Accounts the splits can use. */
  accounts: string[];
  create?: AccountCreation;
  /** Edit each split's match tolerance (schedules): how far a bank's amount may be from it, either
   * way, and still match. */
  tolerances?: boolean;
}) {
  const { rows, setRows, currency, balance } = splits;
  const update = (key: number, change: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <fieldset className="postings">
      <legend>Splits</legend>
      {rows.map((r) => (
        <div className="posting" key={r.key}>
          <AccountPicker
            label="Account"
            accounts={accounts}
            value={unresolved(r.account) ? "" : r.account}
            create={create}
            onChange={(account) => update(r.key, { account })}
          />
          <div className="posting-amount">
            <input
              aria-label="Amount"
              inputMode="decimal"
              placeholder="auto"
              value={r.number}
              onChange={(e) => update(r.key, { number: e.target.value })}
            />
            <input
              aria-label="Currency"
              className="currency"
              value={r.currency}
              placeholder={currency}
              onChange={(e) => update(r.key, { currency: e.target.value.toUpperCase() })}
            />
            <button
              type="button"
              aria-label="Remove split"
              className="icon"
              disabled={rows.length <= 1}
              onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
            >
              ×
            </button>
          </div>
          {tolerances && r.number.trim() && (
            <label className="tolerance small">
              Match within ±
              <input
                aria-label="Match tolerance"
                inputMode="decimal"
                placeholder="0.00"
                value={r.tolerance}
                onChange={(e) => update(r.key, { tolerance: e.target.value })}
              />
            </label>
          )}
          {(r.original.cost || r.original.price) && (
            <p className="muted small">
              Has a {r.original.cost ? "cost basis" : "price"}; kept as is.
            </p>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setRows((all) => [
            ...all,
            { key: nextKey++, account: "", number: "", currency, tolerance: "", original: {} },
          ])
        }
      >
        + Add split
      </button>
      <p className={`balance ${balance.state}`} aria-live="polite">
        {balance.state === "invalid" && balance.message}
        {balance.state === "deferred" && "Lots and prices are checked by the ledger on save."}
        {balance.state === "balanced" &&
          (balance.auto.length
            ? `Balanced. The blank amount will be ${balance.auto.map((a) => formatMoney(a.number, a.currency)).join(", ")}.`
            : "Balanced.")}
      </p>
      <p className="muted small">Leave one amount blank to balance automatically.</p>
    </fieldset>
  );
}

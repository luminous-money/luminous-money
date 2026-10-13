import type { Posting } from "@fava-beans/ledger-client";
import { useEffect, useState } from "react";

import { formatMoney, isDecimal } from "../lib/decimal.js";
import { checkBalance, UNCATEGORIZED } from "../lib/split.js";
import { AccountPicker, type AccountCreation } from "./AccountPicker.js";

/** A posting being edited. The amount stays a raw string until it's valid; anything the form
 * doesn't edit (cost, price, flag, metadata) rides along untouched in `original`. */
type Row = {
  key: number;
  account: string;
  number: string;
  currency: string;
  original: Partial<Posting>;
};

let nextKey = 0;

/** Blank amounts get the transaction's currency, so typing a number into one just works. */
function toRows(postings: Posting[], currency: string): Row[] {
  return postings.map((p) => ({
    key: nextKey++,
    account: p.account,
    number: p.units?.number ?? "",
    currency: p.units?.currency ?? currency,
    original: p,
  }));
}

function toPostings(rows: Row[]): Posting[] {
  return rows.map((r) => ({
    ...r.original,
    account: r.account,
    units: r.number.trim() ? { number: r.number.trim(), currency: r.currency.trim() } : null,
  }));
}

/** A transaction's splits being edited: the rows, the postings they make, and whether they
 * balance. Reset whenever `postings` changes (a saved or refreshed transaction). */
export function useSplits(postings: Posting[], currency: string) {
  const [rows, setRows] = useState(() => toRows(postings, currency));
  useEffect(() => setRows(toRows(postings, currency)), [postings, currency]);
  const badAmount = rows.some(
    (r) => r.number.trim() && (!isDecimal(r.number.trim()) || !r.currency.trim())
  );
  const edited = toPostings(rows);
  const balance = badAmount
    ? ({
        state: "invalid",
        message: "Amounts must be numbers like 12.50, with a currency",
      } as const)
    : checkBalance(edited);
  return {
    rows,
    setRows,
    currency,
    postings: edited,
    balance,
    uncategorized: rows.some((r) => r.account === UNCATEGORIZED),
  };
}

export type Splits = ReturnType<typeof useSplits>;

/** The splits editor: an account and amount per split, add and remove, and the balance. */
export function SplitsFieldset({
  splits,
  accounts,
  create,
}: {
  splits: Splits;
  /** Accounts the splits can use. */
  accounts: string[];
  create?: AccountCreation;
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
            value={r.account === UNCATEGORIZED ? "" : r.account}
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
            { key: nextKey++, account: "", number: "", currency, original: {} },
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

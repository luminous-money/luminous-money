import type { AccountSummary, Holding } from "@luminous-money/ledger-client";
import { useState } from "react";
import { Link } from "wouter";

import { formatMoney, isDecimal, isNegative } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import { withBack } from "../lib/navigation.js";
import { explain, useAddPrice, useHoldings, useRevalue } from "../lib/queries.js";

/**
 * An account's holdings, above its ledger: per commodity, units, the latest price and its date
 * (stale ones marked), value, and unrealized gain. Tapping one shows its lots and "Update
 * price". A revalued asset (a house, a car) gets "Update value" instead. And a way to trade.
 */
export function HoldingsPanel({
  book,
  account,
  summary,
  here,
}: {
  book: string;
  account: string;
  summary: AccountSummary;
  here: string;
}) {
  const priced = summary.balance.some((b) => b.currency !== summary.value?.currency);
  const holdings = useHoldings(book, account, priced);
  const [open, setOpen] = useState<string | null>(null);

  if (summary.revalue_every) return <RevalueForm book={book} account={account} summary={summary} />;
  if (!priced) return null;

  return (
    <section className="card holdings" aria-label="Holdings">
      <div className="holdings-head">
        <h2 className="section-title">Holdings</h2>
        <Link
          href={withBack(`/books/${book}/accounts/${encodeURIComponent(account)}/trade`, here)}
          className="button"
        >
          Trade
        </Link>
      </div>
      {holdings.isPending && <p className="muted">Loading…</p>}
      {holdings.error && <p className="error">{explain(holdings.error)}</p>}
      <ul className="holding-list">
        {holdings.data?.holdings.map((h) => (
          <li key={h.commodity}>
            <button
              type="button"
              className="holding-row"
              aria-expanded={open === h.commodity}
              onClick={() => setOpen(open === h.commodity ? null : h.commodity)}
            >
              <span>
                <strong>{h.commodity === holdings.data.currency ? "Cash" : h.commodity}</strong>
                {h.name && <span className="muted small"> {h.name}</span>}
                <span className="muted small block">
                  {h.commodity === holdings.data.currency
                    ? ""
                    : `${h.units} × ${h.price ? formatMoney(h.price.number, h.price.currency) : "no price"}`}
                  {h.price_date && h.price_date !== today() && ` · ${h.price_date}`}
                  {h.stale && <span className="pill stale"> stale</span>}
                </span>
              </span>
              <span className="num">
                {h.value ? formatMoney(h.value.number, h.value.currency) : "?"}
                {h.gain && (
                  <span
                    className={`small block amount ${isNegative(h.gain.number) ? "out" : "in"}`}
                  >
                    {isNegative(h.gain.number) ? "" : "+"}
                    {formatMoney(h.gain.number, h.gain.currency)}
                  </span>
                )}
              </span>
            </button>
            {open === h.commodity && h.commodity !== holdings.data.currency && (
              <HoldingDetail book={book} holding={h} currency={holdings.data.currency} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HoldingDetail({
  book,
  holding,
  currency,
}: {
  book: string;
  holding: Holding;
  currency: string;
}) {
  const add = useAddPrice(book);
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState("");
  return (
    <div className="holding-detail">
      {holding.cost && (
        <p className="small muted">
          Cost basis {formatMoney(holding.cost.number, holding.cost.currency)}
        </p>
      )}
      {holding.lots.length > 0 && (
        <ol className="lots" aria-label={`${holding.commodity} lots`}>
          {holding.lots.map((lot, i) => (
            <li key={i} className="small">
              {lot.units} at {formatMoney(lot.cost.number, lot.cost.currency)}
              {lot.date && ` · bought ${lot.date}`}
              {lot.label && <span className="muted"> ({lot.label})</span>}
            </li>
          ))}
        </ol>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (isDecimal(price.trim()))
            add.mutate(
              { date, commodity: holding.commodity, price: { number: price.trim(), currency } },
              { onSuccess: () => setPrice("") }
            );
        }}
      >
        <label>
          Price on
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Price per unit ({currency})
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <button type="submit" disabled={!isDecimal(price.trim()) || add.isPending}>
          Update price
        </button>
      </form>
      {add.error && <p className="error">{explain(add.error)}</p>}
    </div>
  );
}

/** A revalued asset's value, and "Update value": records the change against unrealized gains. */
function RevalueForm({
  book,
  account,
  summary,
}: {
  book: string;
  account: string;
  summary: AccountSummary;
}) {
  const revalue = useRevalue(book, account);
  const currency = summary.balance[0]?.currency ?? summary.value?.currency ?? "USD";
  const [date, setDate] = useState(today());
  const [value, setValue] = useState("");
  return (
    <section className="card holdings" aria-label="Value">
      <h2 className="section-title">Value</h2>
      <p className="small muted">
        Revalued every {summary.revalue_every} days.{" "}
        {summary.revalued_on ? `Last valued ${summary.revalued_on}.` : "Never valued."}
        {summary.stale && <span className="pill stale"> Needs a new value</span>}
      </p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (isDecimal(value.trim()))
            revalue.mutate(
              { date, value: { number: value.trim(), currency } },
              { onSuccess: () => setValue("") }
            );
        }}
      >
        <label>
          Value on
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Value ({currency})
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button type="submit" disabled={!isDecimal(value.trim()) || revalue.isPending}>
          Update value
        </button>
      </form>
      <p className="small muted">The change is recorded against Income:Unrealized-Gains.</p>
      {revalue.error && <p className="error">{explain(revalue.error)}</p>}
    </section>
  );
}

import type { TradeIn, TradePreview } from "@fava-beans/ledger-client";
import { useState } from "react";
import { Link, useLocation } from "wouter";

import { displayName } from "../lib/accounts.js";
import { formatMoney, isDecimal } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import { api } from "../lib/ledger.js";
import { useBack } from "../lib/navigation.js";
import { explain, useHoldings, useSummary, useTrade } from "../lib/queries.js";

type Kind = TradeIn["kind"];

/**
 * Record a trade in an account (or a brokerage: everything under it): a buy (a lot at cost), a
 * sale (the ledger picks lots by the account's method and splits the gain short- and long-term),
 * or a dividend (optionally reinvested). "Preview" shows what will be written; a sale lists the
 * lots it draws on. Accounts that sell specific lots ask which.
 */
export function TradePage({ book, account }: { book: string; account: string }) {
  const [, navigate] = useLocation();
  const back = useBack(`/books/${book}/accounts/${encodeURIComponent(account)}`);
  const summary = useSummary(book, [account]);
  const holdings = useHoldings(book, account);
  const trade = useTrade(book, account);
  const currency = holdings.data?.currency ?? "USD";
  const held = (holdings.data?.holdings ?? []).filter((h) => h.commodity !== currency);

  const [kind, setKind] = useState<Kind>("buy");
  const [date, setDate] = useState(today());
  const [commodity, setCommodity] = useState("");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("");
  const [amount, setAmount] = useState("");
  const [reinvest, setReinvest] = useState(false);
  const [lots, setLots] = useState<Record<string, string>>({});
  const [choosing, setChoosing] = useState(false);
  const [preview, setPreview] = useState<TradePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = commodity || (kind !== "buy" ? (held[0]?.commodity ?? "") : "");
  const lotsOf = held.find((h) => h.commodity === chosen)?.lots ?? [];
  const body: TradeIn = {
    kind,
    date,
    commodity: chosen.trim().toUpperCase(),
    units: kind === "dividend" ? (reinvest ? units.trim() : null) : units.trim(),
    price: kind === "dividend" && !reinvest ? null : price.trim(),
    amount: kind === "dividend" ? amount.trim() : null,
    fees: fees.trim() || null,
    lots: choosing
      ? lotsOf.flatMap((lot, i) =>
          Number(lots[i] || 0) > 0
            ? [{ date: lot.date!, cost: lot.cost.number, units: lots[i]! }]
            : []
        )
      : null,
    narration: null,
    cash_account: null,
    holding_account: null,
  };
  const numbers = [
    ...(kind === "dividend" ? [amount] : [units, price]),
    ...(kind === "dividend" && reinvest ? [units, price] : []),
  ];
  const ready =
    !!body.commodity &&
    numbers.every((n) => isDecimal(n.trim())) &&
    (!fees.trim() || isDecimal(fees.trim()));

  const run = async (save: boolean) => {
    setError(null);
    try {
      if (save) {
        await trade.mutateAsync(body);
        navigate(back);
      } else {
        setPreview(await api.previewTrade(book, account, body));
      }
    } catch (e) {
      const message = explain(e);
      if (/choose which/.test(message)) setChoosing(true);
      setError(message);
      setPreview(null);
    }
  };

  return (
    <main>
      <header className="page-head">
        <Link href={back} className="back">
          ‹ Back
        </Link>
        <h1>Trade</h1>
        <p className="muted">{displayName(summary.data?.[0] ?? { name: account })}</p>
      </header>

      <form className="editor" onSubmit={(e) => (e.preventDefault(), ready && void run(false))}>
        <div className="segmented" role="radiogroup" aria-label="Kind">
          {(["buy", "sell", "dividend"] as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? "on" : ""}
              onClick={() => (setKind(k), setPreview(null), setError(null), setCommodity(""))}
            >
              {k === "buy" ? "Buy" : k === "sell" ? "Sell" : "Dividend"}
            </button>
          ))}
        </div>

        <div className="pair">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {kind === "buy" ? (
            <label>
              Commodity (ticker)
              <input
                value={commodity}
                onChange={(e) => setCommodity(e.target.value.toUpperCase())}
                placeholder="e.g. VTI"
                autoCapitalize="characters"
              />
            </label>
          ) : (
            <label>
              Commodity
              <select
                aria-label="Commodity"
                value={chosen}
                onChange={(e) => setCommodity(e.target.value)}
              >
                {held.map((h) => (
                  <option key={h.commodity} value={h.commodity}>
                    {h.commodity} ({h.units})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {kind === "dividend" && (
          <>
            <label>
              Dividend ({currency})
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={reinvest}
                onChange={(e) => setReinvest(e.target.checked)}
              />
              Reinvested
            </label>
          </>
        )}
        {(kind !== "dividend" || reinvest) && (
          <div className="pair">
            <label>
              Units
              <input inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} />
            </label>
            <label>
              Price per unit ({currency})
              <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
          </div>
        )}
        {kind !== "dividend" && (
          <label>
            Fees ({currency}) <span className="muted">(optional)</span>
            <input inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
          </label>
        )}

        {kind === "sell" && choosing && (
          <fieldset className="rule">
            <legend>Lots to sell from</legend>
            {lotsOf.map((lot, i) => (
              <label key={i}>
                {lot.units} at {formatMoney(lot.cost.number, lot.cost.currency)}
                {lot.date && `, bought ${lot.date}`}
                <input
                  inputMode="decimal"
                  aria-label={`Units from the lot bought ${lot.date}`}
                  value={lots[i] ?? ""}
                  onChange={(e) => setLots({ ...lots, [i]: e.target.value })}
                />
              </label>
            ))}
          </fieldset>
        )}

        {error && <p className="error">{error}</p>}

        {preview && (
          <section className="card" aria-label="Preview">
            {preview.lots.length > 0 && (
              <>
                <h2 className="section-title">Lots it draws on</h2>
                <ol className="lots">
                  {preview.lots.map((lot, i) => (
                    <li key={i} className="small">
                      {lot.units} at {formatMoney(lot.cost.number, lot.cost.currency)}
                      {lot.date && `, bought ${lot.date}`}: {lot.term}-term{" "}
                      {Number(lot.gain.number) < 0 ? "loss" : "gain"}{" "}
                      {formatMoney(lot.gain.number, lot.gain.currency)}
                    </li>
                  ))}
                </ol>
              </>
            )}
            <h2 className="section-title">It will record</h2>
            <ul className="splits">
              {preview.transaction.postings.map((p, i) => (
                <li key={i} className="small">
                  {p.account}{" "}
                  <span className="num">
                    {p.units ? formatMoney(p.units.number, p.units.currency) : ""}
                    {p.cost?.number &&
                      ` at ${formatMoney(p.cost.number, p.cost.currency ?? currency)}`}
                  </span>
                </li>
              ))}
            </ul>
            {preview.opens.length > 0 && (
              <p className="small muted">Opens {preview.opens.join(", ")}.</p>
            )}
          </section>
        )}

        <div className="actions pinned">
          <Link href={back} className="button">
            Back
          </Link>
          <button type="submit" disabled={!ready}>
            Preview
          </button>
          <button
            type="button"
            className="primary"
            disabled={!ready || trade.isPending}
            onClick={() => void run(true)}
          >
            Save
          </button>
        </div>
      </form>
    </main>
  );
}

/**
 * A divided account's parts (M15): one real account held as several. The Parts card shows each
 * part's balance and share of the whole (the main part, where new money lands, marked), says
 * when one is below zero, and moves money between them: a confirmed transfer, which reconciles
 * itself since it never leaves the account.
 */
import { useState } from "react";
import { Link } from "wouter";

import { displayName, shown } from "../lib/accounts.js";
import { add, formatMoney, isDecimal, isNegative, negate } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import type { TreeAccount } from "../lib/ledger.js";
import { explain, useAccountTree, useCreateTransaction } from "../lib/queries.js";

type Type = TreeAccount["type"];

/** A part's balance in the whole's currency, stored sign. */
const balanceOf = (a: TreeAccount, currency: string) =>
  a.total.find((t) => t.currency === currency)?.number ?? "0";

/** The parts of a divided account: its open leaves. */
export const partsOf = (accounts: TreeAccount[], whole: string) =>
  accounts.filter(
    (a) => a.name.startsWith(`${whole}:`) && a.kind === "leaf" && !a.implicit && !a.close
  );

export function PartsCard({
  book,
  whole,
  accounts,
  currency,
}: {
  book: string;
  whole: TreeAccount;
  accounts: TreeAccount[];
  currency: string;
}) {
  const parts = partsOf(accounts, whole.name);
  const [moving, setMoving] = useState<{ from?: string; to?: string; amount?: string } | null>(
    null
  );
  const type = whole.type;
  const total = balanceOf(whole, currency);
  const money = (n: string) => formatMoney(shown(n, type), currency);
  const share = (n: string) => {
    const t = Number(shown(total, type));
    return t > 0 ? Math.max(0, Math.min(100, (Number(shown(n, type)) / t) * 100)) : 0;
  };
  const below = parts.filter((p) => isNegative(shown(balanceOf(p, currency), type)));
  const richest = [...parts].sort(
    (a, b) =>
      Number(shown(balanceOf(b, currency), type)) - Number(shown(balanceOf(a, currency), type))
  )[0];
  if (!parts.length) return null;
  return (
    <section className="card parts" aria-label="Parts">
      <h2 className="section-title">Parts</h2>
      <ul className="plain-list">
        {parts.map((p) => {
          const n = balanceOf(p, currency);
          return (
            <li key={p.name} className="part">
              <div className="row-between">
                <Link href={`/books/${book}/accounts/${encodeURIComponent(p.name)}`}>
                  {displayName(p)}
                </Link>
                <span className="amount">{money(n)}</span>
              </div>
              <span className="budget-bar" aria-hidden="true">
                <span style={{ width: `${share(n)}%` }} />
              </span>
              {p.name === whole.main_part && (
                <span className="small muted">New money lands here</span>
              )}
            </li>
          );
        })}
      </ul>
      {below.map((p) => (
        <p key={p.name} className="small error">
          {displayName(p)} is {money(negate(balanceOf(p, currency)))} below zero.{" "}
          {richest && richest.name !== p.name && (
            <button
              type="button"
              className="plain"
              onClick={() =>
                setMoving({
                  from: richest.name,
                  to: p.name,
                  amount: shown(negate(balanceOf(p, currency)), type),
                })
              }
            >
              Cover it from {displayName(richest)}
            </button>
          )}
        </p>
      ))}
      {moving ? (
        <MoveMoney
          key={JSON.stringify(moving)}
          book={book}
          parts={parts}
          type={type}
          currency={currency}
          start={moving}
          onDone={() => setMoving(null)}
        />
      ) : (
        parts.length > 1 && (
          <div className="actions">
            <button type="button" onClick={() => setMoving({})}>
              Move money
            </button>
          </div>
        )
      )}
    </section>
  );
}

/** Move money between parts: a confirmed transfer from one to another, on a date. */
export function MoveMoney({
  book,
  parts,
  type,
  currency,
  start = {},
  onDone,
}: {
  book: string;
  parts: TreeAccount[];
  type: Type;
  currency: string;
  start?: { from?: string; to?: string; amount?: string };
  onDone: () => void;
}) {
  const create = useCreateTransaction(book);
  const [from, setFrom] = useState(start.from ?? parts[0]?.name ?? "");
  const [to, setTo] = useState(start.to ?? parts.find((p) => p.name !== from)?.name ?? "");
  const [amount, setAmount] = useState(start.amount ?? "");
  const [date, setDate] = useState(today());
  const typed = amount.replace(/[$,\s]/g, "");
  const valid =
    from && to && from !== to && isDecimal(typed) && !isNegative(typed) && typed !== "0";
  const name = (n: string) => displayName(parts.find((p) => p.name === n) ?? { name: n });
  return (
    <form
      className="editor move-money"
      aria-label="Move money"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          {
            date,
            flag: "*",
            payee: null,
            narration: `Moved to ${name(to)}`,
            tags: [],
            links: [],
            meta: {},
            postings: [
              { account: from, units: { number: shown(negate(typed), type), currency } },
              { account: to, units: { number: shown(add(typed, "0"), type), currency } },
            ],
          },
          { onSuccess: onDone }
        );
      }}
    >
      <label>
        From
        <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
          {parts.map((p) => (
            <option key={p.name} value={p.name}>
              {displayName(p)}
            </option>
          ))}
        </select>
      </label>
      <label>
        To
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
          {parts.map((p) => (
            <option key={p.name} value={p.name}>
              {displayName(p)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amount
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          aria-label="Amount to move"
        />
      </label>
      <label>
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {create.error && <p className="error">{explain(create.error)}</p>}
      <div className="actions">
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!valid || create.isPending}>
          Move
        </button>
      </div>
    </form>
  );
}

/** A divided account's parts on its home card: a stacked line, and each part's balance. */
export function PartsLine({ book, whole }: { book: string; whole: string }) {
  const tree = useAccountTree(book);
  const account = tree.data?.find((a) => a.name === whole);
  if (!tree.data || !account) return null;
  const currency = account.total[0]?.currency ?? "USD";
  const parts = partsOf(tree.data, whole);
  const amounts = parts.map((p) => Number(shown(balanceOf(p, currency), account.type)));
  const sum = amounts.reduce((n, a) => n + Math.max(a, 0), 0);
  return (
    <div className="parts-line">
      <span className="stacked-bar" aria-hidden="true">
        {parts.map((p, i) => (
          <span
            key={p.name}
            className={`segment s${i % 4}`}
            style={{ width: `${sum > 0 ? (Math.max(amounts[i]!, 0) / sum) * 100 : 0}%` }}
          />
        ))}
      </span>
      <span className="small muted">
        {parts
          .map(
            (p) =>
              `${displayName(p)} ${formatMoney(shown(balanceOf(p, currency), account.type), currency)}`
          )
          .join(" · ")}
      </span>
    </div>
  );
}

import { useState } from "react";
import { Link } from "wouter";

import { UNALLOCATED } from "../../shared/funds.js";
import {
  HoldingsLine,
  MoveMoneyDialog,
  NewFundDialog,
  TargetProgress,
} from "../components/Funds.js";
import { add, formatMoney, isMoney, isNegative, negate } from "../lib/decimal.js";
import { formatDay } from "../lib/format.js";
import { explain, useCanManage, useCanWrite, useFunds } from "../lib/queries.js";

const money = (a: { number: string; currency: string }) => formatMoney(a.number, a.currency);

/**
 * Funds (Funds A, B): what the book's money is for. Net worth, what's in funds, and Unallocated
 * (the rest, the house and retirement included, and what it holds); each fund's balance (red
 * below zero), what it holds when that's more than money, description and progress toward its
 * target; Move money (write) and New fund (manage); archived funds folded away below. When funds
 * claim shares the accounts don't have, a warning that leads to Notifications. With none yet,
 * what funds are for and how to start.
 */
export function FundsPage({ book }: { book: string }) {
  const listing = useFunds(book);
  const canWrite = useCanWrite(book);
  const canManage = useCanManage(book);
  const [moving, setMoving] = useState(false);
  const [creating, setCreating] = useState(false);
  const data = listing.data;
  const active = data?.funds.filter((f) => !f.archived) ?? [];
  const archived = data?.funds.filter((f) => f.archived) ?? [];
  const href = (name: string) => `/books/${book}/funds/${encodeURIComponent(name)}`;
  // Funds claiming shares the accounts don't have: a sale nobody gave a fund to (Funds B).
  const over = (data?.unallocated_holdings ?? []).filter(
    (h) => !isMoney(h.amount.currency) && isNegative(h.amount.number)
  );

  return (
    <main>
      <header className="page-head home-head">
        <div>
          <h1>Funds</h1>
          <p className="muted">What your money is for</p>
        </div>
        <div className="actions">
          {canWrite && active.length > 0 && (
            <button type="button" onClick={() => setMoving(true)}>
              Move money
            </button>
          )}
          {canManage && (
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              New fund
            </button>
          )}
        </div>
      </header>

      {listing.isPending && <p className="muted">Loading…</p>}
      {listing.error && <p className="card error">{explain(listing.error)}</p>}

      {data && data.funds.length === 0 && (
        <section className="card funds-empty" aria-label="About funds">
          <h2>Say what your money is for</h2>
          <p>
            Accounts say where your money is; funds say what it&apos;s for: an emergency fund, a
            wedding, the next roof. Money goes into a fund, or comes out of one, only when you say
            so: on a transaction (&ldquo;for Emergency&rdquo;), or by moving money between funds.
            Whatever isn&apos;t in a fund is {UNALLOCATED}.
          </p>
          {canManage ? (
            <p>
              Start with <strong>New fund</strong>, then move money into it, or choose it on a
              transaction.
            </p>
          ) : (
            <p className="muted">Someone who manages this book can set funds up.</p>
          )}
        </section>
      )}

      {data && data.funds.length > 0 && (
        <section className="card fund-totals" aria-label="Totals">
          <dl>
            <div>
              <dt>Net worth</dt>
              <dd className="num">{money(data.net_worth)}</dd>
            </div>
            <div>
              <dt>In funds</dt>
              <dd className="num">
                {formatMoney(
                  add(data.net_worth.number, negate(data.unallocated.number)),
                  data.currency
                )}
              </dd>
            </div>
            <div>
              <dt>{UNALLOCATED}</dt>
              <dd className={`num${isNegative(data.unallocated.number) ? " negative" : ""}`}>
                {money(data.unallocated)}
              </dd>
            </div>
          </dl>
          <HoldingsLine holdings={data.unallocated_holdings} currency={data.currency} />
          <p className="small muted">
            {UNALLOCATED} is everything that isn&apos;t in a fund, your house and retirement
            accounts included.
          </p>
          {over.length > 0 && (
            <p className="small warning" role="alert">
              Your funds hold{" "}
              {over
                .map((h) => formatMoney(negate(h.amount.number), h.amount.currency))
                .join(" and ")}{" "}
              more than your accounts do.{" "}
              <Link href={`/books/${book}/notifications`}>See what needs a fund ›</Link>
            </p>
          )}
          {data.unpriced && data.unpriced.length > 0 && (
            <p className="small muted">
              Left out of net worth, with no price yet: {data.unpriced.join(", ")}.
            </p>
          )}
        </section>
      )}

      {active.length > 0 && (
        <section className="stack" aria-label="Your funds">
          {active.map((f) => (
            <Link key={f.name} href={href(f.name)} className="card link account-card fund-card">
              <div className="account-card-top">
                <h2>{f.name}</h2>
                <span className={`balance${isNegative(f.value.number) ? " negative" : ""}`}>
                  {money(f.value)}
                </span>
              </div>
              <HoldingsLine holdings={f.holdings} currency={data!.currency} />
              {f.description && <p className="muted small">{f.description}</p>}
              <TargetProgress fund={f} />
            </Link>
          ))}
        </section>
      )}

      {archived.length > 0 && (
        <details className="card archived-funds">
          <summary>Archived ({archived.length})</summary>
          <ul className="plain-list">
            {archived.map((f) => (
              <li key={f.name}>
                <Link href={href(f.name)}>{f.name}</Link>{" "}
                <span className="small muted">archived {formatDay(f.archived!)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {moving && <MoveMoneyDialog book={book} onClose={() => setMoving(false)} />}
      {creating && (
        <NewFundDialog
          book={book}
          listing={data}
          onCreated={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      )}
    </main>
  );
}

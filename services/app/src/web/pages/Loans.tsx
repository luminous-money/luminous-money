import { Link } from "wouter";

import { usd } from "../components/Loans.js";
import { formatDay } from "../lib/format.js";
import { explain, useLoans } from "../lib/queries.js";

/** Loans: each one's balance, its next payment, and when it's paid off. */
export function Loans({ book }: { book: string }) {
  const loans = useLoans(book);
  return (
    <main>
      <header className="page-head home-head">
        <div>
          <h1>Loans</h1>
          <p className="muted">Payments staged from each loan&apos;s amortization table</p>
        </div>
        <Link href={`/books/${book}/loans/new`} className="button primary-link">
          New loan
        </Link>
      </header>

      {loans.isPending && <p className="muted">Loading…</p>}
      {loans.error && <p className="card error">{explain(loans.error)}</p>}
      {loans.data?.length === 0 && (
        <p className="card done">
          No loans yet. Declare one (a mortgage, a car loan) from its amortization table, and its
          payments are staged with principal, interest and escrow apart.
        </p>
      )}

      <section className="stack" aria-label="Your loans">
        {loans.data?.map((l) => (
          <Link key={l.id} href={`/books/${book}/loans/${l.id}`} className="card link account-card">
            <div className="account-card-top">
              <h2>{l.name}</h2>
              <span className="balance">{usd(l.status.owed, l.currency)}</span>
            </div>
            <p className="muted small">
              {l.status.next
                ? `Next: ${formatDay(l.status.next.nominal)}, ${usd(l.status.next.total, l.currency)}`
                : "Paid off"}
              {l.paused ? " · Paused" : ""}
            </p>
          </Link>
        ))}
      </section>
    </main>
  );
}

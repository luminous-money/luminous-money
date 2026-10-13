import { Link } from "wouter";

import { describe, type TransactionTemplate } from "../../shared/schedule.js";
import { formatMoney } from "../lib/decimal.js";
import { explain, useSchedules, useUpcoming } from "../lib/queries.js";

/** A template's headline amount: its first split with one. */
function amount(template: TransactionTemplate): string {
  const units = template.postings.find((p) => p.units)?.units;
  return units ? formatMoney(units.number, units.currency) : "";
}

/**
 * Schedules: each one's rule in words, what it stages next and for how much (paused and failing
 * ones marked), then everything coming up in the next 30 days.
 */
export function Schedules({ book }: { book: string }) {
  const schedules = useSchedules(book);
  const upcoming = useUpcoming(book);

  return (
    <main>
      <header className="page-head home-head">
        <div>
          <h1>Schedules</h1>
          <p className="muted">Transactions that repeat, staged for review when they come due</p>
        </div>
        <Link href={`/books/${book}/schedules/new`} className="button primary-link">
          New schedule
        </Link>
      </header>

      {schedules.isPending && <p className="muted">Loading…</p>}
      {schedules.error && <p className="card error">{explain(schedules.error)}</p>}
      {schedules.data?.length === 0 && (
        <p className="card done">
          No schedules yet. Make one here, or with "Repeat…" on any transaction.
        </p>
      )}

      <section className="stack" aria-label="Your schedules">
        {schedules.data?.map((s) => (
          <Link
            key={s.id}
            href={`/books/${book}/schedules/${s.id}`}
            className="card link account-card"
          >
            <div className="account-card-top">
              <h2>{s.name}</h2>
              <span className="balance">{amount(s.template)}</span>
            </div>
            <p className="muted small">
              {describe(s.rule)}
              {s.paused ? " · Paused" : s.next ? ` · Next: ${s.next.date}` : " · Ended"}
            </p>
            {s.last_error && <p className="error small">Couldn't stage: {s.last_error}</p>}
          </Link>
        ))}
      </section>

      {upcoming.data && upcoming.data.length > 0 && (
        <section className="card" aria-label="Upcoming">
          <h2 className="section-title">Coming up in the next 30 days</h2>
          <ol className="upcoming">
            {upcoming.data.map((o) => (
              <li key={`${o.schedule_id}:${o.nominal}`}>
                <span className="muted">{o.date}</span>
                <span>{o.name}</span>
                <span className="num">{amount(o.template)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

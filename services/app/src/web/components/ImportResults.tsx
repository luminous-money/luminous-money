import { Link } from "wouter";

import type { ImportResult, Outcome } from "../lib/appApi.js";
import { formatMoney } from "../lib/decimal.js";

const OUTCOMES: Record<Outcome, string> = {
  staged: "Imported",
  duplicate: "Already imported",
  "before-opening": "Before the opening balance",
  unreadable: "Couldn't read",
};

/** What an import did: counts, then every row with its outcome and any possible matches. */
export function ImportResults({
  result,
  book,
  currency,
}: {
  result: ImportResult;
  book: string;
  currency: string;
}) {
  const { batch, rows } = result;
  return (
    <section className="stack" aria-label="Import results">
      <div className="card">
        <h2 className="section-title">Imported {batch.filename}</h2>
        <p>
          <strong>{batch.staged}</strong> new {batch.staged === 1 ? "transaction" : "transactions"}{" "}
          to review
          {batch.duplicates > 0 && ` · ${batch.duplicates} already imported`}
          {batch.skipped > 0 && ` · ${batch.skipped} before the opening balance`}
          {batch.unreadable > 0 && ` · ${batch.unreadable} couldn't be read`}
        </p>
        <div className="actions">
          <Link
            href={`/books/${book}/accounts/${encodeURIComponent(batch.account)}`}
            className="button"
          >
            View the account
          </Link>
          {batch.staged > 0 && (
            <Link href={`/books/${book}/review`} className="button primary-link">
              Review them
            </Link>
          )}
        </div>
      </div>

      <ol className="import-rows">
        {rows.map((row) => (
          <li key={row.line} className={`card import-row ${row.outcome}`}>
            <div className="item-top">
              <span className="muted">
                Line {row.line}
                {row.date && ` · ${row.date}`}
              </span>
              {row.amount && <span className="amount">{formatMoney(row.amount, currency)}</span>}
            </div>
            <div>{row.description || <span className="muted">(no description)</span>}</div>
            <p className="small">
              <span className={`pill outcome-${row.outcome}`}>{OUTCOMES[row.outcome]}</span>
              {row.error && <span className="error"> {row.error}</span>}
            </p>
            {row.candidates.length > 0 && (
              <div className="candidates">
                <p className="muted small">Might be the same as:</p>
                <ol>
                  {row.candidates.slice(0, 3).map((c) => (
                    <li key={c.transaction_id}>
                      {c.date} · {c.payee ?? c.narration ?? "(no description)"} ·{" "}
                      {formatMoney(c.amount, currency)}{" "}
                      <span className="muted">
                        (
                        {c.days === 0
                          ? "same day"
                          : `${Math.abs(c.days)} day${Math.abs(c.days) === 1 ? "" : "s"} ${c.days < 0 ? "earlier" : "later"}`}
                        )
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

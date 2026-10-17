import { Link } from "wouter";

import type { Account } from "@fava-beans/ledger-client";

import type { FileBalanceCheck } from "../../shared/imports.js";
import type { Candidate, ImportResult, Outcome } from "../lib/appApi.js";
import { shortName, shown } from "../lib/accounts.js";
import { add, formatMoney, isZero, negate } from "../lib/decimal.js";
import { formatDay } from "../lib/format.js";

const OUTCOMES: Record<Outcome, string> = {
  staged: "Imported",
  matched: "Matched",
  duplicate: "Already imported",
  "before-opening": "Before the opening balance",
  unreadable: "Couldn't read",
};

const describe = (c: Candidate | undefined) =>
  c ? `${c.payee ?? c.narration ?? "(no description)"} · ${c.date}` : "a transaction";

/** Whether the books agree with the file's last balance (M14). */
function BalanceCheck({ check, type }: { check: FileBalanceCheck; type?: Account["type"] }) {
  const money = (n: string) => formatMoney(shown(n, type), check.currency);
  const agree = isZero(add(check.file, negate(check.books)));
  return (
    <p className={`small ${agree ? "muted" : "error"}`}>
      The file ends at {money(check.file)} on {formatDay(check.date)}:{" "}
      {agree ? "the books agree." : `the books say ${money(check.books)}.`}
    </p>
  );
}

/** What an import did: counts, then every row with its outcome and any possible matches. */
export function ImportResults({
  result,
  book,
  currency,
  type,
}: {
  result: ImportResult;
  book: string;
  currency: string;
  /** The account's, to show balances as it reads (a card's as owed). */
  type?: Account["type"];
}) {
  const { batch, rows } = result;
  return (
    <section className="stack" aria-label="Import results">
      <div className="card">
        <h2 className="section-title">Imported {batch.filename}</h2>
        <p>
          <strong>{batch.staged}</strong> new {batch.staged === 1 ? "transaction" : "transactions"}{" "}
          to review
          {batch.matched > 0 &&
            ` · ${batch.matched} matched ${batch.matched === 1 ? "a transaction" : "transactions"} already there`}
          {batch.duplicates > 0 && ` · ${batch.duplicates} already imported`}
          {batch.skipped > 0 && ` · ${batch.skipped} before the opening balance`}
          {batch.unreadable > 0 && ` · ${batch.unreadable} couldn't be read`}
        </p>
        {result.balance_check && <BalanceCheck check={result.balance_check} type={type} />}
        <div className="actions">
          <Link
            href={`/books/${book}/accounts/${encodeURIComponent(batch.account)}`}
            className="button"
          >
            View the account
          </Link>
          {batch.staged + batch.matched > 0 && (
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
              {row.outcome === "staged" && row.proposal?.categorizer && (
                <span className="muted">
                  {" "}
                  as {row.proposal.accounts.map(shortName).join(", ")} ({row.proposal.categorizer}
                  {row.proposal.confidence !== null &&
                    `, ${Math.round(row.proposal.confidence * 100)}%`}
                  )
                </span>
              )}
              {row.outcome === "matched" && (
                <span className="muted">
                  {" "}
                  with{" "}
                  {describe(row.candidates.find((c) => c.transaction_id === row.transaction_id))}
                </span>
              )}
            </p>
            {row.candidates.length > 0 && (
              <div className="candidates">
                <p className="muted small">Possible matches:</p>
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

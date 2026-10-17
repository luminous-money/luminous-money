import type { Ref } from "react";
import { useLocation } from "wouter";

import { formatMoney } from "../lib/decimal.js";
import { accountsLabel, movement } from "../lib/journal.js";
import type { JournalRow } from "../lib/ledger.js";
import { withBack } from "../lib/navigation.js";

/**
 * Transactions from every account, as a ledger's rows: the date, who, where the money went
 * (from → to), and how much. Tapping one opens it, coming back to `here`.
 */
export function JournalList({
  book,
  rows,
  here,
  list,
  top,
  label = "Transactions",
}: {
  book: string;
  rows: JournalRow[];
  here: string;
  list?: Ref<HTMLOListElement>;
  /** A row before the transactions (Load more). */
  top?: React.ReactNode;
  label?: string;
}) {
  const [, navigate] = useLocation();
  return (
    <ol className="ledger journal" aria-label={label} ref={list}>
      {top}
      {rows.map((row) => {
        const moved = movement(row.postings);
        return (
          <li key={row.id} data-row={row.id}>
            <button
              type="button"
              className={`ledger-row${row.flag === "!" ? " unconfirmed" : ""}`}
              onClick={() => navigate(withBack(`/books/${book}/transactions/${row.id}`, here))}
            >
              <span className="ledger-date">{row.date}</span>
              <span className="ledger-what">
                <span className="ledger-payee">
                  {row.payee ?? row.narration ?? "(no description)"}
                </span>
                <span className="ledger-account muted">
                  {moved.from.length ? accountsLabel(moved.from) : "?"} →{" "}
                  {moved.to.length ? accountsLabel(moved.to) : "?"}
                  {row.flag === "!" && " · unconfirmed"}
                </span>
              </span>
              <span className="ledger-numbers">
                <span className="amount">
                  {moved.amount ? formatMoney(moved.amount.number, moved.amount.currency) : "?"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

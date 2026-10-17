/**
 * A ledger's view, as its URL has it (so Back keeps it), and its filter (M14): a funnel button
 * beside "Go to date" opening the options, the first being Reconciliation (all, reconciled, or
 * not). Filtering is the server's, so pages stay full and running balances stay the account's.
 */
import { useState } from "react";

import { useParam } from "../lib/navigation.js";

export type LedgerView = { date?: string; reconciled?: boolean };

/** The view in the URL: `?date=` (a partial view, from that date back) and
 * `?reconciled=yes|no`; `href` builds the URL for another view of the same ledger. */
export function useLedgerView(base: string) {
  const date = useParam("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  const param = useParam("reconciled");
  const reconciled = param === "yes" ? true : param === "no" ? false : undefined;
  const href = (view: LedgerView) => {
    const query = new URLSearchParams();
    if (view.date) query.set("date", view.date);
    if (view.reconciled !== undefined) query.set("reconciled", view.reconciled ? "yes" : "no");
    const text = query.toString();
    return text ? `${base}?${text}` : base;
  };
  return { date, reconciled, here: href({ date, reconciled }), href };
}

const CHOICES = [
  ["All", undefined],
  ["Reconciled", true],
  ["Not reconciled", false],
] as const;

export function LedgerFilter({
  reconciled,
  onChange,
}: {
  reconciled?: boolean;
  onChange: (reconciled?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = reconciled !== undefined;
  return (
    <div className="ledger-filter">
      <button
        type="button"
        className={`filter-button${active ? " on" : ""}`}
        aria-label={active ? "Filter (on)" : "Filter"}
        title="Filter"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M3 5h18l-7 8.5V19l-4 2v-7.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="filter-panel" role="group" aria-label="Filters">
          <span className="small muted">Reconciliation</span>
          <div className="segmented" role="radiogroup" aria-label="Reconciliation">
            {CHOICES.map(([label, value]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={reconciled === value}
                className={reconciled === value ? "on" : ""}
                onClick={() => onChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {active && !open && (
        <p className="small muted filter-note">
          {reconciled ? "Reconciled only." : "Not reconciled only."}{" "}
          <button type="button" className="plain" onClick={() => onChange(undefined)}>
            Show all
          </button>
        </p>
      )}
    </div>
  );
}

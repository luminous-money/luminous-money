/**
 * A ledger's view, as its URL has it (so Back keeps it), and its filter (M14, M17): a funnel
 * button beside "Go to date" opening the options: Reconciliation (all, reconciled, or not) and
 * Tags (only transactions with every tag chosen). Filtering is the server's, so pages stay full
 * and running balances stay the account's.
 */
import { useState } from "react";

import { useParam, useParams } from "../lib/navigation.js";
import { useTags } from "../lib/queries.js";
import { tagList, TagInput } from "./Tags.js";

export type LedgerView = { date?: string; reconciled?: boolean; tags?: string[] };

/** The view in the URL: `?date=` (a partial view, from that date back), `?reconciled=yes|no`
 * and `?tag=` (repeated); `href` builds the URL for another view of the same ledger. */
export function useLedgerView(base: string) {
  const date = useParam("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  const param = useParam("reconciled");
  const reconciled = param === "yes" ? true : param === "no" ? false : undefined;
  const tags = useParams("tag").filter(Boolean);
  const href = (view: LedgerView) => {
    const query = new URLSearchParams();
    if (view.date) query.set("date", view.date);
    if (view.reconciled !== undefined) query.set("reconciled", view.reconciled ? "yes" : "no");
    for (const tag of view.tags ?? []) query.append("tag", tag);
    const text = query.toString();
    return text ? `${base}?${text}` : base;
  };
  return { date, reconciled, tags, here: href({ date, reconciled, tags }), href };
}

/** What a filter shows, for an empty list: "reconciled transactions tagged #trip". */
export function filteredLabel(reconciled: boolean | undefined, tags: readonly string[]) {
  const kind = reconciled === undefined ? "" : reconciled ? "reconciled " : "unreconciled ";
  return `${kind}transactions${tags.length ? ` tagged ${tagList(tags)}` : ""}`;
}

const CHOICES = [
  ["All", undefined],
  ["Reconciled", true],
  ["Not reconciled", false],
] as const;

export function LedgerFilter({
  book,
  reconciled,
  tags,
  onChange,
}: {
  book: string;
  reconciled?: boolean;
  tags: string[];
  onChange: (view: { reconciled?: boolean; tags: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const bookTags = useTags(book);
  const active = reconciled !== undefined || tags.length > 0;
  const shown = [
    reconciled === undefined ? null : reconciled ? "Reconciled" : "Not reconciled",
    tags.length ? `${reconciled === undefined ? "Tagged" : "tagged"} ${tagList(tags)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
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
                onClick={() => onChange({ reconciled: value, tags })}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="small muted">Tags (all of them)</span>
          <TagInput
            label="Filter by tag"
            value={tags}
            choices={bookTags.data ?? []}
            allowNew={false}
            placeholder={bookTags.data?.length ? undefined : "No tags yet"}
            onChange={(chosen) => onChange({ reconciled, tags: chosen })}
          />
        </div>
      )}
      {active && !open && (
        <p className="small muted filter-note">
          {shown} only.{" "}
          <button type="button" className="plain" onClick={() => onChange({ tags: [] })}>
            Show all
          </button>
        </p>
      )}
    </div>
  );
}

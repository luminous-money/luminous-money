/**
 * A list's view, as its URL has it (so Back keeps it), and its filter (M14, M17): a funnel
 * button beside "Go to date" opening the options: Reconciliation (all, reconciled, or not), Tags
 * (only transactions with every tag chosen) and, where asked, Accounts (only transactions with a
 * split in any account chosen, or under one). `SearchBox` searches payees, descriptions and
 * splits' items. Ledgers filter at the server, so pages stay full and running balances stay the
 * account's; review filters what it holds (lib/filters).
 */
import { useEffect, useRef, useState } from "react";

import { shortName } from "../lib/accounts.js";
import type { JournalFilter } from "../lib/ledger.js";
import { useParam, useParams } from "../lib/navigation.js";
import { useAccounts, useTags } from "../lib/queries.js";
import { AccountName, AccountPicker } from "./AccountPicker.js";
import { tagList, TagInput } from "./Tags.js";

export type LedgerView = { date?: string } & JournalFilter;

/** The view in the URL: `?date=` (a partial view, from that date back), `?reconciled=yes|no`,
 * `?tag=` and `?account=` (each repeated) and `?q=` (a search); `href` builds the URL for another
 * view of the same list, and `filter` is the view's filter. */
export function useLedgerView(base: string) {
  const date = useParam("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  const param = useParam("reconciled");
  const reconciled = param === "yes" ? true : param === "no" ? false : undefined;
  const tags = useParams("tag").filter(Boolean);
  const accounts = useParams("account").filter(Boolean);
  const q = useParam("q") ?? "";
  const href = (view: LedgerView) => {
    const query = new URLSearchParams();
    if (view.date) query.set("date", view.date);
    if (view.reconciled !== undefined) query.set("reconciled", view.reconciled ? "yes" : "no");
    for (const tag of view.tags ?? []) query.append("tag", tag);
    for (const account of view.accounts ?? []) query.append("account", account);
    // Kept as typed (a space included), so the search box isn't put right while it's typed in.
    if (view.q?.trim()) query.set("q", view.q);
    const text = query.toString();
    return text ? `${base}?${text}` : base;
  };
  const filter: JournalFilter = { reconciled, tags, accounts, q };
  return { date, reconciled, tags, accounts, q, filter, here: href({ date, ...filter }), href };
}

/** What a filter shows, for an empty list: "reconciled transactions tagged #trip in Food or
 * Home:Garden matching “oat milk”". */
export function filteredLabel({ reconciled, tags = [], accounts = [], q }: JournalFilter) {
  const kind = reconciled === undefined ? "" : reconciled ? "reconciled " : "unreconciled ";
  return (
    `${kind}transactions` +
    (tags.length ? ` tagged ${tagList(tags)}` : "") +
    (accounts.length ? ` in ${inWords(accounts.map(shortName), "or")}` : "") +
    (q?.trim() ? ` matching “${q.trim()}”` : "")
  );
}

const inWords = (items: string[], and: string) =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;

const CHOICES = [
  ["All", undefined],
  ["Reconciled", true],
  ["Not reconciled", false],
] as const;

export function LedgerFilter({
  book,
  filter,
  onChange,
  reconciliation = true,
  byAccount = false,
}: {
  book: string;
  filter: JournalFilter;
  /** The filter changed (the search, which isn't here, kept). */
  onChange: (filter: JournalFilter) => void;
  /** Whether to offer Reconciliation. */
  reconciliation?: boolean;
  /** Whether to offer Accounts. */
  byAccount?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bookTags = useTags(book);
  const { reconciled, tags = [], accounts = [] } = filter;
  const active = reconciled !== undefined || tags.length > 0 || accounts.length > 0;
  const shown = [
    reconciled === undefined ? null : reconciled ? "Reconciled" : "Not reconciled",
    tags.length ? `tagged ${tagList(tags)}` : null,
    accounts.length ? `in ${inWords(accounts.map(shortName), "or")}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const change = (changed: JournalFilter) => onChange({ ...filter, ...changed });
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
          {reconciliation && (
            <>
              <span className="small muted">Reconciliation</span>
              <div className="segmented" role="radiogroup" aria-label="Reconciliation">
                {CHOICES.map(([label, value]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={reconciled === value}
                    className={reconciled === value ? "on" : ""}
                    onClick={() => change({ reconciled: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {byAccount && (
            <>
              <span className="small muted">Accounts (any of them)</span>
              <AccountChoices
                book={book}
                value={accounts}
                onChange={(chosen) => change({ accounts: chosen })}
              />
            </>
          )}
          <span className="small muted">Tags (all of them)</span>
          <TagInput
            label="Filter by tag"
            value={tags}
            choices={bookTags.data ?? []}
            allowNew={false}
            placeholder={bookTags.data?.length ? undefined : "No tags yet"}
            onChange={(chosen) => change({ tags: chosen })}
          />
        </div>
      )}
      {active && !open && (
        <p className="small muted filter-note">
          {shown.charAt(0).toUpperCase() + shown.slice(1)} only.{" "}
          <button
            type="button"
            className="plain"
            onClick={() => onChange({ q: filter.q, reconciled: undefined, tags: [], accounts: [] })}
          >
            Show all
          </button>
        </p>
      )}
    </div>
  );
}

/** Accounts chosen to filter by: each a chip with ×, and a picker (nodes too) to add one. */
function AccountChoices({
  book,
  value,
  onChange,
}: {
  book: string;
  value: string[];
  onChange: (accounts: string[]) => void;
}) {
  const chart = useAccounts(book);
  const names = (chart.data ?? []).map((a) => a.name).filter((name) => !value.includes(name));
  return (
    <div className="account-choices">
      {value.map((account) => (
        <span key={account} className="tag account-chip">
          <AccountName name={account} />
          <button
            type="button"
            className="plain"
            aria-label={`Remove ${account}`}
            onClick={() => onChange(value.filter((a) => a !== account))}
          >
            ×
          </button>
        </span>
      ))}
      <AccountPicker
        label="Filter by account"
        accounts={names}
        value=""
        placeholder="Add an account"
        onChange={(account) => onChange([...value, account])}
      />
    </div>
  );
}

/**
 * A search of payees, descriptions and splits' items: what's typed is passed on once typing
 * pauses, and Escape clears it. `value` is what the list searches for now (the URL's).
 */
export function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value);
  const sent = useRef(value);
  // The URL changed by itself (Back, or Show all): show what it says.
  useEffect(() => {
    if (value !== sent.current) setText((sent.current = value));
  }, [value]);
  useEffect(() => {
    if (text === sent.current) return;
    const timer = setTimeout(() => onChange((sent.current = text)), 300);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="search"
      className="ledger-search"
      aria-label="Search"
      placeholder="Search payees, descriptions, items"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && text) {
          e.preventDefault();
          setText("");
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (text !== sent.current) onChange((sent.current = text));
        }
      }}
    />
  );
}

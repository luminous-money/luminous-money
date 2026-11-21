/**
 * A list's view, as its URL has it (so Back keeps it), and its header (`ListTools`): the search
 * (payees, descriptions and splits' items), Select, and the filter: Accounts (only transactions
 * with a split in any account chosen, or under one), Tags (only those with every tag chosen), a
 * date to go to (a ledger's), Reconciliation (M14, M17), and Receipt (whether a transaction holds
 * a file: HSA tracking's "No receipt", with the tag). Ledgers filter at the server, so
 * pages stay full and running balances stay the account's; review filters what it holds
 * (lib/filters).
 */
import { Filter, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { shortName } from "../lib/accounts.js";
import type { JournalFilter } from "../lib/ledger.js";
import { useParam, useParams } from "../lib/navigation.js";
import { useAccounts, useTags } from "../lib/queries.js";
import { AccountName, AccountPicker } from "./AccountPicker.js";
import { formatFullDay } from "../lib/format.js";
import { JumpToDate } from "./Paged.js";
import { tagList, TagInput } from "./Tags.js";

export type LedgerView = { date?: string } & JournalFilter;

/** The view in the URL: `?date=` (a partial view, from that date back), `?reconciled=yes|no`,
 * `?receipt=yes|no`, `?tag=` and `?account=` (each repeated) and `?q=` (a search); `href`
 * builds the URL for another view of the same list, and `filter` is the view's filter. */
export function useLedgerView(base: string) {
  const date = useParam("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  const reconciled = yesNo(useParam("reconciled"));
  const attached = yesNo(useParam("receipt"));
  const tags = useParams("tag").filter(Boolean);
  const accounts = useParams("account").filter(Boolean);
  const q = useParam("q") ?? "";
  const href = (view: LedgerView) => {
    const query = new URLSearchParams();
    if (view.date) query.set("date", view.date);
    if (view.reconciled !== undefined) query.set("reconciled", view.reconciled ? "yes" : "no");
    if (view.attached !== undefined) query.set("receipt", view.attached ? "yes" : "no");
    for (const tag of view.tags ?? []) query.append("tag", tag);
    for (const account of view.accounts ?? []) query.append("account", account);
    // Kept as typed (a space included), so the search box isn't put right while it's typed in.
    if (view.q?.trim()) query.set("q", view.q);
    const text = query.toString();
    return text ? `${base}?${text}` : base;
  };
  const filter: JournalFilter = { reconciled, attached, tags, accounts, q };
  return { date, reconciled, tags, accounts, q, filter, here: href({ date, ...filter }), href };
}

const yesNo = (param: string | null | undefined) =>
  param === "yes" ? true : param === "no" ? false : undefined;

/** What a filter shows, for an empty list: "reconciled transactions tagged #trip in Food or
 * Home:Garden matching “oat milk”". */
export function filteredLabel({
  reconciled,
  attached,
  tags = [],
  accounts = [],
  q,
}: JournalFilter) {
  const kind = reconciled === undefined ? "" : reconciled ? "reconciled " : "unreconciled ";
  return (
    `${kind}transactions` +
    (attached === undefined ? "" : attached ? " with a receipt" : " without a receipt") +
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

const RECEIPTS = [
  ["All", undefined],
  ["Has one", true],
  ["None", false],
] as const;

/** A list's view, without its search: what the filter panel changes. */
type Change = (view: LedgerView, options?: { replace?: boolean }) => void;

/**
 * A list's header (Transactions, review, an account's ledger): one row of the search, Select and
 * the filter button. The filter button opens the panel (Accounts, Tags, a date to go to, and on
 * a ledger Reconciliation) and closes it again; closed, what's on is said as pills ("tag:
 * trip"), each taken off by a tap. In Select mode its bar (`selecting`) takes the row's place,
 * and the pills stay: the filter still holds, so a filtered set can be selected (Select all is
 * what's shown).
 */
export function ListTools({
  book,
  view,
  onChange,
  onSelect,
  selecting,
  reconciliation = false,
  byReceipt = false,
  byAccount = false,
  byDate = true,
}: {
  book: string;
  view: LedgerView;
  onChange: Change;
  /** Start Select mode; Select is offered only with it. */
  onSelect?: () => void;
  /** Select mode's bar, in place of the row while selecting. */
  selecting?: React.ReactNode;
  reconciliation?: boolean;
  /** Whether to offer Receipt: those holding a file, or none (HSA tracking). */
  byReceipt?: boolean;
  byAccount?: boolean;
  /** Whether to offer "Go to date" (a ledger's, paged by date). */
  byDate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bookTags = useTags(book);
  const { reconciled, attached, tags = [], accounts = [], q = "", date } = view;
  const set = (changed: LedgerView, options?: { replace?: boolean }) =>
    onChange({ ...view, ...changed }, options);
  const pills: { label: string; clear: () => void }[] = [
    ...(q.trim() ? [{ label: `search: ${q.trim()}`, clear: () => set({ q: "" }) }] : []),
    ...(date
      ? [{ label: `date: ${formatFullDay(date)}`, clear: () => set({ date: undefined }) }]
      : []),
    ...tags.map((tag) => ({
      label: `tag: ${tag}`,
      clear: () => set({ tags: tags.filter((t) => t !== tag) }),
    })),
    ...accounts.map((account) => ({
      label: `account: ${shortName(account)}`,
      clear: () => set({ accounts: accounts.filter((a) => a !== account) }),
    })),
    ...(reconciled === undefined
      ? []
      : [
          {
            label: reconciled ? "reconciled" : "not reconciled",
            clear: () => set({ reconciled: undefined }),
          },
        ]),
    ...(attached === undefined
      ? []
      : [
          {
            label: attached ? "has a receipt" : "no receipt",
            clear: () => set({ attached: undefined }),
          },
        ]),
  ];
  const filtered = pills.length > 0;

  return (
    <div className="list-tools">
      {selecting || (
        <div className="list-tools-row">
          <SearchBox value={q} onChange={(text) => set({ q: text }, { replace: true })} />
          {onSelect && (
            <button type="button" onClick={onSelect}>
              Select
            </button>
          )}
          <button
            type="button"
            className={`filter-button${filtered ? " on" : ""}`}
            aria-label={filtered ? "Filter (on)" : "Filter"}
            title="Filter"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Filter aria-hidden="true" />
          </button>
        </div>
      )}
      {open && !selecting ? (
        <div className="filter-panel" role="group" aria-label="Filters">
          {byAccount && (
            <>
              <span className="small muted">Accounts (any of them)</span>
              <AccountChoices
                book={book}
                value={accounts}
                onChange={(chosen) => set({ accounts: chosen })}
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
            onChange={(chosen) => set({ tags: chosen })}
          />
          {byDate && (
            <>
              <span className="small muted">From a date back</span>
              <JumpToDate key={date ?? ""} date={date} onGo={(to) => set({ date: to })} />
            </>
          )}
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
                    onClick={() => set({ reconciled: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {byReceipt && (
            <>
              <span className="small muted">Receipt (a file attached)</span>
              <div className="segmented" role="radiogroup" aria-label="Receipt">
                {RECEIPTS.map(([label, value]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={attached === value}
                    className={attached === value ? "on" : ""}
                    onClick={() => set({ attached: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        filtered && (
          <ul className="filter-pills" aria-label="Filters on">
            {pills.map((pill) => (
              <li key={pill.label}>
                <button
                  type="button"
                  className="filter-pill"
                  aria-label={`Remove ${pill.label}`}
                  onClick={pill.clear}
                >
                  {pill.label}
                  <X aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )
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
      placeholder="Search"
      title="Search payees, descriptions and items"
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

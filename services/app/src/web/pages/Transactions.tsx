import { useLocation } from "wouter";

import { JournalList } from "../components/JournalList.js";
import { filteredLabel, ListTools, useLedgerView } from "../components/LedgerFilter.js";
import { MoreBelow, NewerRow, usePaging } from "../components/Paged.js";
import { SelectBar } from "../components/SelectBar.js";
import { withBack } from "../lib/navigation.js";
import { useBulkActions } from "../lib/bulk.js";
import { postable } from "../lib/accounts.js";
import { filtering } from "../lib/filters.js";
import { today } from "../lib/format.js";
import {
  explain,
  useAccountCreation,
  useAccounts,
  useCanWrite,
  useJournal,
} from "../lib/queries.js";
import { simple, unresolved, withCounterpart } from "../lib/split.js";
import { useSelection } from "../lib/selection.js";
import { Loading } from "../components/Loading.js";
import { Crumbs } from "../components/Crumbs.js";

/**
 * Every account's transactions together, newest first, paged as an account's ledger is: 200 at
 * a time as you scroll, or from a date back (`?date=`) with Load more above; searched (`?q=`:
 * payees, descriptions and splits' items) and filtered by reconciliation (`?reconciled=`), tags
 * (`?tag=`, M17) and accounts (`?account=`, any of them). Select mode's actions confirm,
 * categorize, tag or suggest categories for several at once.
 */
export function Transactions({ book }: { book: string }) {
  const [, navigate] = useLocation();
  const base = `/books/${book}/transactions`;
  const { date, filter, here, href } = useLedgerView(base);
  const pages = useJournal(book, date, filter);
  const canWrite = useCanWrite(book);
  const selection = useSelection();
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const { rows, list, end, loadNewer } = usePaging(pages);
  const chosen = rows.filter((r) => selection.has(r.id));
  const bulkActions = useBulkActions({
    book,
    chosen,
    accounts: accounts.data ? postable(accounts.data, today()) : [],
    create,
    categorize: (t, account) =>
      simple(t) ? { postings: withCounterpart(t, account).postings } : null,
    confirmBlocked:
      chosen.some((r) => r.postings.some((p) => unresolved(p.account))) &&
      "choose their accounts first",
  });
  return (
    <main>
      <header className="page-head">
        <Crumbs />
        <div className="home-head">
          <div>
            <h1>Transactions</h1>
            <p className="muted">Every account's, newest first.</p>
          </div>
          {canWrite && (
            <button
              type="button"
              className="primary"
              onClick={() => navigate(withBack(`${base}/new`, here))}
            >
              + Add
            </button>
          )}
        </div>
      </header>
      <ListTools
        book={book}
        view={{ date, ...filter }}
        onChange={(view, options) => navigate(href(view), options)}
        byAccount
        reconciliation
        onSelect={canWrite ? selection.start : undefined}
        selecting={
          selection.selecting ? (
            <SelectBar
              count={chosen.length}
              shown={rows.length}
              onSelectAll={() => selection.selectAll(rows.map((r) => r.id))}
              actions={bulkActions.actions}
              busy={bulkActions.busy}
              note={bulkActions.note}
              onDone={selection.stop}
            />
          ) : null
        }
      />
      {pages.isPending && <Loading />}
      {pages.error && <p className="card error">{explain(pages.error)}</p>}
      {pages.data && rows.length === 0 && (
        <p className="card muted">
          {filtering(filter)
            ? `No ${filteredLabel(filter)}${date ? ` on or before ${date}` : ""}.`
            : date
              ? `Nothing on or before ${date}.`
              : "No transactions yet."}
        </p>
      )}
      {rows.length > 0 && (
        <JournalList
          book={book}
          rows={rows}
          here={here}
          list={list}
          selection={selection}
          top={<NewerRow pages={pages} onLoad={loadNewer} />}
        />
      )}
      <MoreBelow pages={pages} end={end} />
    </main>
  );
}

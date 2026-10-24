import { Link, useLocation } from "wouter";

import { JournalList } from "../components/JournalList.js";
import { LedgerFilter, useLedgerView } from "../components/LedgerFilter.js";
import { JumpToDate, MoreBelow, NewerRow, usePaging } from "../components/Paged.js";
import { SelectBar } from "../components/SelectBar.js";
import { bookHome } from "../lib/books.js";
import { withBack } from "../lib/navigation.js";
import { useBulkActions } from "../lib/bulk.js";
import { postable } from "../lib/accounts.js";
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

/**
 * Every account's transactions together, newest first, paged as an account's ledger is: 200 at
 * a time as you scroll, or from a date back (`?date=`) with Load more above; filtered by
 * reconciliation (`?reconciled=`). Select mode's actions confirm, categorize or suggest
 * categories for several at once.
 */
export function Transactions({ book }: { book: string }) {
  const [, navigate] = useLocation();
  const base = `/books/${book}/transactions`;
  const { date, reconciled, here, href } = useLedgerView(base);
  const pages = useJournal(book, date, reconciled);
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
    onConfirmed: selection.clear,
  });
  return (
    <main>
      <header className="page-head">
        <Link href={bookHome(book)} className="back">
          ‹ Home
        </Link>
        <h1>Transactions</h1>
        <p className="muted">Every account's, newest first.</p>
        {canWrite && !selection.selecting && (
          <div className="actions">
            <button type="button" onClick={selection.start}>
              Select
            </button>
          </div>
        )}
      </header>
      {selection.selecting ? (
        <SelectBar
          count={chosen.length}
          shown={rows.length}
          onSelectAll={() => selection.selectAll(rows.map((r) => r.id))}
          actions={bulkActions.actions}
          busy={bulkActions.busy}
          note={bulkActions.note}
          onDone={selection.stop}
        />
      ) : (
        canWrite && (
          <div className="ledger-add">
            <button
              type="button"
              className="primary"
              onClick={() => navigate(withBack(`${base}/new`, here))}
            >
              + Add transaction
            </button>
          </div>
        )
      )}
      <div className="ledger-tools">
        <JumpToDate
          key={date ?? ""}
          date={date}
          onGo={(to) => navigate(href({ date: to, reconciled }))}
        />
        <LedgerFilter
          reconciled={reconciled}
          onChange={(to) => navigate(href({ date, reconciled: to }))}
        />
      </div>
      {pages.isPending && <p className="muted">Loading…</p>}
      {pages.error && <p className="card error">{explain(pages.error)}</p>}
      {pages.data && rows.length === 0 && (
        <p className="card muted">
          {reconciled !== undefined
            ? `No ${reconciled ? "reconciled" : "unreconciled"} transactions${date ? ` on or before ${date}` : ""}.`
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

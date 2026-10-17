import { Link, useLocation } from "wouter";

import { JournalList } from "../components/JournalList.js";
import { JumpToDate, MoreBelow, NewerRow, usePaging } from "../components/Paged.js";
import { bookHome } from "../lib/books.js";
import { useParam, withBack } from "../lib/navigation.js";
import { explain, useJournal } from "../lib/queries.js";

/**
 * Every account's transactions together, newest first, paged as an account's ledger is: 200 at
 * a time as you scroll, or from a date back (`?date=`) with Load more above.
 */
export function Transactions({ book }: { book: string }) {
  const [, navigate] = useLocation();
  const date = useParam("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  const pages = useJournal(book, date);
  const { rows, list, end, loadNewer } = usePaging(pages);
  const base = `/books/${book}/transactions`;
  const here = date ? `${base}?date=${date}` : base;
  return (
    <main>
      <header className="page-head">
        <Link href={bookHome(book)} className="back">
          ‹ Home
        </Link>
        <h1>Transactions</h1>
        <p className="muted">Every account's, newest first.</p>
      </header>
      <div className="ledger-add">
        <button
          type="button"
          className="primary"
          onClick={() => navigate(withBack(`${base}/new`, here))}
        >
          + Add transaction
        </button>
      </div>
      <JumpToDate
        key={date ?? ""}
        date={date}
        onGo={(to) => navigate(to ? `${base}?date=${to}` : base)}
      />
      {pages.isPending && <p className="muted">Loading…</p>}
      {pages.error && <p className="card error">{explain(pages.error)}</p>}
      {pages.data && rows.length === 0 && (
        <p className="card muted">
          {date ? `Nothing on or before ${date}.` : "No transactions yet."}
        </p>
      )}
      {rows.length > 0 && (
        <JournalList
          book={book}
          rows={rows}
          here={here}
          list={list}
          top={<NewerRow pages={pages} onLoad={loadNewer} />}
        />
      )}
      <MoreBelow pages={pages} end={end} />
    </main>
  );
}

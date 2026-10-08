import { Link } from "wouter";

import { api } from "../lib/ledger.js";
import { useLoad } from "../lib/hooks.js";

type BookSummary = { id: string; staged: number };

async function loadBooks(): Promise<BookSummary[]> {
  const books = await api.books();
  return Promise.all(books.map(async (id) => ({ id, staged: (await api.staged(id)).length })));
}

export function Home() {
  const [books] = useLoad("books", loadBooks);

  return (
    <main>
      <section className="hero">
        <h1>Your books, reviewed in seconds.</h1>
        <p>
          Double-entry accounting with Beancount underneath and a review queue built for your phone.
        </p>
      </section>

      <section className="stack" aria-live="polite">
        <h2 className="section-title">Books</h2>
        {books.state === "loading" && <p className="muted">Loading…</p>}
        {books.state === "failed" && (
          <p className="card">
            <span className="dot bad" /> Ledger unreachable: {books.error}
          </p>
        )}
        {books.state === "ready" && books.value.length === 0 && (
          <p className="card muted">No books yet. Seed a demo with `pnpm seed`.</p>
        )}
        {books.state === "ready" &&
          books.value.map((book) => (
            <Link key={book.id} href={`/books/${book.id}/review`} className="card book link">
              <h3>{book.id}</h3>
              <p className={book.staged ? "" : "muted"}>
                {book.staged ? `${book.staged} to review` : "All caught up"}
              </p>
            </Link>
          ))}
      </section>

      <section className="tiles">
        <Tile title="Import" note="Bank feeds and CSV uploads." soon />
        <Tile title="Schedules" note="Recurring transactions across books." soon />
        <a className="card tile link" href="/fava/">
          <h3>Reports</h3>
          <p>Balance sheet, income statement and queries in Fava.</p>
        </a>
      </section>
    </main>
  );
}

function Tile({ title, note, soon }: { title: string; note: string; soon?: boolean }) {
  return (
    <div className="card tile">
      <h3>
        {title}
        {soon && <span className="badge">Soon</span>}
      </h3>
      <p>{note}</p>
    </div>
  );
}

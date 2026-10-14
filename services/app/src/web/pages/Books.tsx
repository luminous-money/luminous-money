import type { Book } from "@fava-beans/ledger-client";
import { useState } from "react";

import {
  browserTimeZone,
  explain,
  useBooks,
  useRenameBook,
  useSetTimeZone,
  useTimeZone,
} from "../lib/queries.js";

/** Manage books: see them, rename them, set their time zone (which decides "today" for their
 * schedules), and export them (the whole book as one Beancount file, the user's own copy of
 * their data). More books come with M6. */
export function Books() {
  const books = useBooks();
  return (
    <main>
      <header className="page-head">
        <h1>Manage books</h1>
      </header>
      {books.isPending && <p className="muted">Loading…</p>}
      <section className="stack">
        {books.data?.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </section>
    </main>
  );
}

function BookCard({ book }: { book: Book }) {
  const rename = useRenameBook();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(book.name);

  if (!editing) {
    return (
      <div className="card book">
        <h3>{book.name}</h3>
        <TimeZone book={book.id} />
        <div className="actions">
          <a
            className="button"
            href={`/api/ledger/v1/books/${encodeURIComponent(book.id)}/export`}
            download
          >
            Export
          </a>
          <button type="button" onClick={() => (setName(book.name), setEditing(true))}>
            Rename
          </button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="card editor"
      onSubmit={async (e) => {
        e.preventDefault();
        await rename.mutateAsync({ book, name: name.trim() });
        setEditing(false);
      }}
    >
      <label>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          aria-label="Book name"
        />
      </label>
      {rename.error && <p className="error">{explain(rename.error)}</p>}
      <div className="actions">
        <button type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!name.trim() || rename.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}

const ZONES = Intl.supportedValuesOf("timeZone");

/** A book's time zone; books created here start in the browser's. */
function TimeZone({ book }: { book: string }) {
  const zone = useTimeZone(book);
  const set = useSetTimeZone(book);
  const value = zone.data ?? "";
  return (
    <label className="time-zone small">
      Time zone
      <select
        aria-label="Time zone"
        value={value}
        disabled={zone.isPending || set.isPending}
        onChange={(e) => set.mutate(e.target.value)}
      >
        {!value && <option value="">Not set (the server's)</option>}
        {[...new Set([...(value ? [value] : []), browserTimeZone(), ...ZONES])].map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

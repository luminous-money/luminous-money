import type { Book } from "@fava-beans/ledger-client";
import { useState } from "react";

import { explain, useBooks, useRenameBook } from "../lib/queries.js";

/** Manage books: for M1, see them and rename them. More books come with M7. */
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
        <button type="button" onClick={() => (setName(book.name), setEditing(true))}>
          Rename
        </button>
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

import type { Book } from "@luminous-money/ledger-client";
import { useState } from "react";
import { useLocation } from "wouter";

import { AddAccountForm } from "../components/AddAccountForm.js";
import { explain, useCreateBook } from "../lib/queries.js";

/** A new user's first stop: name your books, then add an account. */
export function Setup({ book, onDone }: { book: Book | undefined; onDone: () => void }) {
  const [, navigate] = useLocation();
  const create = useCreateBook();
  const [name, setName] = useState("");

  return (
    <main className="stack">
      <header className="page-head">
        <h1>Let's set up your books</h1>
        <p className="muted">Step {book ? 2 : 1} of 2</p>
      </header>

      {!book ? (
        <form
          className="card editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ name: name.trim() });
          }}
        >
          <label>
            Name your books
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. "Kael Personal" or "Kael and Jess"'
              autoFocus
            />
          </label>
          <p className="muted small">
            A book holds a set of accounts and their transactions. You can rename it later.
          </p>
          {create.error && <p className="error">{explain(create.error)}</p>}
          <div className="actions">
            <button type="submit" className="primary" disabled={!name.trim() || create.isPending}>
              Continue
            </button>
          </div>
        </form>
      ) : (
        <section className="card">
          <h2 className="section-title">Add an account to {book.name}</h2>
          <AddAccountForm
            book={book.id}
            submitLabel="Finish setup"
            onAdded={() => {
              onDone();
              navigate("/");
            }}
          />
        </section>
      )}
    </main>
  );
}

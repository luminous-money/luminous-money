import { useState } from "react";
import { Link, useLocation } from "wouter";

import type { BookInfo } from "../lib/appApi.js";
import { bookHome } from "../lib/books.js";
import {
  browserTimeZone,
  explain,
  useBooks,
  useCreateBook,
  useDeleteBook,
  useRenameBook,
  useBookSettings,
  usePatchSettings,
  useSetTimeZone,
  useTimeZone,
} from "../lib/queries.js";

/** Manage books: create them (empty, or from a Beancount file such as an export), open them,
 * rename them, set their time zone (which decides "today" for their schedules and price runs),
 * export them (the whole book as one Beancount file, the user's own copy of their data), and
 * delete them. */
export function Books() {
  const books = useBooks();
  return (
    <main>
      <header className="page-head">
        <h1>Manage books</h1>
      </header>
      {books.isPending && <p className="muted">Loading…</p>}
      <section className="stack" aria-label="Books">
        {books.data?.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </section>
      <NewBook books={books.data ?? []} />
    </main>
  );
}

const exportHref = (book: string) => `/api/ledger/v1/books/${encodeURIComponent(book)}/export`;

function BookCard({ book }: { book: BookInfo }) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  if (mode === "rename") return <RenameBook book={book} onDone={() => setMode("view")} />;
  if (mode === "delete") return <DeleteBook book={book} onCancel={() => setMode("view")} />;
  return (
    <div className="card book">
      <h3>{book.name}</h3>
      <TimeZone book={book.id} />
      <WeekStart book={book.id} />
      <div className="actions">
        <Link href={bookHome(book.id)} className="button">
          Open
        </Link>
        <a className="button" href={exportHref(book.id)} download>
          Export
        </a>
        <button type="button" onClick={() => setMode("rename")}>
          Rename
        </button>
        <button type="button" className="danger" onClick={() => setMode("delete")}>
          Delete
        </button>
      </div>
    </div>
  );
}

function RenameBook({ book, onDone }: { book: BookInfo; onDone: () => void }) {
  const rename = useRenameBook();
  const [name, setName] = useState(book.name);
  return (
    <form
      className="card editor"
      onSubmit={async (e) => {
        e.preventDefault();
        await rename.mutateAsync({ book, name: name.trim() });
        onDone();
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
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!name.trim() || rename.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}

/** Deleting is for good, so it takes typing the book's name, with Export right there. */
function DeleteBook({ book, onCancel }: { book: BookInfo; onCancel: () => void }) {
  const remove = useDeleteBook();
  const [typed, setTyped] = useState("");
  return (
    <form
      className="card editor"
      aria-label={`Delete ${book.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (typed === book.name) remove.mutate(book);
      }}
    >
      <h3>Delete {book.name}?</h3>
      <p>
        Everything in it goes for good: its accounts and transactions, schedules, rules, saved file
        formats and import history.{" "}
        <a href={exportHref(book.id)} download>
          Export it first
        </a>{" "}
        to keep a copy you can restore as a new book.
      </p>
      <label>
        Type the book's name to delete it
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          aria-label="Name of the book to delete"
          autoComplete="off"
        />
      </label>
      {remove.error && <p className="error">{explain(remove.error)}</p>}
      <div className="actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="danger" disabled={typed !== book.name || remove.isPending}>
          Delete for good
        </button>
      </div>
    </form>
  );
}

/** A book's title in Beancount text (`option "title" "…"`), if it has one. */
function titleIn(text: string): string | undefined {
  const match = /^option\s+"title"\s+"((?:[^"\\]|\\.)*)"/m.exec(text);
  return match?.[1]?.replace(/\\(.)/g, "$1");
}

/** A new book: empty, or a copy of a Beancount file (such as an export: a restore). */
function NewBook({ books }: { books: BookInfo[] }) {
  const [, navigate] = useLocation();
  const create = useCreateBook();
  const [name, setName] = useState("");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  // Names are unique per user: restoring an export of a book you still have suggests a new one.
  const unused = (title: string) =>
    books.some((b) => b.name.toLowerCase() === title.toLowerCase()) ? `${title} (restored)` : title;
  return (
    <form
      className="card editor"
      aria-label="New book"
      onSubmit={async (e) => {
        e.preventDefault();
        const book = await create.mutateAsync({ name: name.trim(), text: file?.text });
        navigate(bookHome(book.id));
      }}
    >
      <h2 className="section-title">New book</h2>
      <label>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="New book's name"
          placeholder='e.g. "Kael and Jess"'
        />
      </label>
      <label>
        Start from a Beancount file <span className="muted">(optional)</span>
        <input
          type="file"
          accept=".beancount,.bean,.txt,text/plain"
          aria-label="Beancount file"
          onChange={async (e) => {
            const picked = e.target.files?.[0];
            if (!picked) return setFile(null);
            const text = await picked.text();
            setFile({ name: picked.name, text });
            if (!name.trim()) setName(unused(titleIn(text) ?? picked.name.replace(/\.[^.]+$/, "")));
          }}
        />
      </label>
      <p className="muted small">
        {file
          ? `The new book starts as a copy of ${file.name}.`
          : "An export from Manage books restores this way, as a new book."}{" "}
        Its time zone starts as yours ({browserTimeZone().replace(/_/g, " ")}).
      </p>
      {create.error && <p className="error">{explain(create.error)}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={!name.trim() || create.isPending}>
          {create.isPending ? "Creating…" : "Create book"}
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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The day the book's weeks start: where weekly budgets' periods start by default. */
function WeekStart({ book }: { book: string }) {
  const settings = useBookSettings(book);
  const patch = usePatchSettings(book);
  const updatedAt = settings.data?.updated_at;
  return (
    <label className="time-zone small">
      Weeks start on
      <select
        aria-label="Weeks start on"
        value={settings.data?.week_start ?? 1}
        disabled={!updatedAt || patch.isPending}
        onChange={(e) =>
          patch.mutate({ updated_at: updatedAt!, week_start: Number(e.target.value) })
        }
      >
        {WEEKDAYS.map((day, i) => (
          <option key={day} value={i}>
            {day}
          </option>
        ))}
      </select>
      {patch.error && <span className="error">{explain(patch.error)}</span>}
    </label>
  );
}

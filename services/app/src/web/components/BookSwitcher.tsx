import { Link } from "wouter";

import type { BookInfo } from "../lib/appApi.js";
import { bookHome } from "../lib/books.js";
import { usePopover } from "../lib/popover.js";

/** The selected book's name, in the masthead. Tapping it lists the user's books (picking one
 * opens its home) and Manage books. */
export function BookSwitcher({ books, book }: { books: BookInfo[]; book: BookInfo | undefined }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="menu switcher" ref={ref}>
      <button
        type="button"
        className="switcher-button"
        aria-label={`Book: ${book?.name ?? "none"}. Switch books`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="switcher-name">{book?.name ?? "Books"}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <nav className="menu-panel" aria-label="Books">
          {books.map((b) => (
            <Link
              key={b.id}
              href={bookHome(b.id)}
              className="menu-item"
              aria-current={b.id === book?.id ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {b.id === book?.id && <span aria-hidden>✓ </span>}
              {b.name}
            </Link>
          ))}
          <Link href="/books" className="menu-item" onClick={() => setOpen(false)}>
            Manage books
          </Link>
        </nav>
      )}
    </div>
  );
}

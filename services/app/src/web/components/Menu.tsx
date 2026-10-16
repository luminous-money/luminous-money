import { Link } from "wouter";

import { bookHome, useSelectedBook } from "../lib/books.js";
import { usePopover } from "../lib/popover.js";
import { useBooks, useLogOut, useMe } from "../lib/queries.js";

/** The hamburger menu: the selected book's Home, Review, Schedules, Rules and Commodities;
 * Manage books; your account; and logging out. */
export function Menu() {
  const { open, setOpen, ref } = usePopover();
  const me = useMe();
  const books = useBooks();
  const book = useSelectedBook(me.data?.id ?? "", books.data ?? []);
  const logOut = useLogOut();

  const item = (href: string, label: string) => (
    <Link href={href} className="menu-item" onClick={() => setOpen(false)}>
      {label}
    </Link>
  );
  const home = book && bookHome(book.id);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="icon menu-button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>☰</span>
      </button>
      {open && (
        <nav className="menu-panel" aria-label="Main">
          {home && item(home, "Home")}
          {home && item(`${home}/review`, "Review")}
          {home && item(`${home}/schedules`, "Schedules")}
          {home && item(`${home}/rules`, "Rules")}
          {home && item(`${home}/commodities`, "Commodities")}
          {home && item(`${home}/connections`, "Bank connections")}
          {item("/books", "Manage books")}
          {item("/account", "Your account")}
          <button type="button" className="menu-item" onClick={() => logOut.mutate()}>
            Log out
          </button>
        </nav>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

import { useCurrentBook, useLogOut } from "../lib/queries.js";

/** The hamburger menu: Home, Manage books, Review, and logging out. */
export function Menu() {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const { book } = useCurrentBook();
  const logOut = useLogOut();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const item = (href: string, label: string) => (
    <Link href={href} className="menu-item" onClick={() => setOpen(false)}>
      {label}
    </Link>
  );

  return (
    <div className="menu" ref={panel}>
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
          {item("/", "Home")}
          {item("/books", "Manage books")}
          {book && item(`/books/${book.id}/review`, "Review")}
          {book && item(`/books/${book.id}/schedules`, "Schedules")}
          {book && item(`/books/${book.id}/rules`, "Rules")}
          <button type="button" className="menu-item" onClick={() => logOut.mutate()}>
            Log out
          </button>
        </nav>
      )}
    </div>
  );
}

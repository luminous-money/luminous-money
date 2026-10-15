import type { Book } from "@fava-beans/ledger-client";
import { Link, useLocation } from "wouter";

import { AddAccountForm } from "../components/AddAccountForm.js";
import { bookHome } from "../lib/books.js";

export function AddAccount({ book }: { book: Book }) {
  const [, navigate] = useLocation();
  return (
    <main>
      <header className="page-head">
        <Link href={bookHome(book.id)} className="back">
          ‹ Home
        </Link>
        <h1>Add an account</h1>
      </header>
      <section className="card">
        <AddAccountForm book={book.id} onAdded={() => navigate(bookHome(book.id))} />
      </section>
    </main>
  );
}

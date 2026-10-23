import type { Book } from "@luminous-money/ledger-client";
import { Link, useLocation } from "wouter";

import { AddAccountForm } from "../components/AddAccountForm.js";
import { bookHome } from "../lib/books.js";
import { useParam } from "../lib/navigation.js";

export function AddAccount({ book }: { book: Book }) {
  const [, navigate] = useLocation();
  const under = useParam("under");
  return (
    <main>
      <header className="page-head">
        <Link href={bookHome(book.id)} className="back">
          ‹ Home
        </Link>
        <h1>Add an account</h1>
      </header>
      <section className="card">
        <AddAccountForm
          book={book.id}
          under={under ?? undefined}
          onAdded={() => navigate(under ? `${bookHome(book.id)}/accounts` : bookHome(book.id))}
        />
      </section>
    </main>
  );
}

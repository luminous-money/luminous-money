import type { Book } from "@luminous-money/ledger-client";
import { useLocation } from "wouter";

import { AddAccountForm } from "../components/AddAccountForm.js";
import { bookHome } from "../lib/books.js";
import { useParam } from "../lib/navigation.js";
import { Crumbs } from "../components/Crumbs.js";

export function AddAccount({ book }: { book: Book }) {
  const [, navigate] = useLocation();
  const under = useParam("under");
  return (
    <main>
      <header className="page-head">
        <Crumbs />
        <h1>Add an account</h1>
      </header>
      <section className="card">
        <AddAccountForm
          book={book.id}
          under={under ?? undefined}
          // Added under an account, it's that account's business, not the home page's.
          star={!under}
          // Its page, to set it up (Kael, 2026-11-14), under its parents.
          onAdded={(added) =>
            navigate(`${bookHome(book.id)}/accounts/${encodeURIComponent(added.name)}/edit`)
          }
        />
      </section>
    </main>
  );
}

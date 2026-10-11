import type { Book } from "@fava-beans/ledger-client";
import { Link, useLocation } from "wouter";

import { AddAccountForm } from "../components/AddAccountForm.js";

export function AddAccount({ book }: { book: Book }) {
  const [, navigate] = useLocation();
  return (
    <main>
      <header className="page-head">
        <Link href="/" className="back">
          ‹ Home
        </Link>
        <h1>Add an account</h1>
      </header>
      <section className="card">
        <AddAccountForm book={book.id} onAdded={() => navigate("/")} />
      </section>
    </main>
  );
}

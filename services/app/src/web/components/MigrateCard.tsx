import { X } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

import { appApi } from "../lib/appApi.js";
import { explain, useMigration, useRememberMigration, useRole } from "../lib/queries.js";

/** Migrating from another system, offered to the book's managers until it's done, or put aside
 * (×, even partway through: it's marked done, and Migrate stays in the Accounts page's ⋯): to
 * start, or to carry on where it was left. */
export function MigrateCard({ book }: { book: string }) {
  const migration = useMigration(book);
  const role = useRole(book);
  const remember = useRememberMigration(book);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!(role === "owner" || role === "manage") || !migration.isSuccess) return null;
  const m = migration.data;
  if (m?.done) return null;

  const dismiss = async () => {
    setBusy(true);
    setError(null);
    try {
      // Never started: one is started to keep the choice, the server's like any other.
      const current = m ?? (await appApi.migration.start(book, "gnucash"));
      remember(await appApi.migration.change(book, { updated_at: current.updated_at, done: true }));
    } catch (e) {
      setError(explain(e));
      setBusy(false);
    }
  };

  return (
    <section className="card migrate-card" aria-label="Migrate from another system">
      <button
        type="button"
        className="icon migrate-dismiss"
        aria-label="Don't offer migrating again"
        title="Don't offer this again (Migrate stays in the Accounts page's ⋯)"
        disabled={busy}
        onClick={() => void dismiss()}
      >
        <X aria-hidden="true" />
      </button>
      <p className="small">
        {m
          ? "You're migrating from GnuCash: carry on where you left off."
          : "Coming from another system? Bring your accounts and history in from GnuCash, with rules and suggestions from them."}
      </p>
      <Link href={`/books/${book}/migrate`} className="button">
        {m ? "Continue migrating" : "Migrate"}
      </Link>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

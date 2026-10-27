import { Link } from "wouter";

import { useMigration, useRole } from "../lib/queries.js";

/** Migrating from another system, offered to the book's managers until it's been done once:
 * to start, or to carry on where it was left. */
export function MigrateCard({ book }: { book: string }) {
  const migration = useMigration(book);
  const role = useRole(book);
  if (!(role === "owner" || role === "manage") || !migration.isSuccess) return null;
  const m = migration.data;
  if (m?.done) return null;
  return (
    <section className="card migrate-card" aria-label="Migrate from another system">
      <p className="small">
        {m
          ? "You're migrating from GnuCash: carry on where you left off."
          : "Coming from another system? Bring your accounts and history in from GnuCash, with rules and suggestions from them."}
      </p>
      <Link href={`/books/${book}/migrate`} className="button">
        {m ? "Continue migrating" : "Migrate"}
      </Link>
    </section>
  );
}

/** Deleting an account's books, through the other services, acting as the user (inside the
 * stack, services trust X-User-Id). Each goes through `app`'s book deletion, so backups carry it
 * and `app` forgets what it kept about the book. */
import type { BookDeleter } from "./app.js";

export function booksOverHttp(ledgerUrl: string, appUrl: string): BookDeleter {
  return async (userId) => {
    const headers = { "x-user-id": userId };
    const listed = await fetch(`${ledgerUrl}/api/ledger/v1/books`, { headers });
    if (!listed.ok) throw new Error(`couldn't list the books: ${listed.status}`);
    for (const book of (await listed.json()) as { id: string; updated_at: string }[]) {
      const deleted = await fetch(
        `${appUrl}/api/app/v1/books/${encodeURIComponent(book.id)}?updated_at=${encodeURIComponent(book.updated_at)}`,
        { method: "DELETE", headers }
      );
      if (!deleted.ok && deleted.status !== 404)
        throw new Error(`couldn't delete book ${book.id}: ${deleted.status}`);
    }
  };
}

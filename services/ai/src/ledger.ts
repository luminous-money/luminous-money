/** What the ai service asks the ledger: the caller's role in a book (acting as them). */
import { createLedgerClient } from "@fava-beans/ledger-client";

import type { Role, RoleOf } from "./api.js";

export function rolesFrom(ledgerUrl: string): RoleOf {
  return async (user, book) => {
    const client = createLedgerClient({ baseUrl: ledgerUrl, headers: { "X-User-Id": user } });
    const { data, response } = await client.GET("/api/ledger/v1/books/{book_id}", {
      params: { path: { book_id: book } },
    });
    if (response.status === 404) return null;
    if (!data) throw new Error(`the ledger said ${response.status}`);
    return (data.role ?? null) as Role | null;
  };
}

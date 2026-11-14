import { useMemo, useState } from "react";
import { Link } from "wouter";

import { ChartTree, ROOTS } from "../components/ChartTree.js";
import { MigrateCard } from "../components/MigrateCard.js";
import { explain, useAccountTree, useCanWrite, useRole } from "../lib/queries.js";
import { Overflow } from "../components/Overflow.js";
import { Loading } from "../components/Loading.js";

/**
 * The chart of accounts: one card, a section per account type, every account in a tree under
 * it with balances rolled up through the nodes. Tapping a node opens or closes it (remembered per
 * device), and its › opens its editor (a divided account's, its ledger); tapping a leaf opens its ledger. Find narrows the tree;
 * archived accounts wait behind "Show archived".
 */
export function ChartOfAccounts({ book }: { book: string }) {
  const tree = useAccountTree(book);
  const canWrite = useCanWrite(book);
  const role = useRole(book);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);

  const byName = useMemo(() => new Map((tree.data ?? []).map((a) => [a.name, a])), [tree.data]);
  const archivedCount = [...byName.values()].filter((a) => a.close).length;
  const unpriced = [...new Set(ROOTS.flatMap((r) => byName.get(r)?.unpriced ?? []))].sort();

  return (
    <main>
      <header className="page-head chart-head">
        <h1>Accounts</h1>
        {canWrite && (
          <div className="chart-actions">
            <Link href={`/books/${book}/accounts/import`} className="button">
              Import
            </Link>
            <Link href={`/books/${book}/accounts/new`} className="button primary-link">
              + Add
            </Link>
            {(role === "owner" || role === "manage") && (
              <Overflow label="More account actions">
                <Link href={`/books/${book}/migrate`} className="menu-item">
                  Migrate from another system…
                </Link>
              </Overflow>
            )}
          </div>
        )}
      </header>
      <MigrateCard book={book} />
      <input
        type="search"
        className="chart-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find an account"
        aria-label="Find an account"
      />
      {tree.isPending && <Loading />}
      {tree.error && <p className="card error">{explain(tree.error)}</p>}
      {tree.data && (
        <div className="card chart">
          <ChartTree book={book} accounts={tree.data} query={query} archived={archived} />
          {archivedCount > 0 && (
            <button
              type="button"
              className="plain chart-more"
              aria-pressed={archived}
              onClick={() => setArchived(!archived)}
            >
              {archived ? "Hide archived" : `Show archived (${archivedCount})`}
            </button>
          )}
        </div>
      )}
      <p className="small muted chart-notes">
        Balances include unconfirmed transactions.
        {unpriced.length > 0 && <> * Plus {unpriced.join(", ")}, which have no price.</>}
      </p>
    </main>
  );
}

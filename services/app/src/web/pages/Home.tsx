import type { Book } from "@fava-beans/ledger-client";
import { Link } from "wouter";

import { formatMoney } from "../lib/decimal.js";
import { formatWhen } from "../lib/format.js";
import { explain, useLastImports, useMoneyAccounts } from "../lib/queries.js";

/** The user's money accounts, with their balances and when each was last updated by an import. */
export function Home({ book }: { book: Book }) {
  const accounts = useMoneyAccounts(book.id);
  const imports = useLastImports(book.id);

  return (
    <main>
      <header className="page-head home-head">
        <div>
          <h1>{book.name}</h1>
          <p className="muted">Your accounts</p>
        </div>
        <Link href="/import" className="button primary-link">
          Import transactions
        </Link>
      </header>

      {accounts.isPending && <p className="muted">Loading…</p>}
      {accounts.error && <p className="card error">{explain(accounts.error)}</p>}
      {accounts.data?.length === 0 && (
        <p className="card done">
          No accounts yet. <Link href="/accounts/new">Add one</Link>
        </p>
      )}

      <section className="stack" aria-label="Accounts">
        {accounts.data?.map((account) => {
          const last = imports.data?.[account.name];
          return (
            <Link
              key={account.name}
              href={`/books/${book.id}/accounts/${encodeURIComponent(account.name)}`}
              className="card link account-card"
            >
              <div className="account-card-top">
                <h2>{account.display_name ?? account.name}</h2>
                <span className="balance">
                  {account.balance.length
                    ? account.balance.map((b) => formatMoney(b.number, b.currency)).join(" · ")
                    : formatMoney("0.00", account.currencies?.[0] ?? "USD")}
                </span>
              </div>
              <p className="muted small">
                {last ? `Last updated at: ${formatWhen(last)}` : "No imports yet"}
              </p>
            </Link>
          );
        })}
      </section>

      {accounts.data && accounts.data.length > 0 && (
        <p className="center">
          <Link href="/accounts/new">+ Add an account</Link>
        </p>
      )}
    </main>
  );
}

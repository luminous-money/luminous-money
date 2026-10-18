import type { Book } from "@fava-beans/ledger-client";
import { Link } from "wouter";

import { AccountValueNote, headline } from "../components/AccountValue.js";
import { JournalList } from "../components/JournalList.js";
import { PartsLine } from "../components/Parts.js";
import { SpendingThisMonth } from "../components/SpendingThisMonth.js";
import { displayName } from "../lib/accounts.js";
import { bookHome } from "../lib/books.js";
import { formatWhen } from "../lib/format.js";
import {
  explain,
  useBankStatus,
  useJournal,
  useLastImports,
  useStarredAccounts,
} from "../lib/queries.js";
import { ReportedLine } from "../components/BankStatus.js";

/** This month's spending against the budget, recent transactions, and the user's starred
 * accounts, with their balances (as shown: a card's is what's owed) and when each was last
 * updated by an import. */
export function Home({ book }: { book: Book }) {
  const accounts = useStarredAccounts(book.id);
  const imports = useLastImports(book.id);
  const bank = useBankStatus(book.id);

  return (
    <main>
      <header className="page-head home-head">
        <div>
          <h1>{book.name}</h1>
          <p className="muted">Your accounts</p>
        </div>
        {book.role !== "read" && (
          <Link href={`${bookHome(book.id)}/import`} className="button primary-link">
            Import transactions
          </Link>
        )}
      </header>

      <SpendingThisMonth book={book.id} />
      <RecentTransactions book={book.id} />

      {accounts.isPending && <p className="muted">Loading…</p>}
      {accounts.error && <p className="card error">{explain(accounts.error)}</p>}
      {accounts.data?.length === 0 && (
        <p className="card done">
          No starred accounts yet. Star one from its ledger, or{" "}
          <Link href={`${bookHome(book.id)}/accounts/new`}>add an account</Link>.
        </p>
      )}

      <section className="stack" aria-label="Accounts">
        {accounts.data
          ?.filter((account) => !account.close)
          .map((account) => {
            const last = imports.data?.[account.name];
            return (
              <Link
                key={account.name}
                href={`/books/${book.id}/accounts/${encodeURIComponent(account.name)}`}
                className="card link account-card"
              >
                <div className="account-card-top">
                  <h2>{displayName(account)}</h2>
                  <span className="balance">{headline(account)}</span>
                </div>
                <AccountValueNote account={account} />
                {account.divided && <PartsLine book={book.id} whole={account.name} />}
                {bank.data?.[account.name] && (
                  <ReportedLine status={bank.data[account.name]!} type={account.type} />
                )}
                <p className="muted small">
                  {last ? `Last updated at: ${formatWhen(last)}` : "No imports yet"}
                </p>
              </Link>
            );
          })}
      </section>

      {accounts.data && accounts.data.length > 0 && (
        <p className="center">
          <Link href={`${bookHome(book.id)}/accounts/new`}>+ Add an account</Link>
        </p>
      )}
    </main>
  );
}

/** The journal's first page, in a window of its own height; its title opens the whole journal. */
function RecentTransactions({ book }: { book: string }) {
  const pages = useJournal(book);
  const rows = pages.data?.pages[0]?.rows ?? [];
  if (pages.data && !rows.length) return null;
  return (
    <section className="recent" aria-label="Recent transactions">
      <h2 className="section-title">
        <Link href={`/books/${book}/transactions`}>Recent transactions ›</Link>
      </h2>
      {pages.error && <p className="card error">{explain(pages.error)}</p>}
      {pages.isPending ? (
        <div className="card chart-placeholder" style={{ height: 240 }} aria-busy="true" />
      ) : (
        <JournalList book={book} rows={rows} here={`/books/${book}`} label="Recent transactions" />
      )}
    </section>
  );
}

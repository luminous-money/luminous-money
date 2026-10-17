import type { Book } from "@fava-beans/ledger-client";
import { Link } from "wouter";

import { AccountValueNote, headline } from "../components/AccountValue.js";
import { BudgetBar, leftWords } from "../components/Budget.js";
import { displayName } from "../lib/accounts.js";
import { bookHome } from "../lib/books.js";
import { add, formatMoney, negate } from "../lib/decimal.js";
import { formatWhen } from "../lib/format.js";
import {
  explain,
  useBankStatus,
  useBudgetStatus,
  useLastImports,
  useStarredAccounts,
} from "../lib/queries.js";
import { ReportedLine } from "../components/BankStatus.js";

/** How this month is going against the budgets, and the user's starred accounts, with their
 * balances (as shown: a card's is what's owed) and when each was last updated by an import. */
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
        <Link href={`${bookHome(book.id)}/import`} className="button primary-link">
          Import transactions
        </Link>
      </header>

      <BudgetsThisMonth book={book.id} />

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

/** One filled line: this month's spending against the highest-level expense budgets (those with
 * no budget above them), each restated per month. Nothing without budgets. */
function BudgetsThisMonth({ book }: { book: string }) {
  const summary = useBudgetStatus(book).data?.summary;
  if (!summary) return null;
  const month = new Date(`${summary.month_start}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  });
  const left = {
    ...summary.budget,
    number: add(summary.budget.number, negate(summary.spent.number)),
  };
  return (
    <Link href={`/books/${book}/budgets`} className="card link budget-home" aria-label="Budgets">
      <div className="account-card-top">
        <h2>{month}</h2>
        <span className="num">
          {formatMoney(summary.spent.number, summary.spent.currency)}{" "}
          <span className="muted">
            of {formatMoney(summary.budget.number, summary.budget.currency)}
          </span>
        </span>
      </div>
      <BudgetBar
        kind="limit"
        budget={summary.budget}
        spent={summary.spent}
        label={`${month}'s budgets`}
      />
      <p className="muted small">{leftWords("limit", left)} of what's budgeted</p>
    </Link>
  );
}

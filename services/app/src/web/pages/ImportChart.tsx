import type { Account, Book } from "@luminous-money/ledger-client";
import { useState } from "react";
import { Link } from "wouter";

import { batchOrder, planChart } from "../../shared/chart.js";
import { ChartPreview, plural } from "../components/ChartPreview.js";
import { FileDrop } from "../components/FileDrop.js";
import { explain, useAccounts, useCreateAccounts } from "../lib/queries.js";

const EXAMPLE = `Account,Display name,Description,Opening balance,As of
Assets:Bank:PNC checking,Checking,Joint,2450.00,2026-01-31
Liabilities:Cards:Visa,,,312.18,2026-01-31
Expenses:Dining out,,Restaurants and takeout,,`;

/**
 * Import a chart of accounts: a CSV of full names and anything else an account can start with
 * (GnuCash's account tree export works as it comes). Choosing a file only shows what it would do
 * (every name as it will be, and why a row can't be added); Add opens them all in one write.
 * Accounts the book has are left as they are.
 */
export function ImportChart({ book }: { book: Book }) {
  const accounts = useAccounts(book.id);
  const create = useCreateAccounts(book.id);
  // The file, read against the accounts as they were when it was chosen (once it's added,
  // they're all here).
  const [file, setFile] = useState<{ name: string; text: string; accounts: Account[] } | null>(
    null
  );
  const [includeHidden, setIncludeHidden] = useState(false);
  const [added, setAdded] = useState<Account[] | null>(null);
  const chart = `/books/${book.id}/accounts`;
  const plan = file && planChart(file.text, file.accounts, book.currency, { includeHidden });

  const choose = async (chosen: File) => {
    const text = await chosen.text();
    setAdded(null);
    create.reset();
    setFile({ name: chosen.name, text, accounts: accounts.data ?? [] });
  };
  const add = async () => {
    if (!plan) return;
    try {
      setAdded(await create.mutateAsync(batchOrder(plan.add)));
    } catch {
      // shown from the mutation's error
    }
  };

  return (
    <main className="stack">
      <header className="page-head">
        <Link href={chart} className="back">
          ‹ Accounts
        </Link>
        <h1>Import a chart of accounts</h1>
      </header>

      {added ? (
        <section className="card" aria-label="Imported">
          <p>
            Added <strong>{plural(added.length, "account")}</strong> from {file?.name}.
          </p>
          <div className="actions">
            <button type="button" onClick={() => (setFile(null), setAdded(null))}>
              Import another
            </button>
            <Link href={chart} className="button primary-link">
              See them in Accounts
            </Link>
          </div>
        </section>
      ) : (
        <section className="card stack">
          <p>
            A CSV file with a header row and one account a row: its full name in an{" "}
            <strong>Account</strong> column, and if you like, its <strong>Display name</strong>,{" "}
            <strong>Description</strong>, <strong>Opening balance</strong> with its{" "}
            <strong>As of</strong> date (as the statement shows it: for a card, what&apos;s owed),{" "}
            <strong>Currency</strong> (else {book.currency}), <strong>Opened</strong> date,{" "}
            <strong>Booking</strong> (FIFO, LIFO, HIFO, STRICT or NONE) and{" "}
            <strong>Revalue every</strong> (days). GnuCash&apos;s account tree export (File → Export
            → Export Account Tree to CSV) works as it comes.
          </p>
          <pre className="chart-example">{EXAMPLE}</pre>
          <p className="muted small">
            Names are tidied as they come in: each word starts with a capital and spaces become
            dashes (Assets:Bank:PNC-Checking). An account with others under it holds them, not
            transactions. Accounts already here are left as they are.
          </p>
          {accounts.data ? (
            <FileDrop
              label="Chart of accounts file"
              chosen={file?.name}
              disabled={create.isPending}
              onFile={(f) => void choose(f)}
            />
          ) : (
            <p className="muted">{accounts.error ? explain(accounts.error) : "Loading…"}</p>
          )}
        </section>
      )}

      {plan && !added && (
        <ChartPreview
          plan={plan}
          hidden={{ include: includeHidden, onChange: setIncludeHidden }}
          action={
            <>
              {create.error && <p className="error">{explain(create.error)}</p>}
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!plan.add.length || create.isPending}
                  onClick={() => void add()}
                >
                  {create.isPending ? "Adding…" : `Add ${plural(plan.add.length, "account")}`}
                </button>
              </div>
            </>
          }
        />
      )}
    </main>
  );
}

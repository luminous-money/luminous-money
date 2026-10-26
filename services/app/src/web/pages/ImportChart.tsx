import type { Account, Book } from "@luminous-money/ledger-client";
import { useState, type DragEvent } from "react";
import { Link } from "wouter";

import { batchOrder, planChart, type ChartPlan } from "../lib/chartImport.js";
import { formatMoney } from "../lib/decimal.js";
import { formatDay } from "../lib/format.js";
import { explain, useAccounts, useCreateAccounts } from "../lib/queries.js";

const EXAMPLE = `Account,Display name,Description,Opening balance,As of
Assets:Bank:PNC checking,Checking,Joint,2450.00,2026-01-31
Liabilities:Cards:Visa,,,312.18,2026-01-31
Expenses:Dining out,,Restaurants and takeout,,`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Import a chart of accounts: a CSV of full names and anything else an account can start with.
 * Choosing a file only shows what it would do (every name as it will be, and why a row can't be
 * added); Add opens them all in one write. Accounts the book has are left as they are.
 */
export function ImportChart({ book }: { book: Book }) {
  const accounts = useAccounts(book.id);
  const create = useCreateAccounts(book.id);
  // What the file would do, read against the accounts as they were when it was chosen.
  const [file, setFile] = useState<{ name: string; plan: ChartPlan } | null>(null);
  const [added, setAdded] = useState<Account[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const chart = `/books/${book.id}/accounts`;
  const plan = file?.plan;

  const choose = async (chosen: File) => {
    const text = await chosen.text();
    setAdded(null);
    create.reset();
    setFile({ name: chosen.name, plan: planChart(text, accounts.data ?? [], book.currency) });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) void choose(dropped);
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
            <strong>Revalue every</strong> (days).
          </p>
          <pre className="chart-example">{EXAMPLE}</pre>
          <p className="muted small">
            Names are tidied as they come in: each word starts with a capital and spaces become
            dashes (Assets:Bank:PNC-Checking). An account with others under it holds them, not
            transactions. Accounts already here are left as they are.
          </p>
          {accounts.data ? (
            <label
              className={`dropzone${dragging ? " dragging" : ""}`}
              onDragOver={(e) => (e.preventDefault(), setDragging(true))}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="Chart of accounts file"
                disabled={create.isPending}
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  e.target.value = "";
                  if (chosen) void choose(chosen);
                }}
              />
              <span>
                {file
                  ? `${file.name} · choose another`
                  : "Drop a CSV file here, or tap to choose one"}
              </span>
            </label>
          ) : (
            <p className="muted">{accounts.error ? explain(accounts.error) : "Loading…"}</p>
          )}
        </section>
      )}

      {plan && !added && (
        <section className="stack" aria-label="What it adds">
          {plan.error ? (
            <p className="card error">{plan.error}</p>
          ) : (
            <>
              <div className="card">
                <h2 className="section-title">
                  {plan.add.length
                    ? `${plural(plan.add.length, "account")} to add`
                    : "Nothing to add"}
                </h2>
                <ul className="chart-plan">
                  {plan.add.map(({ line, written, account, balance }) => (
                    <li key={line}>
                      <strong className="chart-plan-name">{account.name}</strong>
                      {written !== account.name && (
                        <span className="muted small"> from “{written}”</span>
                      )}
                      <span className="small muted chart-plan-details">
                        {[
                          account.kind === "node" && "holds the accounts under it",
                          account.display_name && `shown as ${account.display_name}`,
                          account.description,
                          account.opening_balance &&
                            balance !== null &&
                            `${formatMoney(balance, account.opening_balance.currency)} on ${formatDay(account.opening_balance.date)}`,
                          account.open && `opens ${formatDay(account.open)}`,
                          account.booking && `sales by ${account.booking}`,
                          account.revalue_every && `revalued every ${account.revalue_every} days`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
                {plan.ignored.length > 0 && (
                  <p className="small muted">Columns not read: {plan.ignored.join(", ")}.</p>
                )}
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
              </div>
              {plan.problems.length > 0 && (
                <section className="card" aria-label="Can't be added">
                  <h2 className="section-title">
                    {plural(plan.problems.length, "row")} can&apos;t be added
                  </h2>
                  <ul className="chart-plan">
                    {plan.problems.map(({ line, written, problem }) => (
                      <li key={line}>
                        <span className="muted small">Line {line}</span>{" "}
                        {written && <strong className="chart-plan-name">{written}</strong>}
                        <span className="small error chart-plan-details">{problem}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {plan.existing.length > 0 && (
                <section className="card" aria-label="Already here">
                  <h2 className="section-title">
                    {plural(plan.existing.length, "account")} already here
                  </h2>
                  <p className="small muted">{plan.existing.map((e) => e.name).join(", ")}</p>
                </section>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}

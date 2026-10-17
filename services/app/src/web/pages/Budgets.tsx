import { useMemo, useState } from "react";
import { Link } from "wouter";

import { AccountPicker } from "../components/AccountPicker.js";
import { BudgetBar, BudgetForm, leftWords } from "../components/Budget.js";
import { displayName } from "../lib/accounts.js";
import { daysLeft } from "../lib/budgets.js";
import { formatMoney } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import type { BudgetBasis, BudgetLine } from "../lib/ledger.js";
import { explain, useAccountTree, useBudgetStatus } from "../lib/queries.js";

// Spending first: it's what most budgets are about.
const ROOTS = ["Expenses", "Income", "Assets", "Liabilities", "Equity"];

const parentOf = (name: string) => (name.includes(":") ? name.slice(0, name.lastIndexOf(":")) : "");
const money = (a: { number: string; currency: string }) => formatMoney(a.number, a.currency);

/**
 * Budgets: one card, a section per type, every budgeted account in a tree with the accounts
 * above it, each with what's gone against it this period as a filled line. A budgeted node with
 * budgets under it has an Other row: what it keeps for itself. Tapping a row opens its budget in
 * place; its › opens the account. "Per month" restates every budget on one basis.
 */
export function Budgets({ book }: { book: string }) {
  const [basis, setBasis] = useState<BudgetBasis>("period");
  const status = useBudgetStatus(book, basis);
  // The editor works from each budget's own period, whatever's shown.
  const own = useBudgetStatus(book, "period");
  const tree = useAccountTree(book);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState("");
  const on = today();

  const lines = useMemo(
    () => new Map((status.data?.lines ?? []).map((l) => [l.account, l])),
    [status.data]
  );
  const ownLines = new Map((own.data?.lines ?? []).map((l) => [l.account, l]));
  const accounts = new Map((tree.data ?? []).map((a) => [a.name, a]));
  const children = useMemo(() => {
    const shown = new Set<string>();
    for (const name of lines.keys()) {
      const parts = name.split(":");
      for (let i = 1; i <= parts.length; i++) shown.add(parts.slice(0, i).join(":"));
    }
    const kids = new Map<string, string[]>();
    for (const name of [...shown].sort())
      kids.set(parentOf(name), [...(kids.get(parentOf(name)) ?? []), name]);
    return kids;
  }, [lines]);

  const name = (account: string) => displayName(accounts.get(account) ?? { name: account });
  const editor = (account: string) => (
    <div className="budget-edit">
      <BudgetForm
        key={ownLines.get(account)?.version.updated_at ?? account}
        book={book}
        account={account}
        line={ownLines.get(account)}
        onDone={() => setEditing(null)}
      />
    </div>
  );

  /** The figures under a row's name: spent of budget, the bar, and what's left. */
  const figures = (
    kind: BudgetLine["kind"],
    budget: BudgetLine["budget"],
    spent: BudgetLine["spent"],
    detail: string,
    label: string
  ) => (
    <>
      <BudgetBar kind={kind} budget={budget} spent={spent} label={label} />
      <span className="small muted budget-detail">{detail}</span>
    </>
  );
  const amounts = (budget: BudgetLine["budget"], spent: BudgetLine["spent"]) => (
    <span className="num budget-figures">
      {money(spent)} <span className="muted">of {money(budget)}</span>
    </span>
  );

  const row = (account: string, depth: number): React.ReactNode => {
    const line = lines.get(account);
    const kids = children.get(account) ?? [];
    const found = accounts.get(account);
    const href = `/books/${book}/accounts/${encodeURIComponent(account)}`;
    const open = editing === account;
    return (
      <li key={account}>
        <div className={`budget-row${line ? "" : " unbudgeted"}`}>
          {/* The whole row is the tap target; the button is what's reachable and named. */}
          <div
            className="budget-main"
            style={{ "--depth": depth } as React.CSSProperties}
            onClick={() => setEditing(open ? null : account)}
          >
            <button
              type="button"
              className="budget-toggle"
              aria-expanded={open}
              aria-label={`${line ? "Change" : "Set"} the budget for ${account}`}
            >
              <span className="budget-name">{name(account)}</span>
              {line && amounts(line.budget, line.spent)}
            </button>
            {line &&
              figures(
                line.kind,
                line.budget,
                line.spent,
                leftWords(line.kind, line.left, {
                  days: daysLeft(line, on),
                  unconfirmed: line.unconfirmed,
                }),
                `${account}'s budget`
              )}
            {line?.problems.map((p) => (
              <span key={p} className="small warning budget-detail">
                {p}
              </span>
            ))}
          </div>
          {depth > 0 ? (
            <Link
              href={found?.kind === "node" ? `${href}/edit` : href}
              className="chart-open"
              aria-label={`Open ${account}`}
            >
              ›
            </Link>
          ) : (
            <span className="chart-open" aria-hidden />
          )}
        </div>
        {open && editor(account)}
        {(kids.length > 0 || line?.other) && (
          <ul>
            {kids.map((k) => row(k, depth + 1))}
            {line?.other && (
              <li key={`${account}:other`}>
                <div className="budget-row other" aria-label={`Other in ${account}`} role="group">
                  <span
                    className="budget-main"
                    style={{ "--depth": depth + 1 } as React.CSSProperties}
                  >
                    <span className="budget-toggle">
                      <span className="budget-name">Other</span>
                      {amounts(line.other.budget, line.other.spent)}
                    </span>
                    {figures(
                      line.kind,
                      line.other.budget,
                      line.other.spent,
                      leftWords(line.kind, line.other.left),
                      `Other in ${account}`
                    )}
                  </span>
                  <span className="chart-open" aria-hidden />
                </div>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const roots = ROOTS.filter((r) => children.get("")?.includes(r));
  const choices = (tree.data ?? []).filter((a) => !a.close && a.type).map((a) => a.name);
  return (
    <main>
      <header className="page-head chart-head">
        <h1>Budgets</h1>
        <button
          type="button"
          className="primary"
          onClick={() => (setAdding(!adding), setPicked(""))}
        >
          {adding ? "Cancel" : "+ Add"}
        </button>
      </header>
      {adding && (
        <section className="card editor" aria-label="Add a budget">
          <div className="picker-field">
            <span className="small muted">Budget for</span>
            <AccountPicker
              label="Budget for"
              accounts={choices}
              value={picked}
              onChange={setPicked}
            />
          </div>
          {picked && (
            <BudgetForm
              key={picked}
              book={book}
              account={picked}
              line={ownLines.get(picked)}
              onDone={() => (setAdding(false), setPicked(""))}
            />
          )}
        </section>
      )}
      <div className="segmented budget-basis" role="radiogroup" aria-label="Show">
        {(
          [
            ["period", "Each its own period"],
            ["month", "Per month"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={basis === value}
            className={basis === value ? "on" : ""}
            onClick={() => setBasis(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {status.isPending && <p className="muted">Loading…</p>}
      {status.error && <p className="card error">{explain(status.error)}</p>}
      {status.data && roots.length === 0 && (
        <p className="card muted">
          No budgets yet. Add one for any account: a limit on what's spent, or a goal for what comes
          in or is saved.
        </p>
      )}
      {roots.length > 0 && (
        <div className="card chart budgets">
          {roots.map((root) => (
            <section key={root} aria-label={root} className="chart-section">
              <ul>{row(root, 0)}</ul>
            </section>
          ))}
        </div>
      )}
      {roots.length > 0 && (
        <p className="small muted chart-notes">
          {basis === "month"
            ? "Every budget restated per month, against this month so far."
            : "Each budget over its own current period."}{" "}
          Unconfirmed transactions count.
        </p>
      )}
    </main>
  );
}

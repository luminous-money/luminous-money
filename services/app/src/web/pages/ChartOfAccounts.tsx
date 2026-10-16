import { useMemo, useState } from "react";
import { Link } from "wouter";

import { displayName, shown } from "../lib/accounts.js";
import { formatMoney } from "../lib/decimal.js";
import type { TreeAccount } from "../lib/ledger.js";
import { explain, useAccountTree, useBankStatus, useStars } from "../lib/queries.js";

const ROOTS = ["Assets", "Liabilities", "Equity", "Income", "Expenses"];

/** Which nodes are open, per book and device. Top-level accounts start open. */
function useExpanded(book: string) {
  const key = `fava-beans:chart:${book}`;
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(key);
      return new Set(saved ? (JSON.parse(saved) as string[]) : ROOTS);
    } catch {
      return new Set(ROOTS);
    }
  });
  const toggle = (name: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      localStorage.setItem(key, JSON.stringify([...next]));
      return next;
    });
  return { open, toggle };
}

/** An account's figure: its subtree's value in the operating currency (holdings at market). As
 * shown: liabilities and income inverted. */
function figure(account: TreeAccount): string {
  return formatMoney(shown(account.value.number, account.type), account.value.currency);
}

/**
 * The chart of accounts: every account in a tree by type, nodes collapsible (remembered per
 * device), balances rolled up through them. A leaf opens its ledger; a node's name opens its
 * editor. Find narrows the tree; archived accounts wait behind "Show archived".
 */
export function ChartOfAccounts({ book }: { book: string }) {
  const tree = useAccountTree(book);
  const stars = useStars(book);
  const bank = useBankStatus(book);
  const { open, toggle } = useExpanded(book);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);

  const { children, byName } = useMemo(() => {
    const byName = new Map((tree.data ?? []).map((a) => [a.name, a]));
    const children = new Map<string, TreeAccount[]>();
    for (const a of [...byName.values()].sort((x, y) => x.name.localeCompare(y.name))) {
      const parent = a.name.includes(":") ? a.name.slice(0, a.name.lastIndexOf(":")) : "";
      children.set(parent, [...(children.get(parent) ?? []), a]);
    }
    return { children, byName };
  }, [tree.data]);

  // What's shown: archived accounts only if asked; with a query, matches and their ancestors.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shownNames = new Set<string>();
    for (const a of byName.values()) {
      if (!archived && a.close) continue;
      const matches =
        !q || a.name.toLowerCase().includes(q) || displayName(a).toLowerCase().includes(q);
      if (!matches) continue;
      shownNames.add(a.name);
      const parts = a.name.split(":");
      for (let i = 1; i < parts.length; i++) shownNames.add(parts.slice(0, i).join(":"));
    }
    return shownNames;
  }, [byName, query, archived]);

  const starred = new Set(stars.data ?? []);
  const linked = new Set(Object.keys(bank.data ?? {}));

  const row = (a: TreeAccount, depth: number): React.ReactNode => {
    if (!visible.has(a.name)) return null;
    const kids = (children.get(a.name) ?? []).filter((k) => visible.has(k.name));
    const isOpen = !!query.trim() || open.has(a.name);
    const node = a.kind === "node" || kids.length > 0;
    const href = `/books/${book}/accounts/${encodeURIComponent(a.name)}`;
    return (
      <li key={a.name}>
        <div className="chart-row" style={{ paddingLeft: `${depth * 1.1}rem` }}>
          {node ? (
            <button
              type="button"
              className="plain chart-toggle"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${a.name}`}
              onClick={() => toggle(a.name)}
            >
              {isOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span className="chart-toggle" aria-hidden />
          )}
          <Link
            href={node && !ROOTS.includes(a.name) ? `${href}/edit` : href}
            className="chart-name"
            title={a.name}
          >
            {displayName(a)}
          </Link>
          {starred.has(a.name) && (
            <span className="muted small" aria-label="starred">
              {" "}
              ★
            </span>
          )}
          {linked.has(a.name) && <span className="pill">linked</span>}
          {a.close && <span className="pill stale">archived</span>}
          {a.protected && !ROOTS.includes(a.name) && <span className="pill">system</span>}
          <span className="num chart-balance">
            {figure(a)}
            {(a.unpriced ?? []).length > 0 && (
              <span className="muted small block" title={(a.unpriced ?? []).join(", ")}>
                + {(a.unpriced ?? []).length} unpriced
              </span>
            )}
          </span>
          {node && (
            <Link
              href={`/books/${book}/accounts/new?under=${encodeURIComponent(a.name)}`}
              className="plain small chart-add"
              aria-label={`Add an account under ${a.name}`}
            >
              +
            </Link>
          )}
        </div>
        {node && isOpen && kids.length > 0 && (
          <ul className="chart-list">{kids.map((k) => row(k, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <main>
      <header className="page-head home-head">
        <div>
          <h1>Accounts</h1>
          <p className="muted">Balances include pending transactions.</p>
        </div>
        <Link href={`/books/${book}/accounts/new`} className="button primary-link">
          Add an account
        </Link>
      </header>
      <div className="chart-tools">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an account"
          aria-label="Find an account"
        />
        <label className="check small">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>
      {tree.isPending && <p className="muted">Loading…</p>}
      {tree.error && <p className="card error">{explain(tree.error)}</p>}
      {ROOTS.map((root) => {
        const account = byName.get(root);
        return (
          account &&
          visible.has(root) && (
            <section key={root} className="card chart" aria-label={root}>
              <ul className="chart-list">{row(account, 0)}</ul>
            </section>
          )
        );
      })}
    </main>
  );
}

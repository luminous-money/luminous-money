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

/** An account's figure: its subtree's value in the operating currency (holdings at market), as
 * shown (liabilities and income inverted), marked when some of it has no price to value it by. */
function Figure({ account }: { account: TreeAccount }) {
  const unpriced = account.unpriced ?? [];
  return (
    <span className={`num chart-balance${Number(account.value.number) === 0 ? " muted" : ""}`}>
      {formatMoney(shown(account.value.number, account.type), account.value.currency)}
      {unpriced.length > 0 && (
        <sup className="muted" aria-label={`plus ${unpriced.join(", ")}, which have no price`}>
          *
        </sup>
      )}
    </span>
  );
}

/**
 * The chart of accounts: one card, a section per account type, every account in a tree under
 * it with balances rolled up through the nodes. Tapping a node opens or closes it (remembered per
 * device), and its › opens its editor; tapping a leaf opens its ledger. Find narrows the tree;
 * archived accounts wait behind "Show archived".
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

  const archivedCount = [...byName.values()].filter((a) => a.close).length;
  const unpriced = [...new Set(ROOTS.flatMap((r) => byName.get(r)?.unpriced ?? []))].sort();
  const starred = new Set(stars.data ?? []);
  const linked = new Set(Object.keys(bank.data ?? {}));

  const label = (a: TreeAccount) => (
    <span className="chart-name">
      <span className="chart-label" title={a.name}>
        {displayName(a)}
      </span>
      {starred.has(a.name) && (
        <span className="muted" aria-label="starred">
          ★
        </span>
      )}
      {linked.has(a.name) && <span className="pill">linked</span>}
      {a.close && <span className="pill stale">archived</span>}
      {a.protected && !ROOTS.includes(a.name) && <span className="pill">system</span>}
    </span>
  );

  const row = (a: TreeAccount, depth: number): React.ReactNode => {
    if (!visible.has(a.name)) return null;
    const kids = (children.get(a.name) ?? []).filter((k) => visible.has(k.name));
    const isOpen = !!query.trim() || open.has(a.name);
    const href = `/books/${book}/accounts/${encodeURIComponent(a.name)}`;
    const indent = { "--depth": depth } as React.CSSProperties;
    // A node, or a leaf that (from an imported ledger) has accounts under it.
    if (a.kind === "node" || kids.length > 0)
      return (
        <li key={a.name}>
          <div className="chart-row">
            <button
              type="button"
              className="chart-main"
              style={indent}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${a.name}`}
              onClick={() => toggle(a.name)}
            >
              <span className="chart-chevron" aria-hidden>
                {isOpen ? "▾" : "▸"}
              </span>
              {label(a)}
              <Figure account={a} />
            </button>
            {depth > 0 ? (
              <Link
                href={a.kind === "node" ? `${href}/edit` : href}
                className="chart-open"
                aria-label={`Open ${a.name}`}
              >
                ›
              </Link>
            ) : (
              <span className="chart-open" aria-hidden />
            )}
          </div>
          {isOpen && kids.length > 0 && <ul>{kids.map((k) => row(k, depth + 1))}</ul>}
        </li>
      );
    return (
      <li key={a.name}>
        <Link href={href} className="chart-row chart-leaf">
          <span className="chart-main" style={indent}>
            <span className="chart-chevron" aria-hidden />
            {label(a)}
            <Figure account={a} />
          </span>
          <span className="chart-open" aria-hidden>
            ›
          </span>
        </Link>
      </li>
    );
  };

  const roots = ROOTS.map((r) => byName.get(r)).filter(
    (a): a is TreeAccount => !!a && visible.has(a.name)
  );
  return (
    <main>
      <header className="page-head chart-head">
        <h1>Accounts</h1>
        <Link href={`/books/${book}/accounts/new`} className="button primary-link">
          + Add
        </Link>
      </header>
      <input
        type="search"
        className="chart-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find an account"
        aria-label="Find an account"
      />
      {tree.isPending && <p className="muted">Loading…</p>}
      {tree.error && <p className="card error">{explain(tree.error)}</p>}
      {tree.data && (
        <div className="card chart">
          {roots.map((root) => (
            <section key={root.name} aria-label={root.name} className="chart-section">
              <ul>{row(root, 0)}</ul>
            </section>
          ))}
          {roots.length === 0 && <p className="muted chart-empty">No accounts match.</p>}
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
        Balances include pending transactions.
        {unpriced.length > 0 && <> * Plus {unpriced.join(", ")}, which have no price.</>}
      </p>
    </main>
  );
}

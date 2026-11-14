import { useMemo, useState } from "react";
import { Link } from "wouter";

import { displayName, shown } from "../lib/accounts.js";
import { formatMoney } from "../lib/decimal.js";
import type { TreeAccount } from "../lib/ledger.js";
import { useBankStatus, useStars } from "../lib/queries.js";

export const ROOTS = ["Assets", "Liabilities", "Equity", "Income", "Expenses"];

/** Which nodes are open, per book and device. Top-level accounts start open. */
export function useExpanded(book: string) {
  const key = `luminous-money:chart:${book}`;
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
 * Accounts as a tree, balances rolled up through the nodes: the whole chart (a section per
 * top-level account), or the accounts under one (`under`: an account's page). Tapping a node
 * opens or closes it (remembered per device, the chart's and an account's page alike), and its ›
 * opens its page (a divided account's, its ledger); tapping a leaf opens its ledger. `query`
 * narrows it to matches and their parents; archived accounts only when `archived`.
 */
export function ChartTree({
  book,
  accounts,
  under,
  query = "",
  archived = false,
}: {
  book: string;
  accounts: TreeAccount[];
  under?: string;
  query?: string;
  archived?: boolean;
}) {
  const stars = useStars(book);
  const bank = useBankStatus(book);
  const { open, toggle } = useExpanded(book);

  const { children, byName } = useMemo(() => {
    const byName = new Map(accounts.map((a) => [a.name, a]));
    const children = new Map<string, TreeAccount[]>();
    for (const a of [...byName.values()].sort((x, y) => x.name.localeCompare(y.name))) {
      const parent = a.name.includes(":") ? a.name.slice(0, a.name.lastIndexOf(":")) : "";
      children.set(parent, [...(children.get(parent) ?? []), a]);
    }
    return { children, byName };
  }, [accounts]);

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
      {a.divided && <span className="pill">divided</span>}
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
                // A divided account is one real account (M15): its ledger, as a leaf's.
                href={a.kind === "node" && !a.divided ? `${href}/edit` : href}
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

  if (under) {
    const kids = (children.get(under) ?? []).filter((k) => visible.has(k.name));
    if (!kids.length) return <p className="muted chart-empty">No accounts under it.</p>;
    // Indented as they'd be in the chart, less the levels above: the page is the account's.
    return <ul className="chart-slice">{kids.map((k) => row(k, 1))}</ul>;
  }
  const roots = ROOTS.map((r) => byName.get(r)).filter(
    (a): a is TreeAccount => !!a && visible.has(a.name)
  );
  if (!roots.length) return <p className="muted chart-empty">No accounts match.</p>;
  return (
    <>
      {roots.map((root) => (
        <section key={root.name} aria-label={root.name} className="chart-section">
          <ul>{row(root, 0)}</ul>
        </section>
      ))}
    </>
  );
}

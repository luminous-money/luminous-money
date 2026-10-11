import { useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";

import { shortName } from "../lib/accounts.js";
import { formatMoney, isNegative } from "../lib/decimal.js";
import { explain, useAccountLedger, useMoneyAccounts } from "../lib/queries.js";

/**
 * One account's ledger: every transaction, newest first, 200 at a time, more loading as you
 * scroll. A simple transaction shows the account on its other side; one with more splits shows
 * <multiple>. Tapping one opens it; the line at the bottom adds a new one.
 */
export function AccountLedger({ book, account }: { book: string; account: string }) {
  const [, navigate] = useLocation();
  const ledger = useAccountLedger(book, account);
  const money = useMoneyAccounts(book);
  const info = money.data?.find((a) => a.name === account);
  const end = useRef<HTMLDivElement>(null);
  const here = `/books/${book}/accounts/${encodeURIComponent(account)}`;

  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && ledger.hasNextPage && !ledger.isFetchingNextPage)
        void ledger.fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ledger]);

  const rows = ledger.data?.pages.flatMap((page) => page.rows) ?? [];
  const open = (id: string) =>
    navigate(`/books/${book}/transactions/${id}?back=${encodeURIComponent(here)}`);

  return (
    <main className="ledger-page">
      <header className="page-head">
        <Link href="/" className="back">
          ‹ Home
        </Link>
        <h1>{info?.display_name ?? shortName(account)}</h1>
        {info && (
          <p className="muted">
            {info.balance.map((b) => formatMoney(b.number, b.currency)).join(" · ") ||
              formatMoney("0.00", info.currencies?.[0] ?? "USD")}
          </p>
        )}
      </header>

      {ledger.isPending && <p className="muted">Loading…</p>}
      {ledger.error && <p className="card error">{explain(ledger.error)}</p>}
      {ledger.data && rows.length === 0 && <p className="card muted">No transactions yet.</p>}

      <ol className="ledger" aria-label="Transactions">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={`ledger-row${row.flag === "!" ? " pending" : ""}`}
              onClick={() => open(row.id)}
            >
              <span className="ledger-date">{row.date}</span>
              <span className="ledger-what">
                <span className="ledger-payee">
                  {row.payee ?? row.narration ?? "(no description)"}
                </span>
                <span className="ledger-account muted">
                  {row.counterpart ? shortName(row.counterpart) : "<multiple>"}
                  {row.flag === "!" && " · pending"}
                </span>
              </span>
              <span className="ledger-numbers">
                <span
                  className={`amount ${row.amount && !isNegative(row.amount.number) ? "in" : "out"}`}
                >
                  {row.amount ? formatMoney(row.amount.number, row.amount.currency) : "?"}
                </span>
                <span className="muted small">
                  {row.balance ? formatMoney(row.balance.number, row.balance.currency) : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div ref={end} className="ledger-end">
        {ledger.isFetchingNextPage && <span className="muted">Loading more…</span>}
      </div>

      <div className="ledger-add">
        <button
          type="button"
          className="primary"
          onClick={() =>
            navigate(
              `/books/${book}/transactions/new?account=${encodeURIComponent(account)}&back=${encodeURIComponent(here)}`
            )
          }
        >
          + Add transaction
        </button>
      </div>
    </main>
  );
}

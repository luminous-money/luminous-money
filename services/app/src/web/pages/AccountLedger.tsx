import { useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";

import { displayName, shortName, shown } from "../lib/accounts.js";
import { formatMoney, isNegative } from "../lib/decimal.js";
import { withBack } from "../lib/navigation.js";
import {
  explain,
  useAccountLedger,
  useScheduled,
  useSetStar,
  useStars,
  useSummary,
  useUpcoming,
} from "../lib/queries.js";
import { upcomingFor } from "../lib/upcoming.js";

/**
 * One account's ledger: every transaction, newest first, 200 at a time, more loading as you
 * scroll. A simple transaction shows the account on its other side; one with more splits shows
 * <multiple>. Tapping one opens it; the line above them adds a new one. Its header stars the
 * account (putting it on the home page) and links to importing into it. Amounts and balances
 * are shown as the account reads (a card's balance is what's owed); colors follow the stored
 * sign, the effect on net worth. Transactions a schedule staged are marked ↻, and its
 * occurrences coming in the next 30 days show above, grayed, with the projected balance.
 */
export function AccountLedger({ book, account }: { book: string; account: string }) {
  const [, navigate] = useLocation();
  const ledger = useAccountLedger(book, account);
  const summary = useSummary(book, [account]);
  const info = summary.data?.[0];
  const stars = useStars(book);
  const setStar = useSetStar(book);
  const scheduled = useScheduled(book);
  const upcoming = useUpcoming(book);
  const ahead = upcoming.data && info ? upcomingFor(upcoming.data, account, info.balance) : [];
  const starred = stars.data?.includes(account) ?? false;
  const type = info?.type;
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
  const open = (id: string) => navigate(withBack(`/books/${book}/transactions/${id}`, here));

  return (
    <main>
      <header className="page-head">
        <Link href="/" className="back">
          ‹ Home
        </Link>
        <div className="home-head">
          <div>
            <h1>
              {displayName(info ?? { name: account })}{" "}
              <button
                type="button"
                className={`star${starred ? " on" : ""}`}
                aria-pressed={starred}
                aria-label="Starred"
                title={starred ? "Starred: on the home page" : "Star: show on the home page"}
                disabled={!stars.data || setStar.isPending}
                onClick={() => setStar.mutate({ account, starred: !starred })}
              >
                {starred ? "★" : "☆"}
              </button>
            </h1>
            {info && (
              <p className="muted">
                {info.balance
                  .map((b) => formatMoney(shown(b.number, type), b.currency))
                  .join(" · ") || formatMoney("0.00", info.currencies?.[0] ?? "USD")}
              </p>
            )}
          </div>
          {info?.kind === "leaf" && !info.implicit && !info.close && (
            <Link
              href={withBack(`/books/${book}/import?account=${encodeURIComponent(account)}`, here)}
              className="button"
            >
              Import transactions
            </Link>
          )}
        </div>
      </header>

      <div className="ledger-add">
        <button
          type="button"
          className="primary"
          onClick={() =>
            navigate(
              withBack(
                `/books/${book}/transactions/new?account=${encodeURIComponent(account)}`,
                here
              )
            )
          }
        >
          + Add transaction
        </button>
      </div>

      {ledger.isPending && <p className="muted">Loading…</p>}
      {ledger.error && <p className="card error">{explain(ledger.error)}</p>}
      {ledger.data && rows.length === 0 && <p className="card muted">No transactions yet.</p>}

      {ahead.length > 0 && (
        <ol className="ledger upcoming-rows" aria-label="Upcoming">
          {ahead.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                className="ledger-row"
                onClick={() =>
                  navigate(withBack(`/books/${book}/schedules/${row.schedule_id}`, here))
                }
              >
                <span className="ledger-date">{row.date}</span>
                <span className="ledger-what">
                  <span className="ledger-payee">{row.label}</span>
                  <span className="ledger-account muted">↻ upcoming</span>
                </span>
                <span className="ledger-numbers">
                  <span className="amount">
                    {row.amount
                      ? formatMoney(shown(row.amount.number, type), row.amount.currency)
                      : "?"}
                  </span>
                  <span className="muted small">
                    {row.balance
                      ? `projected ${formatMoney(shown(row.balance.number, type), row.balance.currency)}`
                      : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

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
                  {scheduled.data?.[row.id] && (
                    <span
                      className="scheduled"
                      role="img"
                      aria-label="Scheduled"
                      title="From a schedule"
                    >
                      ↻{" "}
                    </span>
                  )}
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
                  {row.amount
                    ? formatMoney(shown(row.amount.number, type), row.amount.currency)
                    : "?"}
                </span>
                <span className="muted small">
                  {row.balance
                    ? formatMoney(shown(row.balance.number, type), row.balance.currency)
                    : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div ref={end} className="ledger-end">
        {ledger.isFetchingNextPage && <span className="muted">Loading more…</span>}
      </div>
    </main>
  );
}

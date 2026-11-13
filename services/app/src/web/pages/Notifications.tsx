/**
 * Notifications (Funds B): what needs attention in the book, in the order it was added, oldest
 * first. Each says what happened, when, and what to do, and opens what needs fixing. Some can be
 * dismissed (a bank feed's problem, which its accounts' pages and Bank connections go on saying);
 * others go once what's wrong is fixed (a sale that needs a fund, a shop's login).
 */
import type { Notification } from "../../shared/notifications.js";
import { Link } from "wouter";

import { displayName } from "../lib/accounts.js";
import { formatDay } from "../lib/format.js";
import { useBack, withBack } from "../lib/navigation.js";
import { explain, useAccounts, useDismissNotification, useNotifications } from "../lib/queries.js";
import { bookHome } from "../lib/books.js";

export function NotificationsPage({ book }: { book: string }) {
  const queue = useNotifications(book);
  const dismiss = useDismissNotification(book);
  const back = useBack(bookHome(book));
  const here = `/books/${book}/notifications`;
  const items = queue.data ?? [];
  return (
    <main>
      <header className="page-head">
        <Link href={back} className="back">
          ‹ Back
        </Link>
        <h1>Notifications</h1>
        <p className="muted">What needs you, oldest first</p>
      </header>
      {queue.isPending && <p className="muted">Loading…</p>}
      {queue.error && <p className="card error">{explain(queue.error)}</p>}
      {queue.data && items.length === 0 && (
        <p className="card done">Nothing needs you right now.</p>
      )}
      {items.length > 0 && (
        <ol className="stack notifications" aria-label="Notifications">
          {items.map((n) => (
            <li key={n.id} className="card notification">
              <div className="account-card-top">
                <h2>{n.title}</h2>
                <span className="small muted">{formatDay(n.added.slice(0, 10))}</span>
              </div>
              <p>{n.detail}</p>
              {n.kind === "bank-feed" ? (
                <BankFeedLinks book={book} here={here} notification={n} />
              ) : n.href ? (
                <p className="small">
                  <Link href={n.href}>Log in again ›</Link>
                </p>
              ) : (
                <p className="small">
                  <Link
                    href={withBack(
                      `/books/${book}/review?only=${encodeURIComponent(n.transaction_id ?? "")}`,
                      here
                    )}
                  >
                    Give it a fund in review ›
                  </Link>{" "}
                  <span className="muted">or</span>{" "}
                  <Link href={withBack(`/books/${book}/transactions/${n.transaction_id}`, here)}>
                    open it
                  </Link>
                </p>
              )}
              {n.dismissable ? (
                <div className="actions">
                  <button
                    type="button"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate(n.id)}
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <p className="small muted">Goes once it&apos;s fixed.</p>
              )}
            </li>
          ))}
        </ol>
      )}
      {dismiss.error && <p className="card error">{explain(dismiss.error)}</p>}
    </main>
  );
}

/** A bank feed's problem: the accounts it names, if any (each page says so until it's fixed),
 * its connection on Bank connections, and SimpleFIN Bridge, where connections are fixed. */
function BankFeedLinks({
  book,
  here,
  notification: n,
}: {
  book: string;
  here: string;
  notification: Notification;
}) {
  const accounts = useAccounts(book).data;
  const name = (account: string) =>
    displayName(accounts?.find((a) => a.name === account) ?? { name: account });
  return (
    <>
      {!!n.accounts?.length && (
        <p className="small">
          About{" "}
          {n.accounts.map((account, i) => (
            <span key={account}>
              {i > 0 && ", "}
              <Link href={withBack(`/books/${book}/accounts/${encodeURIComponent(account)}`, here)}>
                {name(account)}
              </Link>
            </span>
          ))}
        </p>
      )}
      <p className="small">
        {n.external && (
          <>
            <a href={n.external.url} target="_blank" rel="noreferrer">
              {n.external.label}
            </a>{" "}
            <span className="muted">or</span>{" "}
          </>
        )}
        <Link href={withBack(n.href ?? `/books/${book}/connections`, here)}>
          See the connection ›
        </Link>
      </p>
    </>
  );
}

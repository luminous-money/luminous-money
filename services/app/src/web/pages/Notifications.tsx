/**
 * Notifications (Funds B): what needs attention in the book, in the order it was added, oldest
 * first. Each says what happened, when, and what to do, and opens what needs fixing. Some can be
 * dismissed; others go once what's wrong is fixed (step 1's one kind, a sale that needs a fund).
 */
import { Link } from "wouter";

import { formatDay } from "../lib/format.js";
import { useBack, withBack } from "../lib/navigation.js";
import { explain, useNotifications } from "../lib/queries.js";
import { bookHome } from "../lib/books.js";

export function NotificationsPage({ book }: { book: string }) {
  const queue = useNotifications(book);
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
              {n.href ? (
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
              {!n.dismissable && <p className="small muted">Goes once it&apos;s fixed.</p>}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

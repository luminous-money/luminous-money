/**
 * Notifications (Funds B): the queue the bell opens. A notification that waits on a condition
 * isn't stored: it's read from the condition each time, so a fix made anywhere clears it. What's
 * kept is who dismissed which (`AppDb.dismissed`), for those that can be.
 */
import { createHash } from "node:crypto";

import type { LedgerPort, ShortTransaction } from "./ledger.js";
import { concerns, explainError, isNotice } from "./simplefin/client.js";
import type { SimplefinStore } from "./simplefin/store.js";
import type { Notification } from "../shared/notifications.js";

const said = (n: { number: string; currency: string }) =>
  `${n.number.replace(/^-/, "")} ${n.currency}`;

/** A transaction that takes shares a fund doesn't have, as the queue words it. */
export function needsFund(t: ShortTransaction): Notification {
  const what = t.payee || t.narration || "A transaction";
  const takes = t.takes
    .map((s) => `${said(s.amount)} from ${s.fund}, which is ${said(s.holding)} short`)
    .join("; and ");
  return {
    id: `needs-fund:${t.id}`,
    kind: "needs-fund",
    added: t.added,
    dismissable: false,
    title: "A sale needs a fund",
    detail: `${what} takes ${takes}. Say which fund's shares they are.`,
    transaction_id: t.id,
    date: t.date,
  };
}

/** The book's queue, oldest first. */
export async function notifications(ledger: LedgerPort, book: string): Promise<Notification[]> {
  const found = (await ledger.shortTransactions(book)).map(needsFund);
  return found.sort((a, b) => a.added.localeCompare(b.added));
}

/**
 * Each problem a bank feed in the book has (not the Bridge's notices), for as long as its syncs
 * report it: one a sync stops reporting goes, and one that comes back is new (its `since`), so a
 * dismissal lasts only while it does. One that names an account (`account_id`) is about that
 * account; anything else, the Bridge's plain strings included, is its connection's, named as Bank
 * connections names it, and links there.
 */
export function bankNotifications(store: SimplefinStore, book: string): Notification[] {
  const links = store.linksIn(book);
  const found: Notification[] = [];
  for (const connectionId of new Set(links.map((l) => l.connection_id))) {
    const mine = links.filter((l) => l.connection_id === connectionId);
    const connection = store.connection(mine[0]!.user_id, connectionId);
    if (!connection) continue;
    for (const error of connection.errors) {
      if (isNotice(error)) continue;
      const since = error.since ?? connection.last_sync_at ?? connection.created_at;
      const about = mine.filter((l) => concerns(error, l));
      const institution = about
        .map((l) => store.account(connectionId, l.account_id)?.institution)
        .find(Boolean);
      const digest = createHash("sha256")
        .update(JSON.stringify([since, error.code, error.message, error.account_id]))
        .digest("hex")
        .slice(0, 16);
      found.push({
        id: `bank-feed:${connectionId}:${digest}`,
        kind: "bank-feed",
        added: since,
        dismissable: true,
        title: institution
          ? error.code.startsWith("con.auth")
            ? `${institution} wants you to log in again`
            : `${institution} has a problem`
          : `SimpleFIN ${connectionId.slice(0, 8)} needs attention`,
        detail: explainError(error),
        href: `/books/${book}/connections?connection=${connectionId}`,
        accounts: about.map((l) => l.account),
        external: { label: "Open SimpleFIN Bridge", url: "https://bridge.simplefin.org/" },
      });
    }
  }
  return found;
}

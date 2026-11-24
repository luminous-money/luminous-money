/**
 * Notifications (Funds B): the queue the bell opens. A notification that waits on a condition
 * isn't stored: it's read from the condition each time, so a fix made anywhere clears it. What's
 * kept is who dismissed which (`AppDb.dismissed`), for those that can be.
 */
import { createHash } from "node:crypto";

import type { LedgerPort, ShortTransaction } from "./ledger.js";
import { concerns, explainError, isNotice } from "./simplefin/client.js";
import { errorsIn, type SimplefinStore } from "./simplefin/store.js";
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
 * What the book's bank feeds need, for `viewer`, for as long as it lasts:
 *
 * - **Each problem** (not the Bridge's notices) its syncs report, where it's for them to see
 *   (`errorsIn`: one naming an account where the account's shared, one about the connection
 *   where it's shared with all its accounts, or to its owner). One a sync stops reporting goes,
 *   and one that comes back is new (its `since`), so a dismissal lasts only while it does. One
 *   naming an account linked here is about that account; anything else is its connection's,
 *   named as Bank connections names it, and links there.
 * - **A new bank account** on a connection shared with all its accounts (one that turned up since
 *   that was chosen), until it's linked somewhere.
 */
export function bankNotifications(
  store: SimplefinStore,
  book: string,
  viewer: string
): Notification[] {
  const links = store.linksIn(book);
  const shares = new Map(store.sharesIn(book).map((s) => [s.connection_id, s]));
  const found: Notification[] = [];
  for (const connectionId of new Set([...shares.keys(), ...links.map((l) => l.connection_id)])) {
    const connection = store.connectionById(connectionId);
    if (!connection) continue;
    const share = shares.get(connectionId);
    const mine = links.filter((l) => l.connection_id === connectionId);
    const href = `/books/${book}/connections?connection=${connectionId}`;
    for (const error of errorsIn(connection, share, viewer)) {
      if (isNotice(error)) continue;
      const since = error.since ?? connection.last_sync_at ?? connection.created_at;
      const about = mine.filter((l) => concerns(error, l));
      const institution = error.account_id
        ? store.account(connectionId, error.account_id)?.institution
        : undefined;
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
        href,
        accounts: about.map((l) => l.account),
        external: { label: "Open SimpleFIN Bridge", url: "https://bridge.simplefin.org/" },
      });
    }
    if (!share?.all) continue;
    const linked = new Set([
      ...store.links(connectionId).map((l) => l.account_id),
      ...store.attemptsIn(book).map((a) => a.account_id),
    ]);
    for (const account of store.accounts(connectionId)) {
      // New since it was shared all its accounts (or that was last saved): not what was there.
      if (linked.has(account.account_id) || account.created_at <= share.updated_at) continue;
      const name = [account.institution, account.name].filter(Boolean).join(" ");
      found.push({
        id: `bank-account:${connectionId}:${account.account_id}`,
        kind: "bank-account",
        added: account.created_at,
        dismissable: true,
        title: `New at SimpleFIN: ${name}`,
        detail:
          "Its connection is shared with this book, all its accounts. Link it to an account here to bring its transactions in.",
        href,
      });
    }
  }
  return found;
}

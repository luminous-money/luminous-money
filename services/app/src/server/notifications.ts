/**
 * Notifications (Funds B): the queue the bell opens. A notification that waits on a condition
 * isn't stored: it's read from the condition each time, so a fix made anywhere clears it.
 */
import type { LedgerPort, ShortTransaction } from "./ledger.js";
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

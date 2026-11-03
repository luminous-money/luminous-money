/**
 * Notifications (Funds B): what in a book needs someone's attention, oldest first, behind the
 * masthead's bell. Some can be dismissed; others go only when what's wrong is fixed. Step 1 has
 * one kind: a sale (or anything else that came in by itself) that takes a share a fund doesn't
 * have, which goes once the transaction is saved with a fund that has it.
 */
export type Notification = {
  /** Stable while it lasts: the kind and what it's about. */
  id: string;
  kind: "needs-fund";
  /** When it was added (ISO 8601): the queue's order. */
  added: string;
  /** Whether it can be dismissed; if not, it goes once it's fixed. */
  dismissable: boolean;
  title: string;
  detail: string;
  /** The transaction to open, to fix it. */
  transaction_id: string;
  /** That transaction's date. */
  date: string;
};

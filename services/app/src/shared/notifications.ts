/**
 * Notifications (Funds B): what in a book needs someone's attention, oldest first, behind the
 * masthead's bell. Some can be dismissed; others go only when what's wrong is fixed: a sale (or
 * anything else that came in by itself) that takes a share a fund doesn't have, which goes once
 * the transaction is saved with a fund that has it; and a shop's login Amazon wants a person
 * for (Amazon orders), which goes once a sync gets in. A bank feed's problem (a login its bank
 * wants, say) can be dismissed, by each person for themselves: the accounts it's about say so on
 * their pages, and Bank connections on its connection, until it's fixed.
 */
export type Notification = {
  /** Stable while it lasts: the kind and what it's about. */
  id: string;
  /** A sale needing a fund (Funds B), a shop's login needing a person (Amazon orders), or a
   * bank feed's problem. */
  kind: "needs-fund" | "shop-login" | "bank-feed";
  /** When it was added (ISO 8601): the queue's order. */
  added: string;
  /** Whether it can be dismissed; if not, it goes once it's fixed. */
  dismissable: boolean;
  title: string;
  detail: string;
  /** The transaction to open, to fix it (a sale's). */
  transaction_id?: string;
  /** That transaction's date. */
  date?: string;
  /** Where to fix it when it isn't a transaction (a shop's page, to log in again). */
  href?: string;
  /** The book's accounts it's about (a bank feed's problem), each saying so on its page. */
  accounts?: string[];
  /** Where it's fixed outside the app (SimpleFIN Bridge, for a login a bank wants). */
  external?: { label: string; url: string };
};

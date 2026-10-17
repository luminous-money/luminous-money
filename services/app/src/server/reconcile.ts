/**
 * Reconciliation (M14), the app's side. The ledger keeps reconciliations and refuses any that
 * don't balance; this adds what it can't know:
 *
 * - **The Reconcile screen's view:** the statement prefilled from the bank (a linked account:
 *   its day-end balance the day before its balance date) or the last imported file's last
 *   balance; what starts ticked (what was imported into it, from a file or the bank, and the
 *   opening balance; or the draft's ticks); and the draft saved for later, if any.
 * - **Finishing:** the ledger reconciles, and the draft goes.
 * - **Bank-fed accounts:** compared with the bank (where the books went off), and reconciled
 *   automatically after a sync, when everything through the day is confirmed and the books
 *   agree with the bank.
 */
import { StaleVersion, type AppDb, type ReconcileDraft } from "./db.js";
import { add, isZero, negate } from "../shared/decimal.js";
import type { BankComparison, ReconcileView } from "../shared/reconcile.js";
import type { LedgerPort, Reconciled } from "./ledger.js";
import { localDate, rowsOf } from "./simplefin/sync.js";
import type { Link, SimplefinStore } from "./simplefin/store.js";

/** A problem with a reconciliation the user can fix: its status says which. */
export class ReconcileProblem extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string
  ) {
    super(message);
  }
}

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

/** The bank's day-end balance the day before its balance date (as stored): its reported balance
 * less what it's sent since, dated as imports date them. A late posting on the balance date
 * itself can't break it. Cash links only (a brokerage's holdings aren't reconciled). */
export function bankStatement(
  store: SimplefinStore,
  db: AppDb,
  link: Link
): { statement_date: string; balance: string; currency: string } | null {
  const snapshot = store.account(link.connection_id, link.account_id);
  if (!snapshot || link.kind !== "cash") return null;
  const zone = db.timeZone(link.book_id);
  const day = shift(localDate(snapshot.balance_date, zone), -1);
  const since = rowsOf(store.transactions(link.connection_id, link.account_id), zone).filter(
    (r) => r.date! > day
  );
  return {
    statement_date: day,
    balance: since.reduce((total, r) => add(total, negate(r.amount!)), snapshot.balance),
    currency: snapshot.currency,
  };
}

type Deps = { db: AppDb; ledger: LedgerPort; store?: SimplefinStore; book: string };

/** Everything the Reconcile screen needs, its list to 14 days past `through` (the statement's
 * date, else the draft's or the prefill's, else today). */
export async function reconcileView(
  { db, ledger, store, book }: Deps,
  account: string,
  through?: string
): Promise<ReconcileView> {
  const draft = db.draft(book, account) ?? null;
  const link = store?.linkTo(book, account);
  const bank = link && store ? bankStatement(store, db, link) : null;
  const file = db.lastFileBalance(book, account);
  const prefill = bank
    ? { statement_date: bank.statement_date, balance: bank.balance, source: "bank" as const }
    : file
      ? { statement_date: file.date, balance: file.balance, source: "file" as const }
      : null;
  const day =
    through ??
    draft?.statement_date ??
    prefill?.statement_date ??
    new Date().toISOString().slice(0, 10);
  const state = await ledger.reconciliation(book, account, day);
  const open = new Set(state.transactions.map((t) => t.id));
  const imported = db.importedInto(book, account, [...open]);
  const ticked = draft
    ? draft.ticked.filter((id) => open.has(id))
    : state.transactions.filter((t) => imported.has(t.id) || t.opening).map((t) => t.id);
  return { through: day, state, prefill, ticked, draft };
}

/** Save a reconciliation for later, against the draft's version read (null: none yet). */
export function saveDraft(
  db: AppDb,
  book: string,
  user: string,
  draft: Pick<ReconcileDraft, "account" | "statement_date" | "balance" | "ticked">,
  expected: string | null
): ReconcileDraft {
  try {
    return db.saveDraft(book, { ...draft, user_id: user }, expected);
  } catch (error) {
    if (error instanceof StaleVersion) throw new ReconcileProblem(409, error.message);
    throw error;
  }
}

/** Finish: the ledger reconciles (refusing what doesn't balance), and the draft goes. */
export async function finish(
  { db, ledger, book }: Deps,
  account: string,
  statement: { statement_date: string; balance: string; transactions: string[] }
): Promise<Reconciled> {
  const done = await ledger.reconcile(book, account, { ...statement, automatic: false });
  db.discardDraft(book, account);
  return done;
}

/**
 * Reconcile a bank-fed account with the bank, after a sync: through the day before its balance
 * date, when the account is linked itself (cash), nothing's in progress (a draft, a match
 * waiting in review), there's something new, all of it is confirmed, and the books agree with
 * the bank. Returns the reconciliation, or null if it waits.
 */
export async function autoReconcile(
  db: AppDb,
  store: SimplefinStore,
  ledger: LedgerPort,
  link: Link
): Promise<Reconciled | null> {
  const book = link.book_id;
  const account = link.account;
  if (link.kind !== "cash" || db.draft(book, account) || db.matchesWaiting(book, account))
    return null;
  const bank = bankStatement(store, db, link);
  if (!bank) return null;
  try {
    const state = await ledger.reconciliation(book, account, bank.statement_date);
    if (state.last && state.last >= bank.statement_date) return null;
    const due = state.transactions.filter((t) => t.date <= bank.statement_date);
    if (!due.length || due.some((t) => t.flag !== "*")) return null;
    const books = due.reduce(
      (total, t) => add(total, t.amount.number),
      state.reconciled_balance.number
    );
    if (!isZero(add(books, negate(bank.balance)))) return null;
    return await ledger.reconcile(book, account, {
      statement_date: bank.statement_date,
      balance: bank.balance,
      transactions: due.map((t) => t.id),
      automatic: true,
    });
  } catch {
    return null; // not reconcilable as it stands: next sync
  }
}

/**
 * The books against the bank, at the end of the day before its balance date: agreeing, or off
 * by how much, and since when. The bank's earlier day-end balances are backed out from that one
 * and what it sent, dated as imports date them; they and the books' change only on days with
 * transactions, so the divergence started on the earliest such day from which every one
 * through the end differs (none: before the bank's history).
 */
export async function bankComparison(
  db: AppDb,
  store: SimplefinStore,
  ledger: LedgerPort,
  link: Link
): Promise<BankComparison | null> {
  const bank = bankStatement(store, db, link);
  if (!bank) return null;
  const zone = db.timeZone(link.book_id);
  const rows = rowsOf(store.transactions(link.connection_id, link.account_id), zone).filter(
    (r) => r.date! >= link.starts_on && r.date! <= bank.statement_date
  );
  const from = [link.starts_on, ...rows.map((r) => r.date!)].sort()[0]!;
  const books = await ledger.dayBalances(link.book_id, link.account, from, bank.statement_date);
  const booksAt = (day: string) =>
    books.days.filter((d) => d.date <= day).at(-1)?.balance ?? books.before;
  const bankAt = (day: string) =>
    rows.filter((r) => r.date! > day).reduce((b, r) => add(b, negate(r.amount!)), bank.balance);
  const off = (day: string) => add(bankAt(day), negate(booksAt(day)));
  const end = off(bank.statement_date);
  if (isZero(end))
    return {
      date: bank.statement_date,
      bank: bank.balance,
      books: booksAt(bank.statement_date),
      off_by: null,
      since: null,
    };
  const changes = [
    ...new Set([...rows.map((r) => r.date!), ...books.days.map((d) => d.date)]),
  ].sort();
  let since: string | null = null;
  for (let i = changes.length - 1; i >= 0 && !isZero(off(changes[i]!)); i--) since = changes[i]!;
  // Off before the first of them too: it went off before the bank's history.
  if (since === changes[0] && !isZero(off(shift(since!, -1)))) since = null;
  return {
    date: bank.statement_date,
    bank: bank.balance,
    books: booksAt(bank.statement_date),
    off_by: end,
    since,
  };
}

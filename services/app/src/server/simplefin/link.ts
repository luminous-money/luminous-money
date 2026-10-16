/**
 * Linking a bank account to an account in a book. The bank is the source of truth for what
 * happened in the account, so linking fetches its whole history first (as far back as it goes;
 * S is its earliest date), and then, by mode:
 *
 * - **new:** make the account, with an opening balance on S − 1 of the reported balance less
 *   everything synced (a brokerage: its cash; positions open as one estimated lot each), and
 *   import the history.
 * - **reconcile** (an existing account; the default):
 *   1. every transaction of yours from S on is pending, except those the bank confirms:
 *   2. the bank's transactions are matched against them (the usual matcher and assignment), and
 *      each match is confirmed (your date, payee and splits kept; the bank's amount where a
 *      schedule's tolerance allowed a difference);
 *   3. the opening balance is set so the balance at the end of S − 1 is the bank's (the reported
 *      balance less everything synced): the existing opening balance changes (moving to S − 1 if
 *      it was later), or one is made;
 *   4. the bank's unmatched transactions import as a normal batch, categorized, for review.
 *   Yours from S on that the bank doesn't know stay pending: "Not at the bank".
 * - **start-over:** delete every transaction posting to the account, then as **new**.
 * - **from-date:** just sync from a date, reconciling nothing.
 *
 * The reconcile (or start-over) is one atomic ledger write; the import after it is an ordinary
 * batch, which the next sync would bring in anyway if it failed.
 * `plan` works it all out first: its `preview` is what the user confirms, `apply` does it.
 */
import { randomUUID } from "node:crypto";

import type { LedgerRow, TransactionIn } from "@fava-beans/ledger-client";

import { add, isZero, negate } from "../../shared/decimal.js";
import type { ImportRow } from "../../shared/imports.js";
import { now } from "@fava-beans/db";
import type { LedgerPort, TransactionEdit } from "../ledger.js";
import { assign } from "../pipeline/assign.js";
import { runChain } from "../pipeline/chain.js";
import { DEFAULT_WINDOW_DAYS, matcher } from "../pipeline/matcher.js";
import type { Existing, Incoming } from "../pipeline/types.js";
import { cashOf, openingHoldings, positions } from "./holdings.js";
import type { AccountSnapshot, Connection, Link, LinkKind } from "./store.js";
import {
  backfill,
  cashAccountOf,
  importLink,
  localDate,
  rowsOf,
  type SimplefinDeps,
} from "./sync.js";

export const OPENING_BALANCES = "Equity:Opening-Balances";

export type LinkMode = "new" | "reconcile" | "start-over" | "from-date";

export type LinkInput = {
  user: string;
  connection: Connection;
  accountId: string;
  book: string;
  /** The account in the book (a brokerage: the node over `:Cash` and its holdings). */
  account: string;
  mode: LinkMode;
  /** For `from-date`: the first date to import. */
  from?: string;
};

export type LinkPreview = {
  mode: LinkMode;
  kind: LinkKind;
  account: string;
  history_complete: boolean;
  bank: { transactions: number; from: string | null; balance: string; currency: string };
  /** Bank transactions that matched yours (reconcile). */
  matched: number;
  /** Bank transactions that come in as new. */
  added: number;
  /** Yours from S on the bank doesn't know (reconcile): left pending. */
  not_at_bank: number;
  /** Transactions deleted (start-over), and how many of them also post to another balance
   * sheet account (a transfer: that account loses its side). */
  deleted: number;
  deleted_elsewhere: number;
  opening: { date: string; amount: string; was: string | null } | null;
  starts_on: string;
};

export class LinkProblem extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string
  ) {
    super(message);
  }
}

const dayBefore = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

const sum = (amounts: string[]) => amounts.reduce((a, b) => add(a, b), "0");

/** Every row of an account's ledger, newest first. */
async function allRows(ledger: LedgerPort, book: string, account: string): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await ledger.accountLedger(book, account, cursor);
    rows.push(...page.rows);
    if (!page.next_cursor) return rows;
    cursor = page.next_cursor;
  }
}

const isOpening = (r: LedgerRow) => r.counterpart === OPENING_BALANCES;
const isTransfer = (r: LedgerRow) =>
  r.splits > 2 || /^(Assets|Liabilities):/.test(r.counterpart ?? "");

/** The snapshot's account kind: a brokerage if it holds positions. */
export const kindOf = (snapshot: AccountSnapshot): LinkKind =>
  positions(snapshot.holdings).size ? "brokerage" : "cash";

/** The balance-sheet amount the account should open with: its cash, for a brokerage. */
const reportedCash = (snapshot: AccountSnapshot, kind: LinkKind) =>
  kind === "brokerage" ? cashOf(snapshot.balance, snapshot.holdings) : snapshot.balance;

/** The checks that need no fetching, so a link attempt can be refused at once: the book and the
 * bank account exist, neither side is linked yet, and the account is there (or, for a new
 * one, isn't). Whether it's a brokerage waits for the history (holdings come with it). */
export async function precheck(deps: SimplefinDeps, input: LinkInput): Promise<void> {
  const { store } = deps;
  const ledger = deps.ledgerFor(input.user);
  const { connection, accountId, book, account, mode } = input;
  if (!(await ledger.book(book))) throw new LinkProblem(404, "not found");
  if (!store.account(connection.id, accountId))
    throw new LinkProblem(404, "this connection has no such account");
  if (store.links(connection.id).some((l) => l.account_id === accountId))
    throw new LinkProblem(409, "this bank account is already linked");
  if (store.linkTo(book, account)) throw new LinkProblem(409, `${account} is already linked`);
  if (mode === "from-date" && !/^\d{4}-\d{2}-\d{2}$/.test(input.from ?? ""))
    throw new LinkProblem(422, "choose the first date to bring in");
  const names = new Set(
    (await ledger.accounts(book)).filter((a) => !a.implicit).map((a) => a.name)
  );
  if (mode === "new" && (names.has(account) || names.has(`${account}:Cash`)))
    throw new LinkProblem(409, `${account} already exists: reconcile with it, or start it over`);
  if (mode !== "new" && !names.has(account) && !names.has(`${account}:Cash`))
    throw new LinkProblem(422, `there's no ${account} in this book`);
}

/** What a link would do (`preview`), and doing it (`apply`). With `fetch` (the default), the
 * bank's history is fetched first, as far as today's budget allows; without it, only what's
 * already fetched is used (a background attempt fetches first, then plans). */
export async function plan(
  deps: SimplefinDeps,
  input: LinkInput,
  { fetch = true } = {}
): Promise<{ preview: LinkPreview; apply: () => Promise<Link> }> {
  const { db, store } = deps;
  const ledger = deps.ledgerFor(input.user);
  const { connection, accountId, book, account, mode } = input;
  if (!(await ledger.book(book))) throw new LinkProblem(404, "not found");
  if (!store.account(connection.id, accountId))
    throw new LinkProblem(404, "this connection has no such account");
  if (store.links(connection.id).some((l) => l.account_id === accountId))
    throw new LinkProblem(409, "this bank account is already linked");
  if (store.linkTo(book, account)) throw new LinkProblem(409, `${account} is already linked`);

  // The history first: holdings (and so whether it's a brokerage) come with transactions.
  const complete = fetch
    ? await backfill(deps, connection, accountId)
    : !!store.account(connection.id, accountId)!.history_complete;
  const snapshot = store.account(connection.id, accountId)!;
  const kind = kindOf(snapshot);
  const cash = cashAccountOf({ account, kind });
  const accounts = await ledger.accounts(book);
  const existing = accounts.find((a) => a.name === cash && !a.implicit);
  if (mode === "new" && accounts.some((a) => a.name === account || a.name === cash))
    throw new LinkProblem(409, `${account} already exists: reconcile with it, or start it over`);
  if (mode !== "new") {
    if (!existing || existing.kind !== "leaf" || existing.close)
      throw new LinkProblem(422, `${cash} isn't an open account that holds transactions`);
    if (existing.currencies?.length && !existing.currencies.includes(snapshot.currency))
      throw new LinkProblem(
        422,
        `${cash} holds ${existing.currencies.join(", ")}, not ${snapshot.currency}`
      );
  }
  if (mode === "from-date" && !/^\d{4}-\d{2}-\d{2}$/.test(input.from ?? ""))
    throw new LinkProblem(422, "choose the first date to bring in");

  const zone = db.timeZone(book);
  const rows = rowsOf(store.transactions(connection.id, accountId), zone).sort((a, b) =>
    a.date!.localeCompare(b.date!)
  );
  const S =
    rows[0]?.date ?? localDate(snapshot.balance_date || Math.floor(Date.now() / 1000), zone);
  const opensOn = dayBefore(S);
  const bankOpening = add(reportedCash(snapshot, kind), negate(sum(rows.map((r) => r.amount!))));
  const currency = snapshot.currency;
  const preview: LinkPreview = {
    mode,
    kind,
    account,
    history_complete: complete,
    bank: {
      transactions: rows.length,
      from: rows[0]?.date ?? null,
      balance: snapshot.balance,
      currency,
    },
    matched: 0,
    added: rows.length,
    not_at_bank: 0,
    deleted: 0,
    deleted_elsewhere: 0,
    opening: { date: opensOn, amount: bankOpening, was: null },
    starts_on: S,
  };
  const link = (starts_on: string) =>
    store.addLink({
      user_id: input.user,
      connection_id: connection.id,
      account_id: accountId,
      book_id: book,
      account,
      kind,
      starts_on,
    });
  const needHistory = () => {
    if (!complete)
      throw new LinkProblem(
        409,
        "the bank's history isn't all here yet (today's SimpleFIN requests ran out): try again tomorrow"
      );
  };
  const ensureEquity = async () => {
    if (!accounts.some((a) => a.name === OPENING_BALANCES && !a.implicit))
      await ledger.createAccount(book, OPENING_BALANCES);
  };
  const openingTransaction = (amount: string): TransactionIn => ({
    date: opensOn,
    flag: "*",
    payee: null,
    narration: "Opening balance",
    tags: [],
    links: [],
    meta: { source: "simplefin" },
    postings: [
      { account: cash, units: { number: amount, currency } },
      { account: OPENING_BALANCES, units: null },
    ],
  });

  /** Make the account (and a brokerage's positions), opening as the bank says. */
  const createAccounts = async () => {
    await ledger.createAccount(book, cash, {
      opening_balance: { amount: bankOpening, currency, date: opensOn },
    });
    if (kind === "brokerage")
      for (const holding of openingHoldings(snapshot.holdings)) {
        const created = positions(snapshot.holdings).get(holding.commodity)!.created;
        const date = created ? localDate(created, zone) : opensOn;
        await ledger.createAccount(book, `${account}:${holding.commodity}`, {
          opening_balance: { amount: "0", currency, date: date < opensOn ? date : opensOn },
          opening_holdings: [holding],
        });
      }
  };

  if (mode === "from-date") {
    preview.opening = null;
    preview.starts_on = input.from!;
    preview.added = rows.filter((r) => r.date! >= input.from!).length;
    return {
      preview,
      apply: async () => {
        const made = link(input.from!);
        await importLink(deps, made);
        return made;
      },
    };
  }

  if (mode === "new") {
    return {
      preview,
      apply: async () => {
        needHistory();
        await createAccounts();
        const made = link(S);
        await importLink(deps, made);
        return made;
      },
    };
  }

  const mine = await allRows(ledger, book, cash);
  const opening = mine.filter(isOpening).sort((a, b) => a.date.localeCompare(b.date))[0];

  if (mode === "start-over") {
    const doomed = mine;
    preview.deleted = doomed.length;
    preview.deleted_elsewhere = doomed.filter((r) => !isOpening(r) && isTransfer(r)).length;
    preview.opening!.was = opening?.amount?.number ?? null;
    return {
      preview,
      apply: async () => {
        needHistory();
        await ensureEquity();
        await ledger.applyChanges(book, {
          create: [openingTransaction(bankOpening)],
          delete: doomed.map((r) => ({ id: r.id, updated_at: r.updated_at })),
        });
        const made = link(S);
        await importLink(deps, made);
        return made;
      },
    };
  }

  // Reconcile.
  const others = mine.filter((r) => r !== opening);
  const before = others.filter((r) => r.date < S);
  const after = others.filter((r) => r.date >= S);
  const target = add(
    bankOpening,
    negate(sum(before.flatMap((r) => (r.amount?.currency === currency ? [r.amount.number] : []))))
  );
  const prints = rows.map((r) => `id:${r.id}`);
  const seen = db.importedBefore(book, cash, prints);
  const held = db.claimed(
    book,
    cash,
    after.map((r) => r.id),
    "simplefin"
  );
  const incoming: Incoming[] = rows
    .filter((r) => !seen.has(`id:${r.id}`))
    .map((r) => ({
      line: r.line,
      date: r.date!,
      amount: { number: r.amount!, currency },
      description: r.description,
      payee: r.payee,
    }));
  const candidates: Existing[] = after
    .filter((r) => !held.has(r.id))
    .map((r) => ({
      id: r.id,
      date: r.date,
      flag: r.flag,
      payee: r.payee,
      narration: r.narration,
      amount: r.amount,
    }));
  const schedules = db.schedulesOf(candidates.map((t) => t.id));
  for (const t of candidates) {
    const split = schedules.get(t.id)?.template.postings.find((p) => p.account === cash);
    if (split?.tolerance) t.tolerance = split.tolerance;
  }
  const resolutions = new Map<number, ImportRow["candidates"]>();
  for (const [line, found] of await runChain([matcher(DEFAULT_WINDOW_DAYS)], incoming, {
    account: cash,
    existing: candidates,
  }))
    resolutions.set(
      line,
      found.flatMap((r) => r.candidates)
    );
  const assigned = assign(resolutions);
  const matchedIds = new Set([...assigned.values(), ...held]);
  preview.matched = assigned.size + held.size;
  preview.added = incoming.length - assigned.size;
  preview.not_at_bank = after.filter((r) => !matchedIds.has(r.id)).length;
  preview.opening = {
    date: opening && opening.date < S ? opening.date : opensOn,
    amount: target,
    was: opening?.amount?.number ?? null,
  };

  return {
    preview,
    apply: async () => {
      needHistory();
      const byLine = new Map(rows.map((r) => [r.line, r]));
      const update: TransactionEdit[] = [];
      for (const r of after) {
        const matched = matchedIds.has(r.id);
        const line = [...assigned].find(([, id]) => id === r.id)?.[0];
        const bankAmount = line !== undefined ? byLine.get(line)!.amount! : undefined;
        const differs = bankAmount && r.amount && !isZero(add(r.amount.number, negate(bankAmount)));
        if (differs) {
          const t = await ledger.transaction(book, r.id);
          update.push({
            id: r.id,
            updated_at: r.updated_at,
            flag: "*",
            postings: t.postings.map((p) =>
              p.account === cash && p.units
                ? { ...p, units: { ...p.units, number: bankAmount } }
                : p
            ),
          });
        } else if (matched && r.flag !== "*")
          update.push({ id: r.id, updated_at: r.updated_at, flag: "*" });
        else if (!matched && r.flag === "*")
          update.push({ id: r.id, updated_at: r.updated_at, flag: "!" });
      }
      const create: TransactionIn[] = [];
      if (opening) {
        const t = await ledger.transaction(book, opening.id);
        update.push({
          id: opening.id,
          updated_at: opening.updated_at,
          ...(opening.date < S ? {} : { date: opensOn }),
          postings: t.postings.map((p) =>
            p.account === cash ? { ...p, units: { number: target, currency } } : p
          ),
        });
      } else {
        await ensureEquity();
        create.push(openingTransaction(target));
      }
      await ledger.applyChanges(book, { create, update, delete: [] });

      // The bank's rows that matched hold their transactions, confirmed, as an import batch.
      const batchId = randomUUID().replace(/-/g, "");
      const matchedRows = [...assigned].map(([line, id]) => {
        const r = byLine.get(line)!;
        return {
          line: r.line,
          date: r.date,
          amount: r.amount,
          description: r.description,
          payee: r.payee,
          outcome: "matched" as const,
          error: null,
          transaction_id: id,
          candidates: resolutions.get(line) ?? [],
          match: "confirmed" as const,
          proposal: null,
          fingerprint: `id:${r.id}`,
        };
      });
      if (matchedRows.length)
        db.saveImport(
          {
            id: batchId,
            account: cash,
            source: "simplefin",
            filename: `${snapshot.institution || "SimpleFIN"} (reconciled)`,
            created_at: now(),
            rows: matchedRows.length,
            staged: 0,
            matched: matchedRows.length,
            duplicates: 0,
            skipped: 0,
            unreadable: 0,
            book_id: book,
            user_id: input.user,
          },
          matchedRows
        );
      const made = link(S);
      await importLink(deps, made);
      return made;
    },
  };
}

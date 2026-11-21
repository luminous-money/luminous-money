/** The base: books, the chart, balances, finding and entering transactions. */
import {
  ACCOUNT,
  BOOK,
  UPDATED_AT,
  bool,
  date,
  int,
  ledgerSchema,
  oneOf,
  str,
  strs,
} from "../schemas.js";
import { seg, type Context, type Tool } from "../tool.js";

/** A page of transactions: the journal's or an account's ledger's filters. */
const PAGE = {
  q: str("Only transactions whose payee, narration or a split's memo has every word of this."),
  tag: strs("Only transactions with a split that has every one of these tags."),
  date: date("The page starting on or before this date (newest first)."),
  reconciled: bool("Only reconciled transactions (true), or only those not (false)."),
  attached: bool(
    "Only those holding a file, a receipt say (true), or none (false). With the tag " +
      "hsa-fsa-eligible: eligible spending still needing its receipt."
  ),
  cursor: str("The `next_cursor` of the page before, for the next (older) page."),
  limit: int("How many (default 50, at most 1000)."),
};

/** Whether a transaction was confirmed out of review, and if so, record whether it kept what
 * was proposed for it (as the PWA does on confirm). */
export async function settleIfConfirmed(ctx: Context, book: string, id: string, was: unknown) {
  if (was !== "!") return;
  const now = (await ctx.ledger.get(`/books/${seg(book)}/transactions/${seg(id)}`)) as {
    flag?: string;
  };
  if (now.flag !== "*") return;
  await ctx.app.post(`/books/${seg(book)}/proposals/${seg(id)}/settle`).catch(() => undefined);
}

export const baseTools: Tool[] = [
  {
    name: "read_books",
    domain: "base",
    description: "The books you can see, with your role in each (owner, manage, write, read).",
    input: {},
    run: (ctx) => ctx.app.get("/books"),
  },
  {
    name: "read_accounts",
    domain: "base",
    description:
      "The book's chart of accounts: every open account with its own balance (`balance`), its " +
      "subtree's (`total`) and their value, its type and kind.",
    input: { book: BOOK, archived: bool("Include archived (closed) accounts too.") },
    required: ["book"],
    run: async (ctx, { book, archived }) => {
      const tree = (await ctx.ledger.get(`/books/${seg(book)}/accounts/tree`)) as {
        close?: string | null;
        cards?: unknown;
      }[];
      return tree
        .filter((a) => archived || !a.close)
        .map(({ cards: _cards, ...account }) => account);
    },
  },
  {
    name: "read_balances",
    domain: "base",
    description:
      "Accounts' balances today (with their subtrees), values and when they were last revalued.",
    input: { book: BOOK, accounts: strs("The accounts' full names.") },
    required: ["book", "accounts"],
    run: (ctx, { book, accounts }) =>
      ctx.ledger.get(`/books/${seg(book)}/accounts/summary`, { account: accounts as string[] }),
  },
  {
    name: "read_transactions",
    domain: "base",
    description:
      "Find transactions in the whole book, newest first, a page at a time: by words, accounts, " +
      "tags, date. Each row has its splits, flag and `updated_at`.",
    input: {
      book: BOOK,
      ...PAGE,
      account: strs("Only transactions with a split in one of these accounts or under one."),
      budgeted: bool("Only those counted in budgets (true), or only those kept out (false)."),
    },
    required: ["book"],
    run: (ctx, { book, limit, ...query }) =>
      ctx.ledger.get(`/books/${seg(book)}/journal`, {
        ...(query as Record<string, string>),
        limit: (limit as number) ?? 50,
      }),
  },
  {
    name: "read_transaction",
    domain: "base",
    description: "One transaction in full: its splits, tags, fund lines, meta and `updated_at`.",
    input: { book: BOOK, id: str("The transaction's ID.") },
    required: ["book", "id"],
    run: (ctx, { book, id }) => ctx.ledger.get(`/books/${seg(book)}/transactions/${seg(id)}`),
  },
  {
    name: "read_account_ledger",
    domain: "base",
    description: "An account's register, newest first, a page at a time, with its running balance.",
    input: { book: BOOK, account: ACCOUNT, ...PAGE },
    required: ["book", "account"],
    run: (ctx, { book, account, limit, ...query }) =>
      ctx.ledger.get(`/books/${seg(book)}/accounts/${seg(account)}/ledger`, {
        ...(query as Record<string, string>),
        limit: (limit as number) ?? 50,
      }),
  },
  {
    name: "read_tags",
    domain: "base",
    description: "The tags used in the book, with how many splits have each.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.ledger.get(`/books/${seg(book)}/tags`),
  },
  {
    name: "read_query",
    domain: "base",
    description:
      "Run a Beancount Query Language (BQL) query on the book, for anything the other tools " +
      "don't answer: `SELECT account, sum(position) WHERE year = 2026 GROUP BY account`.",
    input: { book: BOOK, bql: str("The query.") },
    required: ["book", "bql"],
    run: (ctx, { book, bql }) => ctx.ledger.post(`/books/${seg(book)}/query`, String(bql)),
  },
  {
    name: "write_add_transaction",
    domain: "base",
    description:
      'Enter a transaction: confirmed (`flag: "*"`) or staged for review (`"!"`). Its splits ' +
      "must balance; one split's `units` may be left out to take the rest.",
    input: { book: BOOK, transaction: ledgerSchema("TransactionIn") },
    required: ["book", "transaction"],
    additive: true,
    run: (ctx, { book, transaction }) =>
      ctx.ledger.post(`/books/${seg(book)}/transactions`, transaction),
  },
  {
    name: "write_edit_transaction",
    domain: "base",
    description:
      "Change a transaction: only the fields given (`postings`, when given, replaces them all), " +
      "against the `updated_at` you read. Setting `flag` to `*` confirms it out of review.",
    input: {
      book: BOOK,
      id: str("The transaction's ID."),
      changes: ledgerSchema("TransactionPatch"),
    },
    required: ["book", "id", "changes"],
    run: async (ctx, { book, id, changes }) => {
      const path = `/books/${seg(book)}/transactions/${seg(id)}`;
      const was = ((await ctx.ledger.get(path)) as { flag?: string }).flag;
      const saved = await ctx.ledger.patch(path, changes);
      await settleIfConfirmed(ctx, String(book), String(id), was);
      return saved;
    },
  },
  {
    name: "delete_transaction",
    domain: "base",
    description: "Delete a transaction, against the `updated_at` you read.",
    input: { book: BOOK, id: str("The transaction's ID."), updated_at: UPDATED_AT },
    required: ["book", "id", "updated_at"],
    run: async (ctx, { book, id, updated_at }) => {
      await ctx.ledger.delete(`/books/${seg(book)}/directives/${seg(id)}`, {
        updated_at: updated_at as string,
      });
      return { deleted: id };
    },
  },
  {
    name: "write_star",
    domain: "base",
    description:
      "Star an account, a budget (by its account) or a fund for your home page, or unstar it. " +
      "Stars are yours alone.",
    input: {
      book: BOOK,
      kind: oneOf(["account", "budget", "fund"], "What to star."),
      name: str("The account's full name, or the fund's name."),
      starred: bool("true to star, false to unstar."),
    },
    required: ["book", "kind", "name", "starred"],
    run: (ctx, { book, kind, name, starred }) => {
      const list = { account: "stars", budget: "budget-stars", fund: "fund-stars" }[
        kind as "account" | "budget" | "fund"
      ];
      const path = `/books/${seg(book)}/${list}/${seg(name)}`;
      return starred ? ctx.app.put(path) : ctx.app.delete(path);
    },
  },
];

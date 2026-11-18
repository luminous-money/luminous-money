/** Reconciling an account against its statement. */
import { ACCOUNT, BOOK, date, obj, str, strs } from "../schemas.js";
import { seg, type Tool } from "../tool.js";

export const reconcileTools: Tool[] = [
  {
    name: "read_reconcile",
    domain: "reconciling",
    description:
      "An account's reconciliation as the Reconcile screen shows it: where it stands, its " +
      "transactions through the statement date, the statement as the bank or last file says " +
      "it, what starts ticked, and any draft.",
    input: { book: BOOK, account: ACCOUNT, through: date("The statement date.") },
    required: ["book", "account"],
    run: (ctx, { book, account, through }) =>
      ctx.app.get(`/books/${seg(book)}/reconcile/${seg(account)}`, {
        through: through as string | undefined,
      }),
  },
  {
    name: "read_reconciliations",
    domain: "reconciling",
    description: "An account's past reconciliations.",
    input: { book: BOOK, account: ACCOUNT },
    required: ["book", "account"],
    run: (ctx, { book, account }) =>
      ctx.ledger.get(`/books/${seg(book)}/accounts/${seg(account)}/reconciliations`),
  },
  {
    name: "write_reconcile",
    domain: "reconciling",
    description:
      "Finish a reconciliation: the statement's date and balance (as stored: negative on a " +
      "liability) and the transactions ticked. Refused unless they add up to the balance.",
    input: {
      book: BOOK,
      account: ACCOUNT,
      statement_date: date("The statement's date."),
      balance: str("Its ending balance."),
      transactions: strs("The IDs ticked."),
    },
    required: ["book", "account", "statement_date", "balance", "transactions"],
    run: (ctx, { book, account, ...statement }) =>
      ctx.app.post(`/books/${seg(book)}/reconcile/${seg(account)}`, statement),
  },
  {
    name: "write_reconcile_draft",
    domain: "reconciling",
    description: "Save a reconciliation to finish later, or discard the saved one (null).",
    input: {
      book: BOOK,
      account: ACCOUNT,
      draft: {
        ...obj(
          {
            statement_date: { type: ["string", "null"], format: "date" },
            balance: { type: ["string", "null"] },
            ticked: strs("The IDs ticked."),
            updated_at: {
              type: ["string", "null"],
              description: "The draft's `updated_at` you read; null if there wasn't one.",
            },
          },
          ["ticked", "updated_at"]
        ),
        type: ["object", "null"],
      },
    },
    required: ["book", "account", "draft"],
    run: (ctx, { book, account, draft }) => {
      const path = `/books/${seg(book)}/reconcile/${seg(account)}/draft`;
      return draft === null ? ctx.app.delete(path) : ctx.app.put(path, draft);
    },
  },
  {
    name: "delete_reconciliation",
    domain: "reconciling",
    description: "Undo an account's reconciliation (its transactions are unreconciled).",
    input: { book: BOOK, account: ACCOUNT, statement_date: date("Its statement date.") },
    required: ["book", "account", "statement_date"],
    run: async (ctx, { book, account, statement_date }) => {
      await ctx.ledger.delete(
        `/books/${seg(book)}/accounts/${seg(account)}/reconciliations/${seg(statement_date)}`
      );
      return { undone: statement_date };
    },
  },
];

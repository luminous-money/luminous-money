/** Budgets: what's set, this period's status, and setting one. */
import { ACCOUNT, BOOK, date, ledgerSchema, oneOf } from "../schemas.js";
import { seg, type Tool } from "../tool.js";

export const budgetTools: Tool[] = [
  {
    name: "read_budgets",
    domain: "budgets",
    description: "Every budget's versions: account, amount per period, period, start.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.ledger.get(`/books/${seg(book)}/budgets`),
  },
  {
    name: "read_budget_status",
    domain: "budgets",
    description:
      "Every budget in force, measured over its current period, with what's spent and left.",
    input: {
      book: BOOK,
      on: date("The day to measure on (default today)."),
      basis: oneOf(["period", "month"], "Each over its own period, or all per month."),
    },
    required: ["book"],
    run: (ctx, { book, on, basis }) =>
      ctx.ledger.get(`/books/${seg(book)}/budgets/status`, {
        on: on as string | undefined,
        basis: basis as string | undefined,
      }),
  },
  {
    name: "read_budget_stars",
    domain: "budgets",
    description: "The budgets you starred for your home page, by account.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.app.get(`/books/${seg(book)}/budget-stars`),
  },
  {
    name: "write_set_budget",
    domain: "budgets",
    description:
      "Set an account's budget from a period's start (an amount of 0 ends it then). A version " +
      "already starting then is replaced, against its `updated_at`.",
    input: { book: BOOK, account: ACCOUNT, budget: ledgerSchema("BudgetIn") },
    required: ["book", "account", "budget"],
    run: (ctx, { book, account, budget }) =>
      ctx.ledger.put(`/books/${seg(book)}/budgets/${seg(account)}`, budget),
  },
];

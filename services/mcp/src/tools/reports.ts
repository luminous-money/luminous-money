/** Reports, as the Reports page shows them, and an account's balance day by day. */
import { ACCOUNT, BOOK, bool, date, int, oneOf, str, strs } from "../schemas.js";
import { seg, type Tool } from "../tool.js";

const KINDS = ["spending", "cash_flow", "breakdown", "largest", "net_worth", "typical"];

export const reportTools: Tool[] = [
  {
    name: "read_report",
    domain: "reports",
    description:
      "A report: `spending` (this month by day, against the budget), `cash_flow` (income and " +
      "expenses per month), `breakdown` (the largest categories), `largest` (the largest " +
      "expenses), `net_worth` (per month end), `typical` (an account's usual week, month, year).",
    input: {
      book: BOOK,
      kind: oneOf(KINDS, "Which report."),
      on: date("The day it's as of (default today)."),
      months: int("cash_flow (1-24, default 6), net_worth (2-120, default 24): how many."),
      tag: strs("cash_flow, breakdown, largest: only splits with every one of these tags."),
      lens: oneOf(
        ["outflows", "expenses"],
        "Spending as money out (outflows, the default) or as booked (expenses)."
      ),
      budgeted: bool("true: leave out what's kept out of budgets."),
      side: oneOf(["expenses", "income"], "breakdown: which side (default expenses)."),
      of: str("breakdown: the accounts just under this one."),
      depth: int("breakdown: account levels (1-4)."),
      slices: int("breakdown: how many (2-12)."),
      from: str(
        "breakdown: the first month (YYYY-MM), or `start` for the first there is (default: " +
          "the six months through `through`)."
      ),
      through: str(
        "breakdown: the last month (YYYY-MM, default this one). It stops at `on`: a month " +
          "ahead adds nothing, and this month counts as the part of it gone."
      ),
      total: bool(
        "breakdown: true: summed over the months, not each a month's average. Either way " +
          "with every month's amounts (byMonth)."
      ),
      limit: int("largest: how many (1-50)."),
      account: { ...ACCOUNT, description: "typical: the expense or income account." },
    },
    required: ["book", "kind"],
    run: (ctx, { book, kind, budgeted, ...query }) =>
      ctx.app.get(`/books/${seg(book)}/reports/${String(kind).replace("_", "-")}`, {
        ...(query as Record<string, string>),
        budgeted: budgeted ? "only" : undefined,
      }),
  },
  {
    name: "read_daily_balances",
    domain: "reports",
    description:
      "An account's balance (with its subtree) at the end of each day it changed, between two " +
      "dates.",
    input: { book: BOOK, account: ACCOUNT, from: date("From."), to: date("To.") },
    required: ["book", "account", "from", "to"],
    run: (ctx, { book, account, from, to }) =>
      ctx.ledger.get(`/books/${seg(book)}/accounts/${seg(account)}/balances`, {
        from: from as string,
        to: to as string,
      }),
  },
];

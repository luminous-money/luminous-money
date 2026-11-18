/** Funds: money set aside for a purpose, moves between them, and accounts' default funds. */
import { BOOK, UPDATED_AT, bool, date, ledgerSchema, str } from "../schemas.js";
import { seg, without, type Tool } from "../tool.js";

const FUND = str("The fund's name.");
const funds = (book: unknown) => `/books/${seg(book)}/funds`;

export const fundTools: Tool[] = [
  {
    name: "read_funds",
    domain: "funds",
    description:
      "Every fund with what it holds (per commodity) and its target, net worth, and " +
      "Unallocated (net worth less every fund).",
    input: { book: BOOK, on: date("Valued at this day's prices (default today).") },
    required: ["book"],
    run: (ctx, { book, on }) => ctx.ledger.get(funds(book), { on: on as string | undefined }),
  },
  {
    name: "read_fund_entries",
    domain: "funds",
    description: "A fund's history: every fund line and move, with its running balance.",
    input: { book: BOOK, fund: FUND },
    required: ["book", "fund"],
    run: (ctx, { book, fund }) => ctx.ledger.get(`${funds(book)}/${seg(fund)}/entries`),
  },
  {
    name: "read_short_transactions",
    domain: "funds",
    description: "Transactions that took more of a share than a fund held, kept to be fixed.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.ledger.get(`${funds(book)}/short`),
  },
  {
    name: "write_add_fund",
    domain: "funds",
    description: "Make a fund, with an optional description and target.",
    input: { book: BOOK, fund: ledgerSchema("FundIn") },
    required: ["book", "fund"],
    additive: true,
    run: (ctx, { book, fund }) => ctx.ledger.post(funds(book), fund),
  },
  {
    name: "write_edit_fund",
    domain: "funds",
    description: "Change a fund's description or target, against its `updated_at`.",
    input: { book: BOOK, fund: FUND, changes: ledgerSchema("FundPatch") },
    required: ["book", "fund", "changes"],
    run: (ctx, { book, fund, changes }) => ctx.ledger.patch(`${funds(book)}/${seg(fund)}`, changes),
  },
  {
    name: "write_rename_fund",
    domain: "funds",
    description: "Rename a fund; rules and schedules naming it follow.",
    input: { book: BOOK, fund: FUND, to: str("Its new name."), updated_at: UPDATED_AT },
    required: ["book", "fund", "to", "updated_at"],
    run: (ctx, { book, fund, to, updated_at }) =>
      ctx.app.post(`/books/${seg(book)}/funds/${seg(fund)}/rename`, { to, updated_at }),
  },
  {
    name: "write_archive_fund",
    domain: "funds",
    description:
      "Archive a fund, moving what it holds to another (`to`), or bring an archived one back.",
    input: {
      book: BOOK,
      fund: FUND,
      archived: bool("true to archive, false to unarchive."),
      to: str("Archiving: the fund (or Unallocated) what it holds moves to."),
      date: date("Archiving: when (default today)."),
      updated_at: UPDATED_AT,
    },
    required: ["book", "fund", "archived", "updated_at"],
    run: (ctx, { book, fund, archived, to, date, updated_at }) =>
      archived
        ? ctx.ledger.post(`${funds(book)}/${seg(fund)}/archive`, { to, date, updated_at })
        : ctx.ledger.post(`${funds(book)}/${seg(fund)}/unarchive`, { updated_at }),
  },
  {
    name: "delete_fund",
    domain: "funds",
    description: "Delete a fund that was never used.",
    input: { book: BOOK, fund: FUND, updated_at: UPDATED_AT },
    required: ["book", "fund", "updated_at"],
    run: async (ctx, { book, fund, updated_at }) => {
      await ctx.ledger.delete(`${funds(book)}/${seg(fund)}`, { updated_at: updated_at as string });
      return { deleted: fund };
    },
  },
  {
    name: "write_move_funds",
    domain: "funds",
    description: "Move money between funds (or to or from Unallocated) on a date.",
    input: { book: BOOK, move: ledgerSchema("FundMoveIn") },
    required: ["book", "move"],
    additive: true,
    run: (ctx, { book, move }) => ctx.ledger.post(`/books/${seg(book)}/fund-moves`, move),
  },
  {
    name: "write_edit_fund_move",
    domain: "funds",
    description: "Change a move between funds, against its `updated_at`.",
    input: { book: BOOK, id: str("The move's ID."), changes: ledgerSchema("FundMovePatch") },
    required: ["book", "id", "changes"],
    run: (ctx, { book, id, changes }) =>
      ctx.ledger.patch(`/books/${seg(book)}/fund-moves/${seg(id)}`, changes),
  },
  {
    name: "delete_fund_move",
    domain: "funds",
    description: "Delete a move between funds.",
    input: { book: BOOK, id: str("The move's ID."), updated_at: UPDATED_AT },
    required: ["book", "id", "updated_at"],
    run: async (ctx, { book, id, updated_at }) => {
      await ctx.ledger.delete(`/books/${seg(book)}/fund-moves/${seg(id)}`, {
        updated_at: updated_at as string,
      });
      return { deleted: id };
    },
  },
  {
    name: "read_fund_default_preview",
    domain: "funds",
    description:
      "What setting (or changing, or deleting) an account's default fund from a date would do " +
      "to the transactions since.",
    input: { book: BOOK, change: ledgerSchema("FundDefaultPreview") },
    required: ["book", "change"],
    run: (ctx, { book, change }) =>
      ctx.ledger.post(`/books/${seg(book)}/fund-defaults/preview`, change),
  },
  {
    name: "write_add_fund_default",
    domain: "funds",
    description:
      "Give an account a default fund from a date: what comes in or goes out of it is that " +
      "fund's unless a transaction says otherwise (an IRA's is Retirement).",
    input: { book: BOOK, default: ledgerSchema("FundDefaultIn") },
    required: ["book", "default"],
    run: (ctx, args) => ctx.ledger.post(`/books/${seg(args.book)}/fund-defaults`, args.default),
  },
  {
    name: "write_edit_fund_default",
    domain: "funds",
    description: "Change an account's default fund, against its `updated_at`.",
    input: { book: BOOK, id: str("The default's ID."), changes: ledgerSchema("FundDefaultPatch") },
    required: ["book", "id", "changes"],
    run: (ctx, { book, id, changes }) =>
      ctx.ledger.patch(`/books/${seg(book)}/fund-defaults/${seg(id)}`, changes),
  },
  {
    name: "delete_fund_default",
    domain: "funds",
    description: "Delete an account's default fund.",
    input: { book: BOOK, id: str("The default's ID."), updated_at: UPDATED_AT },
    required: ["book", "id", "updated_at"],
    run: async (ctx, args) => {
      await ctx.ledger.delete(
        `/books/${seg(args.book)}/fund-defaults/${seg(args.id)}`,
        without(args, "book", "id") as { updated_at: string }
      );
      return { deleted: args.id };
    },
  },
];

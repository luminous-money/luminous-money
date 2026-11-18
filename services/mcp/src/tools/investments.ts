/** Investments: brokerage holdings, trades, prices and revaluing. */
import { ACCOUNT, BOOK, date, ledgerSchema, str } from "../schemas.js";
import { seg, type Tool } from "../tool.js";

const account = (book: unknown, name: unknown) => `/books/${seg(book)}/accounts/${seg(name)}`;

export const investmentTools: Tool[] = [
  {
    name: "read_holdings",
    domain: "investments",
    description:
      "What an account and everything under it holds: units, prices, value, cost basis, gains " +
      "and lots, per commodity.",
    input: { book: BOOK, account: ACCOUNT, on: date("As of this day (default today).") },
    required: ["book", "account"],
    run: (ctx, args) =>
      ctx.ledger.get(`${account(args.book, args.account)}/holdings`, {
        on: args.on as string | undefined,
      }),
  },
  {
    name: "read_prices",
    domain: "investments",
    description: "A commodity's prices over time.",
    input: { book: BOOK, commodity: str("Its symbol.") },
    required: ["book", "commodity"],
    run: (ctx, { book, commodity }) =>
      ctx.ledger.get(`/books/${seg(book)}/prices`, { commodity: commodity as string }),
  },
  {
    name: "read_trade_preview",
    domain: "investments",
    description: "The transaction a trade would make (lots, gains), without making it.",
    input: { book: BOOK, account: ACCOUNT, trade: ledgerSchema("TradeIn") },
    required: ["book", "account", "trade"],
    run: (ctx, args) =>
      ctx.ledger.post(`${account(args.book, args.account)}/trades/preview`, args.trade),
  },
  {
    name: "write_trade",
    domain: "investments",
    description:
      "Record a trade in a brokerage account: a buy, sale, dividend (reinvested or not), and " +
      "the like; the ledger writes the transaction.",
    input: { book: BOOK, account: ACCOUNT, trade: ledgerSchema("TradeIn") },
    required: ["book", "account", "trade"],
    additive: true,
    run: (ctx, args) => ctx.ledger.post(`${account(args.book, args.account)}/trades`, args.trade),
  },
  {
    name: "write_add_price",
    domain: "investments",
    description: "Record a commodity's price on a date.",
    input: { book: BOOK, price: ledgerSchema("PriceIn") },
    required: ["book", "price"],
    additive: true,
    run: (ctx, { book, price }) => ctx.ledger.post(`/books/${seg(book)}/prices`, price),
  },
  {
    name: "write_fetch_prices",
    domain: "investments",
    description: "Fetch the book's commodities' latest prices now (it's also done each morning).",
    input: { book: BOOK },
    required: ["book"],
    additive: true,
    run: (ctx, { book }) => ctx.app.post(`/books/${seg(book)}/prices/fetch`),
  },
  {
    name: "write_revalue",
    domain: "investments",
    description:
      "Record what a revalued asset (a house, a car) is worth on a date: the change in value " +
      "is written against its gains account.",
    input: { book: BOOK, account: ACCOUNT, revalue: ledgerSchema("RevalueIn") },
    required: ["book", "account", "revalue"],
    run: (ctx, args) =>
      ctx.ledger.post(`${account(args.book, args.account)}/revalue`, args.revalue),
  },
];

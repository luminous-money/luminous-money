/** The chart of accounts: opening, editing, renaming, archiving, dividing and deleting
 * accounts, and commodities. Renaming, archiving, dividing and deleting go through `app`, so
 * what it keeps by account (rules, schedules, bank links) follows. */
import { ACCOUNT, BOOK, bool, date, ledgerSchema, str } from "../schemas.js";
import { seg, type Tool } from "../tool.js";

const VERSION = { type: ["string", "null"], description: "The account's `updated_at` you read." };
const path = (book: unknown, account: unknown) => `/books/${seg(book)}/accounts/${seg(account)}`;

export const accountTools: Tool[] = [
  {
    name: "write_add_account",
    domain: "accounts",
    description:
      "Open an account. Its root (Assets, Liabilities, Equity, Income, Expenses) sets its type; " +
      "levels missing in between are made. An opening balance is optional.",
    input: { book: BOOK, account: ledgerSchema("AccountIn") },
    required: ["book", "account"],
    additive: true,
    run: (ctx, { book, account }) => ctx.ledger.post(`/books/${seg(book)}/accounts`, account),
  },
  {
    name: "write_edit_account",
    domain: "accounts",
    description:
      "Change an account's settings (display name, description, booking, cards, outflow, " +
      "revaluing): only those given, against its `updated_at`.",
    input: { book: BOOK, account: ACCOUNT, changes: ledgerSchema("AccountPatch") },
    required: ["book", "account", "changes"],
    run: (ctx, { book, account, changes }) => ctx.ledger.patch(path(book, account), changes),
  },
  {
    name: "write_rename_account",
    domain: "accounts",
    description:
      "Rename (or move) an account and everything under it; rules, schedules and bank links " +
      "follow.",
    input: { book: BOOK, account: ACCOUNT, to: str("Its new full name."), updated_at: VERSION },
    required: ["book", "account", "to"],
    run: (ctx, { book, account, to, updated_at }) =>
      ctx.app.post(`${path(book, account)}/rename`, { to, updated_at }),
  },
  {
    name: "write_archive_account",
    domain: "accounts",
    description:
      "Archive (close) an account and everything under it, moving any balance left to " +
      "`transfer_to`; or bring an archived one back (`archived: false`).",
    input: {
      book: BOOK,
      account: ACCOUNT,
      archived: bool("true to archive, false to unarchive."),
      date: date("When it closes (default today)."),
      transfer_to: str("Where a balance left goes."),
      updated_at: VERSION,
    },
    required: ["book", "account", "archived"],
    run: (ctx, { book, account, archived, date, transfer_to, updated_at }) =>
      archived
        ? ctx.app.post(`${path(book, account)}/archive`, { date, transfer_to, updated_at })
        : ctx.app.post(`${path(book, account)}/unarchive`),
  },
  {
    name: "write_divide_account",
    domain: "accounts",
    description:
      "Divide an asset or liability account into parts (say Savings into Emergency and " +
      "Travel): it becomes a divided account of the same name, its history in its main part.",
    input: { book: BOOK, account: ACCOUNT, division: ledgerSchema("DivideIn") },
    required: ["book", "account", "division"],
    run: (ctx, { book, account, division }) =>
      ctx.app.post(`${path(book, account)}/divide`, division),
  },
  {
    name: "write_set_divided",
    domain: "accounts",
    description:
      "Make an account with sub-accounts a divided account (one real account its parts " +
      "divide), or not.",
    input: { book: BOOK, account: ACCOUNT, divided: bool("Divided or not."), updated_at: VERSION },
    required: ["book", "account", "divided", "updated_at"],
    run: (ctx, { book, account, divided, updated_at }) =>
      ctx.app.post(`${path(book, account)}/divided`, { divided, updated_at }),
  },
  {
    name: "read_commodities",
    domain: "accounts",
    description: "The book's commodities (currencies, shares): names, price sources.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.ledger.get(`/books/${seg(book)}/commodities`),
  },
  {
    name: "write_set_commodity",
    domain: "accounts",
    description: "Set a commodity's name, price source or how long its price stays current.",
    input: {
      book: BOOK,
      currency: str("Its symbol: VTI, EUR."),
      commodity: ledgerSchema("CommodityIn"),
    },
    required: ["book", "currency", "commodity"],
    run: (ctx, { book, currency, commodity }) =>
      ctx.ledger.put(`/books/${seg(book)}/commodities/${seg(currency)}`, commodity),
  },
  {
    name: "delete_account",
    domain: "accounts",
    description:
      "Delete an account with no transactions (or move its transactions to `substitute` " +
      "first).",
    input: {
      book: BOOK,
      account: ACCOUNT,
      substitute: str("An account to move its transactions to."),
      updated_at: VERSION,
    },
    required: ["book", "account"],
    run: (ctx, { book, account, substitute, updated_at }) =>
      ctx.app.delete(path(book, account), {
        substitute: substitute as string | undefined,
        updated_at: updated_at as string | undefined,
      }),
  },
  {
    name: "read_purge_preview",
    domain: "accounts",
    description:
      "What deleting an account with its transactions would delete: the transactions, and " +
      "every other account they touch.",
    input: { book: BOOK, account: ACCOUNT },
    required: ["book", "account"],
    run: (ctx, { book, account }) => ctx.app.get(`${path(book, account)}/purge`),
  },
  {
    name: "delete_account_and_transactions",
    domain: "accounts",
    description:
      "Delete an account and every transaction in it (read_purge_preview first says what goes).",
    input: { book: BOOK, account: ACCOUNT, updated_at: VERSION },
    required: ["book", "account"],
    run: (ctx, { book, account, updated_at }) =>
      ctx.app.post(`${path(book, account)}/purge`, { updated_at }),
  },
];

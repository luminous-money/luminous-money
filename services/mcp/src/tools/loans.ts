/** Loans: a mortgage, a car loan; their payments are a schedule's, worked out by the loan. */
import {
  ACCOUNT,
  AMOUNT,
  BOOK,
  UPDATED_AT,
  bool,
  date,
  int,
  obj,
  oneOf,
  str,
  type JsonSchema,
} from "../schemas.js";
import { seg, type Tool } from "../tool.js";

const ROW = obj(
  {
    number: int("The payment's number."),
    date: date("Its due date."),
    principal: AMOUNT,
    interest: AMOUNT,
    balance: str("What's owed after it."),
  },
  ["number", "date", "principal", "interest", "balance"]
);

/** An amortization table (shared/loans.ts's LoanTable). */
const TABLE = obj(
  {
    from: date("The first payment date it governs."),
    source: oneOf(["terms", "csv", "ai"], "Worked out from terms, or imported rows."),
    terms: {
      type: ["object", "null"],
      description: "What a `terms` table is worked out from.",
      properties: {
        amount: str("What was borrowed (or is owed when the table starts)."),
        rate: str('The yearly rate, as a percent: "3.75".'),
        payments: int("How many payments."),
        first: date("The first payment's due date."),
        payment: {
          type: ["string", "null"],
          description: "Principal and interest per payment, if the lender's differs; else null.",
        },
      },
      required: ["amount", "rate", "payments", "first", "payment"],
    },
    rate: str("The yearly rate, as a percent."),
    payment: str("Principal and interest per payment."),
    rows: { type: "array", items: ROW, description: "The payments (empty: worked out)." },
  },
  ["from", "source", "terms", "rate", "payment", "rows"]
);

const OTHER = obj(
  { name: str("Escrow, PMI, a fee."), account: ACCOUNT, amount: AMOUNT, from: date("From.") },
  ["name", "account", "amount", "from"],
  "A part of each payment beyond principal and interest, from a date (0 ends it)."
);
const EXTRA = obj(
  { amount: AMOUNT, from: date("From.") },
  ["amount", "from"],
  "Extra principal with every payment from a date (0 ends it)."
);

const ACCOUNTS = obj(
  {
    liability: str("What's owed: a Liabilities account."),
    paying: str("What pays it."),
    interest: str("Where interest goes: an Expenses account."),
    asset: { type: ["string", "null"], description: "What it bought (a house), if anything." },
  },
  ["liability", "paying", "interest", "asset"]
);

const LOAN: Record<string, JsonSchema> = {
  name: str("What it's called."),
  payee: { type: ["string", "null"], description: "The lender, as payments name it." },
  accounts: ACCOUNTS,
  currency: str("Default: the book's."),
  table: TABLE,
  others: { type: "array", items: OTHER },
  extras: { type: "array", items: EXTRA },
  tolerance: str("How far the bank's amount may be from a payment's and match it."),
  auto_confirm: bool("Stage payments confirmed."),
  history: {
    description:
      "How a loan already under way comes in: `start` (the borrowing on `on` against `against`, " +
      "then every payment through today), `today` (one transaction on `on` saying what's owed), " +
      "or `books` (the liability already says what's owed).",
    oneOf: [
      obj(
        {
          kind: { const: "start" },
          on: date("When it was borrowed."),
          against: ACCOUNT,
          confirm: bool("Stage past payments confirmed."),
        },
        ["kind", "on", "against", "confirm"]
      ),
      obj({ kind: { const: "today" }, on: date("As of."), owed: AMOUNT, against: ACCOUNT }, [
        "kind",
        "on",
        "owed",
        "against",
      ]),
      obj({ kind: { const: "books" } }, ["kind"]),
    ],
  },
};

const loans = (book: unknown) => `/books/${seg(book)}/loans`;

export const loanTools: Tool[] = [
  {
    name: "read_loans",
    domain: "loans",
    description: "The book's loans, each with what's owed and its next payment.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.app.get(loans(book)),
  },
  {
    name: "read_loan",
    domain: "loans",
    description:
      "A loan in full: its tables, escrow and fees, extras, re-bases, what's owed, and every " +
      "payment still to come.",
    input: { book: BOOK, id: str("The loan's ID.") },
    required: ["book", "id"],
    run: (ctx, { book, id }) => ctx.app.get(`${loans(book)}/${seg(id)}`),
  },
  {
    name: "write_add_loan",
    domain: "loans",
    description:
      "Declare a loan, with how its history comes into the books; what's due is staged. Open " +
      "its accounts first (the accounts skill), and add escrow's bills as schedules after.",
    input: {
      book: BOOK,
      loan: obj(LOAN, ["name", "accounts", "table", "history"]),
    },
    required: ["book", "loan"],
    additive: true,
    run: (ctx, { book, loan }) => ctx.app.post(loans(book), loan),
  },
  {
    name: "write_edit_loan",
    domain: "loans",
    description:
      "Change a loan (only the fields given), against its `updated_at`: its unconfirmed " +
      "payments from the earliest date a change touches are worked out again.",
    input: {
      book: BOOK,
      id: str("The loan's ID."),
      changes: obj(
        { updated_at: UPDATED_AT, paused: bool("Paused: stages nothing.") },
        ["updated_at"],
        "The fields to change, as write_add_loan's `loan` has them: name, payee, accounts (but " +
          "the liability), `tables` (every table: a new one takes over from its `from`), others, " +
          "extras, tolerance, auto_confirm; with the `updated_at` you read."
      ),
    },
    required: ["book", "id", "changes"],
    run: (ctx, { book, id, changes }) => ctx.app.patch(`${loans(book)}/${seg(id)}`, changes),
  },
  {
    name: "write_rebase_loan",
    domain: "loans",
    description:
      "Say what the lender says was owed on a date: the difference is written as an " +
      "adjustment against `account`.",
    input: {
      book: BOOK,
      id: str("The loan's ID."),
      rebase: obj(
        { updated_at: UPDATED_AT, on: date("The date."), owed: AMOUNT, account: ACCOUNT },
        ["updated_at", "on", "owed", "account"]
      ),
    },
    required: ["book", "id", "rebase"],
    run: (ctx, { book, id, rebase }) => ctx.app.post(`${loans(book)}/${seg(id)}/rebase`, rebase),
  },
  {
    name: "write_extra_loan_payment",
    domain: "loans",
    description: "Record an extra payment toward principal on a date.",
    input: {
      book: BOOK,
      id: str("The loan's ID."),
      payment: obj(
        {
          date: date("When."),
          amount: AMOUNT,
          from: { type: ["string", "null"], description: "What paid it (default the loan's)." },
        },
        ["date", "amount"]
      ),
    },
    required: ["book", "id", "payment"],
    additive: true,
    run: (ctx, { book, id, payment }) => ctx.app.post(`${loans(book)}/${seg(id)}/extra`, payment),
  },
  {
    name: "delete_loan",
    domain: "loans",
    description: "Delete a loan and its schedule (what they staged stays).",
    input: { book: BOOK, id: str("The loan's ID."), updated_at: UPDATED_AT },
    required: ["book", "id", "updated_at"],
    run: async (ctx, { book, id, updated_at }) => {
      await ctx.app.delete(`${loans(book)}/${seg(id)}`, { updated_at: updated_at as string });
      return { deleted: id };
    },
  },
];

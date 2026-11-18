/** Review: the staged queue, proposals, categorizing and confirming, matches, transfers paired
 * in review, the rules review learns from, and notifications. */
import {
  ACCOUNT,
  BOOK,
  UPDATED_AT,
  bool,
  int,
  obj,
  str,
  strs,
  type JsonSchema,
} from "../schemas.js";
import { seg, type Tool } from "../tool.js";
import { settleIfConfirmed } from "./base.js";

const RULE: Record<string, JsonSchema> = {
  name: str("What it's called."),
  conditions: obj(
    {
      account: { type: ["string", "null"], description: "The account imported into." },
      key: { type: ["string", "null"], description: "The description's payee key equals this." },
      contains: {
        type: ["string", "null"],
        description: "The description contains this (ignoring case).",
      },
      min: {
        type: ["string", "null"],
        description: "The amount (negative is money out) is at least this.",
      },
      max: { type: ["string", "null"], description: "The amount is at most this." },
    },
    ["account", "key", "contains", "min", "max"],
    "Every condition is optional (null), but a rule needs one; all must hold."
  ),
  account: str("The category: the account on the other side."),
  payee: { type: ["string", "null"], description: "A clean payee to give, if any." },
  auto_confirm: bool("Stage matching transactions confirmed, skipping review."),
  part: {
    type: ["string", "null"],
    description: "For a divided account imported into: the part its own side lands in.",
  },
  fund: {
    type: ["string", "null"],
    description: "A fund money out is taken from (or money in goes toward), all of it.",
  },
};

const MATCH_ROW = {
  book: BOOK,
  batch: str("The import batch's ID (read_matches)."),
  line: int("The row's line in the batch."),
};

export const reviewTools: Tool[] = [
  {
    name: "read_review_queue",
    domain: "review",
    description:
      "Transactions staged for review (flag `!`), oldest first, each with what was proposed " +
      "for it (by a rule, history or the AI) when anything was.",
    input: {
      book: BOOK,
      account: { ...ACCOUNT, description: "Only those in this account or under it." },
      limit: int("How many (default 50)."),
    },
    required: ["book"],
    run: async (ctx, { book, account, limit }) => {
      const [staged, proposals] = await Promise.all([
        ctx.ledger.get(`/books/${seg(book)}/transactions`, {
          flag: "!",
          account: account as string | undefined,
          limit: (limit as number) ?? 50,
        }) as Promise<{ id: string }[]>,
        ctx.app.get(`/books/${seg(book)}/proposals`) as Promise<Record<string, unknown>>,
      ]);
      return staged.map((t) => (proposals[t.id] ? { ...t, proposal: proposals[t.id] } : t));
    },
  },
  {
    name: "write_confirm_transactions",
    domain: "review",
    description:
      "Confirm staged transactions as they are (flag `*`), each against the `updated_at` you " +
      "read. To change one as you confirm it, use write_edit_transaction instead.",
    input: {
      book: BOOK,
      transactions: {
        type: "array",
        items: obj({ id: str("Its ID."), updated_at: UPDATED_AT }, ["id", "updated_at"]),
      },
    },
    required: ["book", "transactions"],
    run: async (ctx, { book, transactions }) => {
      const results = [];
      for (const { id, updated_at } of transactions as { id: string; updated_at: string }[]) {
        try {
          await ctx.ledger.patch(`/books/${seg(book)}/transactions/${seg(id)}`, {
            flag: "*",
            updated_at,
          });
          await settleIfConfirmed(ctx, String(book), id, "!");
          results.push({ id, confirmed: true });
        } catch (error) {
          results.push({ id, confirmed: false, error: (error as Error).message });
        }
      }
      return results;
    },
  },
  {
    name: "write_suggest_categories",
    domain: "review",
    description:
      "Propose categories for staged transactions not yet categorized, by the book's rules and " +
      "history; for the transactions named, by its AI too, when it's set up.",
    input: {
      book: BOOK,
      transactions: strs("Their IDs (the AI is asked only for these)."),
      account: { ...ACCOUNT, description: "Only those from this account or under it." },
    },
    required: ["book"],
    run: (ctx, { book, transactions, account }) =>
      ctx.app.post(`/books/${seg(book)}/suggest`, transactions ? { transactions } : {}, {
        account: account as string | undefined,
      }),
  },
  {
    name: "read_matches",
    domain: "review",
    description:
      "Imported rows matched to a transaction already in the books (one you entered, or a " +
      "schedule's), waiting to be confirmed, with their other candidates.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.app.get(`/books/${seg(book)}/matches`),
  },
  {
    name: "write_assign_match",
    domain: "review",
    description:
      "Set the transaction an imported row matches: one of its candidates, or null for none " +
      "(the row becomes a transaction of its own).",
    input: { ...MATCH_ROW, transaction: { type: ["string", "null"], description: "Its ID." } },
    required: ["book", "batch", "line", "transaction"],
    run: (ctx, { book, batch, line, transaction }) =>
      ctx.app.post(`/books/${seg(book)}/imports/${seg(batch)}/rows/${seg(line)}/assign`, {
        transaction,
      }),
  },
  {
    name: "write_confirm_match",
    domain: "review",
    description: "Confirm an imported row's match: its transaction is final.",
    input: MATCH_ROW,
    required: ["book", "batch", "line"],
    run: (ctx, { book, batch, line }) =>
      ctx.app.post(`/books/${seg(book)}/imports/${seg(batch)}/rows/${seg(line)}/confirm`),
  },
  {
    name: "read_transfers",
    domain: "review",
    description: "Transfers paired in review, each with the two imported sides it was made of.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.app.get(`/books/${seg(book)}/transfers`),
  },
  {
    name: "write_reject_transfer",
    domain: "review",
    description: "Undo a transfer paired in review: the two sides come back in its place.",
    input: { book: BOOK, transaction: str("The transfer's transaction ID.") },
    required: ["book", "transaction"],
    run: (ctx, { book, transaction }) =>
      ctx.app.post(`/books/${seg(book)}/transfers/${seg(transaction)}/reject`),
  },
  {
    name: "read_rules",
    domain: "review",
    description: "The book's matching rules: conditions, category, payee, fund, auto-confirm.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.app.get(`/books/${seg(book)}/rules`),
  },
  {
    name: "write_add_rule",
    domain: "review",
    description:
      "Add a matching rule. The answer says how many staged transactions it covers " +
      "(write_apply_rule applies it to them).",
    input: {
      book: BOOK,
      rule: obj(RULE, ["name", "conditions", "account", "payee", "auto_confirm"]),
    },
    required: ["book", "rule"],
    additive: true,
    run: (ctx, { book, rule }) => ctx.app.post(`/books/${seg(book)}/rules`, rule),
  },
  {
    name: "write_edit_rule",
    domain: "review",
    description: "Change a rule: only the fields given, against the `updated_at` you read.",
    input: {
      book: BOOK,
      id: str("The rule's ID."),
      changes: obj(
        { updated_at: UPDATED_AT },
        ["updated_at"],
        "The fields of write_add_rule's `rule` to change (conditions whole), with the " +
          "`updated_at` you read."
      ),
    },
    required: ["book", "id", "changes"],
    run: (ctx, { book, id, changes }) =>
      ctx.app.patch(`/books/${seg(book)}/rules/${seg(id)}`, changes),
  },
  {
    name: "write_apply_rule",
    domain: "review",
    description: "Apply a rule to the staged transactions it covers that haven't been touched.",
    input: { book: BOOK, id: str("The rule's ID.") },
    required: ["book", "id"],
    run: (ctx, { book, id }) => ctx.app.post(`/books/${seg(book)}/rules/${seg(id)}/apply`),
  },
  {
    name: "delete_rule",
    domain: "review",
    description: "Delete a rule, against the `updated_at` you read.",
    input: { book: BOOK, id: str("The rule's ID."), updated_at: UPDATED_AT },
    required: ["book", "id", "updated_at"],
    run: async (ctx, { book, id, updated_at }) => {
      await ctx.app.delete(`/books/${seg(book)}/rules/${seg(id)}`, {
        updated_at: updated_at as string,
      });
      return { deleted: id };
    },
  },
  {
    name: "read_notifications",
    domain: "review",
    description:
      "What needs attention in the book: a sale no fund was named for, a bank or Amazon " +
      "connection that needs signing in again, and the like.",
    input: { book: BOOK },
    required: ["book"],
    run: (ctx, { book }) => ctx.app.get(`/books/${seg(book)}/notifications`),
  },
  {
    name: "write_dismiss_notification",
    domain: "review",
    description: "Dismiss a notification for yourself (those that can be; others go once fixed).",
    input: { book: BOOK, id: str("The notification's ID.") },
    required: ["book", "id"],
    run: (ctx, { book, id }) =>
      ctx.app.put(`/books/${seg(book)}/notifications/${seg(id)}/dismissed`),
  },
];

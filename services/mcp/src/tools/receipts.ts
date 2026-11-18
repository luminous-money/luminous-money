/** Receipts and orders: what's attached to transactions, reading an attached receipt into its
 * transaction, and Amazon's charges itemized. (Sending a file in is for later: uploads.) */
import { BOOK, bool, str } from "../schemas.js";
import { seg, type Tool } from "../tool.js";

export const receiptTools: Tool[] = [
  {
    name: "read_attachments",
    domain: "receipts",
    description: "The files attached to a transaction (receipts, statements).",
    input: { book: BOOK, transaction: str("The transaction's ID.") },
    required: ["book", "transaction"],
    run: (ctx, { book, transaction }) =>
      ctx.ledger.get(`/books/${seg(book)}/transactions/${seg(transaction)}/attachments`),
  },
  {
    name: "write_read_receipt",
    domain: "receipts",
    description:
      "Read a receipt attached to a transaction into it, with the book's AI: its lines become " +
      "its splits (itemized, or not), categorized, and it goes back to review. It takes a " +
      "minute or more: this starts it, and read_job says when it's done.",
    input: {
      book: BOOK,
      transaction: str("The transaction's ID."),
      attachment: str("The attachment's ID (read_attachments)."),
      itemize: bool("One split per line (default: the book's setting)."),
    },
    required: ["book", "transaction", "attachment"],
    run: (ctx, { book, transaction, attachment, itemize }) => {
      const form = new FormData();
      form.set("attachment", String(attachment));
      if (itemize !== undefined) form.set("itemize", itemize ? "yes" : "no");
      return ctx.app.post(
        `/books/${seg(book)}/transactions/${seg(transaction)}/receipt`,
        form,
        undefined,
        { prefer: "respond-async" }
      );
    },
  },
  {
    name: "read_job",
    domain: "receipts",
    description: "A receipt being read: running (with its step), done (what it made), or failed.",
    input: { book: BOOK, id: str("The job's ID.") },
    required: ["book", "id"],
    run: (ctx, { book, id }) => ctx.app.get(`/books/${seg(book)}/jobs/${seg(id)}`),
  },
  {
    name: "read_orders",
    domain: "receipts",
    description:
      "Charges read from a shop (Amazon) and their orders: itemized into their transaction, " +
      "or waiting for one.",
    input: { book: BOOK, shop: str("Only this shop's (amazon).") },
    required: ["book"],
    run: (ctx, { book, shop }) =>
      ctx.app.get(`/books/${seg(book)}/orders`, { shop: shop as string | undefined }),
  },
  {
    name: "write_assign_order",
    domain: "receipts",
    description: "Itemize a waiting shop charge into the transaction it is.",
    input: {
      book: BOOK,
      shop: str("The shop (amazon)."),
      id: str("The charge's ID."),
      transaction_id: str("The transaction's ID."),
    },
    required: ["book", "shop", "id", "transaction_id"],
    run: (ctx, { book, shop, id, transaction_id }) =>
      ctx.app.post(`/books/${seg(book)}/orders/${seg(shop)}/${seg(id)}/assign`, {
        transaction_id,
      }),
  },
];

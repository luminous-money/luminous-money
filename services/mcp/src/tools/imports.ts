/** Imports and bank feeds: what came in, and syncing a bank now. (Importing a file is for
 * later: uploads.) */
import { BOOK, str } from "../schemas.js";
import { seg, type Tool } from "../tool.js";

export const importTools: Tool[] = [
  {
    name: "read_imports",
    domain: "imports",
    description: "The book's imports (files and bank feeds), newest first.",
    input: { book: BOOK, account: str("Only those into this account.") },
    required: ["book"],
    run: (ctx, { book, account }) =>
      ctx.app.get(`/books/${seg(book)}/imports`, { account: account as string | undefined }),
  },
  {
    name: "read_import",
    domain: "imports",
    description: "One import's rows: what each became (new, matched, a duplicate).",
    input: { book: BOOK, batch: str("The import's ID.") },
    required: ["book", "batch"],
    run: (ctx, { book, batch }) => ctx.app.get(`/books/${seg(book)}/imports/${seg(batch)}`),
  },
  {
    name: "read_bank_feeds",
    domain: "imports",
    description:
      "The bank connections (SimpleFIN) the book sees (the user's own, and those shared with " +
      "it, only their shared accounts), and each of the book's linked accounts: what its bank " +
      "reports and how syncing is going.",
    input: { book: BOOK },
    required: ["book"],
    run: async (ctx, { book }) => ({
      connections: await ctx.app.get(`/books/${seg(book)}/simplefin/connections`),
      accounts: await ctx.app.get(`/books/${seg(book)}/simplefin/status`),
    }),
  },
  {
    name: "write_sync_bank_feed",
    domain: "imports",
    description:
      "Sync a bank connection the book sees now: what's new comes in, staged for review (in " +
      "every book it's linked in).",
    input: { book: BOOK, connection: str("The connection's ID (read_bank_feeds).") },
    required: ["book", "connection"],
    additive: true,
    run: (ctx, { book, connection }) =>
      ctx.app.post(`/books/${seg(book)}/simplefin/connections/${seg(connection)}/sync`),
  },
];

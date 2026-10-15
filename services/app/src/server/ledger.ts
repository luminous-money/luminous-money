/**
 * What the app server needs from the ledger, as an interface (so the import logic can be tested
 * against a fake), and its real implementation over HTTP, acting as the user. Inside the stack,
 * services trust X-User-Id: Traefik set it on the request that reached us, and we pass it on.
 */
import {
  createLedgerClient,
  type Account,
  type components,
  type AccountSummary,
  type CompactTransaction,
  type FetchResult,
  type Transaction,
  type TransactionIn,
} from "@fava-beans/ledger-client";

export type Book = components["schemas"]["Book"];
export type LedgerPage = components["schemas"]["LedgerPage"];

export class LedgerError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface LedgerPort {
  /** The user's books, oldest first. */
  listBooks(): Promise<Book[]>;
  /** The book, if it exists and the user owns it. */
  book(book: string): Promise<Book | undefined>;
  /** A new book, named `name` (unique among the user's books), optionally starting as a copy of
   * Beancount `text` (an export). */
  createBook(name: string, text?: string): Promise<Book>;
  /** Delete the book and everything in it, against the version read. */
  deleteBook(book: string, updated_at: string): Promise<void>;
  accounts(book: string): Promise<Account[]>;
  /** The accounts asked for that exist, with balances and opening-balance dates. */
  summary(book: string, accounts: string[]): Promise<AccountSummary[]>;
  createAccount(book: string, name: string): Promise<Account>;
  accountLedger(book: string, account: string, cursor?: string): Promise<LedgerPage>;
  /** All of them or none. */
  createTransactions(book: string, transactions: TransactionIn[]): Promise<Transaction[]>;
  transaction(book: string, id: string): Promise<Transaction>;
  /** Every transaction from `from` on, oldest first, compactly: categorizers' context. */
  compact(book: string, from: string): Promise<CompactTransaction[]>;
  /** Change a transaction's fields (only those given), against the version read. */
  patch(
    book: string,
    id: string,
    changes: Partial<Pick<TransactionIn, "postings" | "payee" | "flag">>,
    updated_at: string
  ): Promise<Transaction>;
  /** The book's pending (`!`) transactions. */
  pending(book: string): Promise<Transaction[]>;
  /** Fetch the latest prices of commodities still held that name a source. */
  fetchPrices(book: string): Promise<FetchResult>;
  /** Create and delete (with the versions read) in one write, or not at all. Returns the
   * created transactions. */
  applyChanges(
    book: string,
    changes: { create: TransactionIn[]; delete: { id: string; updated_at: string }[] }
  ): Promise<Transaction[]>;
}

export function httpLedger(baseUrl: string, userId: string): LedgerPort {
  const client = createLedgerClient({ baseUrl, headers: { "X-User-Id": userId } });
  const unwrap = async <T>(
    call: Promise<{ data?: T; error?: unknown; response: Response }>
  ): Promise<T> => {
    const { data, error, response } = await call;
    if (response.ok && data !== undefined) return data;
    const detail = (error as { detail?: unknown } | undefined)?.detail;
    throw new LedgerError(
      response.status,
      typeof detail === "string" ? detail : JSON.stringify(detail ?? response.statusText)
    );
  };

  return {
    listBooks: () => unwrap(client.GET("/api/ledger/v1/books")),
    createBook: (name, text) =>
      unwrap(client.POST("/api/ledger/v1/books", { body: { name, text: text ?? null } })),
    async deleteBook(book, updated_at) {
      const { error, response } = await client.DELETE("/api/ledger/v1/books/{book_id}", {
        params: { path: { book_id: book }, query: { updated_at } },
      });
      if (response.ok) return;
      const detail = (error as { detail?: unknown } | undefined)?.detail;
      throw new LedgerError(
        response.status,
        typeof detail === "string" ? detail : "couldn't delete"
      );
    },
    async book(book) {
      const { data, response } = await client.GET("/api/ledger/v1/books/{book_id}", {
        params: { path: { book_id: book } },
      });
      if (response.status === 404) return undefined;
      if (!data) throw new LedgerError(response.status, "couldn't read the book");
      return data;
    },
    accounts: (book) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/accounts", {
          params: { path: { book_id: book } },
        })
      ),
    summary: (book, accounts) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/accounts/summary", {
          params: { path: { book_id: book }, query: { account: accounts } },
        })
      ),
    createAccount: (book, name) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/accounts", {
          params: { path: { book_id: book } },
          body: { name, kind: "leaf" },
        })
      ),
    accountLedger: (book, account, cursor) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/ledger", {
          params: { path: { book_id: book, account }, query: { cursor, limit: 1000 } },
        })
      ),
    transaction: (book, id) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
          params: { path: { book_id: book, directive_id: id } },
        })
      ),
    compact: (book, from) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/transactions/compact", {
          params: { path: { book_id: book }, query: { from } },
        })
      ),
    patch: (book, id, changes, updated_at) =>
      unwrap(
        client.PATCH("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
          params: { path: { book_id: book, directive_id: id } },
          body: { ...changes, updated_at },
        })
      ),
    fetchPrices: (book) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/prices/fetch", {
          params: { path: { book_id: book } },
        })
      ),
    pending: (book) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/transactions", {
          params: { path: { book_id: book }, query: { flag: "!", limit: 5000 } },
        })
      ),
    applyChanges: (book, changes) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/transactions/changes", {
          params: { path: { book_id: book } },
          body: changes,
        })
      ),
    createTransactions: (book, transactions) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/transactions/batch", {
          params: { path: { book_id: book } },
          body: transactions,
        })
      ),
  };
}

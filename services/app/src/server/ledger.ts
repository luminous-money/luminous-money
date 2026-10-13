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
  /** The book, if it exists and the user owns it. */
  book(book: string): Promise<Book | undefined>;
  accounts(book: string): Promise<Account[]>;
  /** The accounts asked for that exist, with balances and opening-balance dates. */
  summary(book: string, accounts: string[]): Promise<AccountSummary[]>;
  createAccount(book: string, name: string): Promise<Account>;
  accountLedger(book: string, account: string, cursor?: string): Promise<LedgerPage>;
  /** All of them or none. */
  createTransactions(book: string, transactions: TransactionIn[]): Promise<Transaction[]>;
  transaction(book: string, id: string): Promise<Transaction>;
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

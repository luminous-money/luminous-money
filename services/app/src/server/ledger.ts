/**
 * What the app server needs from the ledger, as an interface (so the import logic can be tested
 * against a fake), and its real implementation over HTTP, acting as the user. Inside the stack,
 * services trust X-User-Id: Traefik set it on the request that reached us, and we pass it on.
 */
import {
  createLedgerClient,
  type Account,
  type AccountIn,
  type components,
  type AccountSummary,
  type CompactTransaction,
  type FetchResult,
  type Holdings,
  type PriceOut,
  type TradeIn,
  type TradePreview,
  type Transaction,
  type TransactionIn,
} from "@fava-beans/ledger-client";

export type Book = components["schemas"]["Book"];
export type LedgerPage = components["schemas"]["LedgerPage"];
export type TransactionEdit = components["schemas"]["TransactionEdit"];
export type PriceIn = components["schemas"]["PriceIn"];
export type TreeAccount = components["schemas"]["TreeAccount"];
export type BudgetStatus = components["schemas"]["BudgetStatus"];
export type Member = components["schemas"]["Member"];
export type Role = NonNullable<Book["role"]>;

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
  /** A leaf by its full name (nodes on the way are made too), with any of AccountIn's extras:
   * an opening balance, opening holdings. */
  createAccount(book: string, name: string, extra?: Partial<AccountIn>): Promise<Account>;
  /** Rename or move an account and everything under it (every directive naming them). */
  renameAccount(book: string, account: string, to: string, updated_at?: string): Promise<Account>;
  /** Close an account and its subtree (after an optional closing transfer); the names closed. */
  archiveAccount(
    book: string,
    account: string,
    archive: { date?: string; transfer_to?: string; updated_at?: string }
  ): Promise<string[]>;
  unarchiveAccount(book: string, account: string): Promise<string[]>;
  /** Delete an account and its subtree, moving their splits to `substitute`; the names deleted. */
  deleteAccount(
    book: string,
    account: string,
    substitute?: string,
    updated_at?: string
  ): Promise<string[]>;
  /** An account's (or a brokerage's) holdings: units, cost basis, value per commodity. */
  holdings(book: string, account: string): Promise<Holdings>;
  /** Record a price (one per commodity and date: the same date replaces it). */
  addPrice(book: string, price: PriceIn): Promise<PriceOut>;
  /** What a trade would write: its transaction (lots booked, gains split), not written. */
  previewTrade(book: string, account: string, trade: TradeIn): Promise<TradePreview>;
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
  /** The book's unconfirmed (`!`) transactions. */
  unconfirmed(book: string): Promise<Transaction[]>;
  /** Who has the book: its owner, then its members (M13). */
  members(book: string): Promise<Member[]>;
  /** Add a member, or change one's role (against the version read): the caller must manage. */
  putMember(
    book: string,
    user: string,
    member: { role: "read" | "write" | "manage"; updated_at?: string | null }
  ): Promise<Member>;
  /** Take a member out (a manager), or leave (the caller themselves). */
  removeMember(book: string, user: string): Promise<void>;
  /** Every account with its balance and its subtree's (the chart of accounts). */
  accountTree(book: string): Promise<TreeAccount[]>;
  /** A commodity's prices, newest first. */
  priceHistory(book: string, commodity: string): Promise<PriceOut[]>;
  /** Every budget in force on `on`, and the highest-level expense budgets' month (M11). */
  budgetStatus(book: string, on: string, basis: "period" | "month"): Promise<BudgetStatus>;
  /** Fetch the latest prices of commodities still held that name a source. */
  fetchPrices(book: string): Promise<FetchResult>;
  /** Create, change and delete (with the versions read) in one write, or not at all. Returns
   * the created transactions. */
  applyChanges(
    book: string,
    changes: {
      create: TransactionIn[];
      update?: TransactionEdit[];
      delete: { id: string; updated_at: string }[];
    }
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
    createAccount: (book, name, extra = {}) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/accounts", {
          params: { path: { book_id: book } },
          body: { name, kind: "leaf", ...extra },
        })
      ),
    renameAccount: (book, account, to, updated_at) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/accounts/{account}/rename", {
          params: { path: { book_id: book, account } },
          body: { to, updated_at: updated_at ?? null },
        })
      ),
    archiveAccount: (book, account, a) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/accounts/{account}/archive", {
          params: { path: { book_id: book, account } },
          body: {
            date: a.date ?? null,
            transfer_to: a.transfer_to ?? null,
            updated_at: a.updated_at ?? null,
          },
        })
      ),
    unarchiveAccount: (book, account) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/accounts/{account}/unarchive", {
          params: { path: { book_id: book, account } },
        })
      ),
    deleteAccount: (book, account, substitute, updated_at) =>
      unwrap(
        client.DELETE("/api/ledger/v1/books/{book_id}/accounts/{account}", {
          params: { path: { book_id: book, account }, query: { substitute, updated_at } },
        })
      ),
    holdings: (book, account) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/holdings", {
          params: { path: { book_id: book, account } },
        })
      ),
    addPrice: (book, price) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/prices", {
          params: { path: { book_id: book } },
          body: price,
        })
      ),
    previewTrade: (book, account, trade) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/accounts/{account}/trades/preview", {
          params: { path: { book_id: book, account } },
          body: trade,
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
    members: (book) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/members", {
          params: { path: { book_id: book } },
        })
      ),
    putMember: (book, user, member) =>
      unwrap(
        client.PUT("/api/ledger/v1/books/{book_id}/members/{user_id}", {
          params: { path: { book_id: book, user_id: user } },
          body: member,
        })
      ),
    removeMember: async (book, user) => {
      const { response, error } = await client.DELETE(
        "/api/ledger/v1/books/{book_id}/members/{user_id}",
        {
          params: { path: { book_id: book, user_id: user } },
        }
      );
      if (response.ok) return;
      const detail = (error as { detail?: unknown } | undefined)?.detail;
      throw new LedgerError(
        response.status,
        typeof detail === "string" ? detail : "couldn't remove"
      );
    },
    accountTree: (book) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/accounts/tree", {
          params: { path: { book_id: book } },
        })
      ),
    priceHistory: (book, commodity) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/prices", {
          params: { path: { book_id: book }, query: { commodity } },
        })
      ),
    budgetStatus: (book, on, basis) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/budgets/status", {
          params: { path: { book_id: book }, query: { on, basis } },
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
    unconfirmed: (book) =>
      unwrap(
        client.GET("/api/ledger/v1/books/{book_id}/transactions", {
          params: { path: { book_id: book }, query: { flag: "!", limit: 5000 } },
        })
      ),
    applyChanges: (book, changes) =>
      unwrap(
        client.POST("/api/ledger/v1/books/{book_id}/transactions/changes", {
          params: { path: { book_id: book } },
          body: { ...changes, update: changes.update ?? [] },
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

/** The ledger API, reached through the same origin that served the app. */
import {
  createLedgerClient,
  type Account,
  type Book,
  type components,
  type LedgerPage,
  type MoneyAccount,
  type MoneyAccountIn,
  type Transaction,
  type TransactionIn,
} from "@fava-beans/ledger-client";

export const ledger = createLedgerClient({ baseUrl: window.location.origin });

export type TransactionChanges = Omit<components["schemas"]["TransactionPatch"], "updated_at">;
export type AccountKind = components["schemas"]["AccountIn"]["kind"];

/** An API error with its status, so callers can tell a conflict (409) from a rejection (422). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }

  get conflict() {
    return this.status === 409;
  }
}

type Result<T> = { data?: T; error?: unknown; response: Response };

/** Unwrap a client call, turning API errors into readable exceptions. */
export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await call;
  if (response.ok && data !== undefined) return data;
  throw new ApiError(
    response.status,
    describe(error) ?? `${response.status} ${response.statusText}`
  );
}

function describe(error: unknown): string | undefined {
  const detail = (error as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === "string" ? d : ((d as { msg?: string }).msg ?? JSON.stringify(d))))
      .join("; ");
  }
  return undefined;
}

export const api = {
  books: (): Promise<Book[]> => unwrap(ledger.GET("/api/ledger/v1/books")),

  createBook: (name: string): Promise<Book> =>
    unwrap(ledger.POST("/api/ledger/v1/books", { body: { name } })),

  renameBook: (book_id: string, name: string, version: string): Promise<Book> =>
    unwrap(
      ledger.PATCH("/api/ledger/v1/books/{book_id}", {
        params: { path: { book_id } },
        body: { name, updated_at: version },
      })
    ),

  moneyAccounts: (book_id: string): Promise<MoneyAccount[]> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/money-accounts", { params: { path: { book_id } } })
    ),

  createMoneyAccount: (book_id: string, body: MoneyAccountIn): Promise<MoneyAccount> =>
    unwrap(
      ledger.POST("/api/ledger/v1/books/{book_id}/money-accounts", {
        params: { path: { book_id } },
        body,
      })
    ),

  accountLedger: (book_id: string, account: string, cursor?: string): Promise<LedgerPage> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/ledger", {
        params: { path: { book_id, account }, query: { cursor, limit: 200 } },
      })
    ),

  createTransaction: (book_id: string, body: TransactionIn): Promise<Transaction> =>
    unwrap(
      ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
        params: { path: { book_id } },
        body,
      })
    ),

  accounts: (book_id: string): Promise<Account[]> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/accounts", { params: { path: { book_id } } })
    ),

  createAccount: (book_id: string, name: string, kind: AccountKind): Promise<Account> =>
    unwrap(
      ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
        params: { path: { book_id } },
        body: { name, kind },
      })
    ),

  staged: (book_id: string): Promise<Transaction[]> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/transactions", {
        params: { path: { book_id }, query: { flag: "!", limit: 1000 } },
      })
    ),

  transaction: (book_id: string, directive_id: string): Promise<Transaction> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
        params: { path: { book_id, directive_id } },
      })
    ),

  /** Change only the given fields, against the version read. */
  patch: (
    book_id: string,
    directive_id: string,
    changes: TransactionChanges,
    version: string
  ): Promise<Transaction> =>
    unwrap(
      ledger.PATCH("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
        params: { path: { book_id, directive_id } },
        body: { ...changes, updated_at: version },
      })
    ),
};

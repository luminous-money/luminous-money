/** The ledger API, reached through the same origin that served the app. */
import {
  createLedgerClient,
  type Account,
  type AccountIn,
  type AccountPatch,
  type AccountSummary,
  type CommodityOut,
  type Holdings,
  type PriceOut,
  type TradeIn,
  type TradePreview,
  type components as Components,
  type Book,
  type components,
  type LedgerPage,
  type Transaction,
  type TransactionIn,
} from "@fava-beans/ledger-client";

import { apiFetch } from "./session.js";

// Every call refreshes the session on a 401 (see session.ts).
export const ledger = createLedgerClient({
  baseUrl: window.location.origin,
  fetch: (request) => apiFetch(request),
});

export type TreeAccount = Components["schemas"]["TreeAccount"];
export type JournalPage = Components["schemas"]["JournalPage"];
export type JournalRow = Components["schemas"]["JournalRow"];
export type Budget = Components["schemas"]["Budget"];
export type BudgetIn = Components["schemas"]["BudgetIn"];
export type BudgetLine = Components["schemas"]["BudgetLine"];
export type BudgetStatus = Components["schemas"]["BudgetStatus"];
export type BudgetBasis = BudgetStatus["basis"];

export type TransactionChanges = Omit<components["schemas"]["TransactionPatch"], "updated_at">;
export type AccountKind = components["schemas"]["AccountIn"]["kind"];
/** Where a ledger page is: older than `cursor`, newer than `after`, or from `date` back. */
export type LedgerPageAt = { cursor?: string; after?: string; date?: string };

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
  // Books are listed, created and deleted through the app API (appApi), which keeps their settings.

  renameBook: (book_id: string, name: string, version: string): Promise<Book> =>
    unwrap(
      ledger.PATCH("/api/ledger/v1/books/{book_id}", {
        params: { path: { book_id } },
        body: { name, updated_at: version },
      })
    ),

  /** What an account (and everything under it) holds, valued. */
  holdings: (book_id: string, account: string): Promise<Holdings> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/holdings", {
        params: { path: { book_id, account } },
      })
    ),

  commodities: (book_id: string): Promise<CommodityOut[]> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/commodities", { params: { path: { book_id } } })
    ),

  setCommodity: (
    book_id: string,
    currency: string,
    body: {
      name: string | null;
      price_source: string | null;
      stale_after: number | null;
      updated_at: string | null;
    }
  ): Promise<CommodityOut> =>
    unwrap(
      ledger.PUT("/api/ledger/v1/books/{book_id}/commodities/{currency}", {
        params: { path: { book_id, currency } },
        body,
      })
    ),

  addPrice: (
    book_id: string,
    body: { date: string; commodity: string; price: { number: string; currency: string } }
  ): Promise<PriceOut> =>
    unwrap(
      ledger.POST("/api/ledger/v1/books/{book_id}/prices", { params: { path: { book_id } }, body })
    ),

  revalue: (
    book_id: string,
    account: string,
    body: { date: string; value: { number: string; currency: string } }
  ): Promise<Transaction> =>
    unwrap(
      ledger.POST("/api/ledger/v1/books/{book_id}/accounts/{account}/revalue", {
        params: { path: { book_id, account } },
        body,
      })
    ),

  setAccount: (book_id: string, account: string, body: AccountPatch): Promise<Account> =>
    unwrap(
      ledger.PATCH("/api/ledger/v1/books/{book_id}/accounts/{account}", {
        params: { path: { book_id, account } },
        body,
      })
    ),

  previewTrade: (book_id: string, account: string, body: TradeIn): Promise<TradePreview> =>
    unwrap(
      ledger.POST("/api/ledger/v1/books/{book_id}/accounts/{account}/trades/preview", {
        params: { path: { book_id, account } },
        body,
      })
    ),

  trade: (book_id: string, account: string, body: TradeIn): Promise<Transaction> =>
    unwrap(
      ledger.POST("/api/ledger/v1/books/{book_id}/accounts/{account}/trades", {
        params: { path: { book_id, account } },
        body,
      })
    ),

  /** The accounts asked for that exist, with balances and opening-balance dates. */
  summary: (book_id: string, accounts: string[]): Promise<AccountSummary[]> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/accounts/summary", {
        params: { path: { book_id }, query: { account: accounts } },
      })
    ),

  /** A page of an account's ledger: the newest, or one either side of a row, or from a date. */
  accountLedger: (book_id: string, account: string, page: LedgerPageAt = {}): Promise<LedgerPage> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/accounts/{account}/ledger", {
        params: { path: { book_id, account }, query: { ...page, limit: 200 } },
      })
    ),

  /** A page of the book's journal: every account's transactions, newest first, paged as an
   * account's ledger is. */
  journal: (book_id: string, page: LedgerPageAt = {}): Promise<JournalPage> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/journal", {
        params: { path: { book_id }, query: { ...page, limit: 200 } },
      })
    ),

  createTransaction: (book_id: string, body: TransactionIn): Promise<Transaction> =>
    unwrap(
      ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
        params: { path: { book_id } },
        body,
      })
    ),

  /** The chart of accounts: every account, with its own and its subtree's balances. */
  /** Every budget in force on `on`, measured over its period (or all per month). */
  budgetStatus: (book_id: string, on: string, basis: BudgetBasis): Promise<BudgetStatus> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/budgets/status", {
        params: { path: { book_id }, query: { on, basis } },
      })
    ),

  /** Set an account's budget from `start` on (0 ends it); null when that left none. */
  setBudget: (book_id: string, account: string, body: BudgetIn): Promise<Budget | null> =>
    unwrap(
      ledger.PUT("/api/ledger/v1/books/{book_id}/budgets/{account}", {
        params: { path: { book_id, account } },
        body,
      })
    ),

  accountTree: (book_id: string): Promise<TreeAccount[]> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/accounts/tree", { params: { path: { book_id } } })
    ),

  accounts: (book_id: string): Promise<Account[]> =>
    unwrap(
      ledger.GET("/api/ledger/v1/books/{book_id}/accounts", { params: { path: { book_id } } })
    ),

  createAccount: (book_id: string, body: AccountIn): Promise<Account> =>
    unwrap(
      ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
        params: { path: { book_id } },
        body,
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

  /** Delete a transaction, against the version read. */
  deleteTransaction: async (book_id: string, t: Transaction): Promise<void> => {
    await unwrap(
      ledger.POST("/api/ledger/v1/books/{book_id}/transactions/changes", {
        params: { path: { book_id } },
        body: { create: [], delete: [{ id: t.id, updated_at: t.updated_at }] },
      })
    );
  },

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

/**
 * Server state, through TanStack Query: reads are queries, edits are mutations.
 *
 * Edits to a transaction run one at a time, in order (a mutation scope per transaction), and each
 * reads the transaction's current version (`updated_at`) when it runs, not when it was queued. A
 * description saved on blur and a confirm a moment later therefore apply in order, and neither
 * can undo the other. Edits are partial (PATCH), so each one touches only its own fields. If the
 * version has moved on elsewhere (another tab or device), the edit is refused (409) and the data
 * is refetched.
 */
import type { Account, Transaction } from "@fava-beans/ledger-client";
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AccountCreation } from "../components/AccountPicker.js";
import { api, ApiError, type AccountKind, type TransactionChanges } from "./ledger.js";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

export const keys = {
  books: ["books"] as const,
  book: (book: string) => ["book", book] as const,
  accounts: (book: string) => ["book", book, "accounts"] as const,
  queue: (book: string) => ["book", book, "queue"] as const,
  transaction: (book: string, id: string) => ["book", book, "transaction", id] as const,
};

export type BookSummary = { id: string; staged: number };

export function useBooks() {
  return useQuery({
    queryKey: keys.books,
    queryFn: async (): Promise<BookSummary[]> => {
      const books = await api.books();
      return Promise.all(books.map(async (id) => ({ id, staged: (await api.staged(id)).length })));
    },
  });
}

export function useAccounts(book: string) {
  return useQuery({ queryKey: keys.accounts(book), queryFn: () => api.accounts(book) });
}

export function useQueue(book: string) {
  return useQuery({ queryKey: keys.queue(book), queryFn: () => api.staged(book) });
}

export function useTransaction(book: string, id: string) {
  return useQuery({
    queryKey: keys.transaction(book, id),
    queryFn: () => api.transaction(book, id),
  });
}

/** The freshest copy we have: the transaction's own query, the queue, or the server. */
async function latest(book: string, id: string): Promise<Transaction> {
  return (
    queryClient.getQueryData<Transaction>(keys.transaction(book, id)) ??
    queryClient.getQueryData<Transaction[]>(keys.queue(book))?.find((t) => t.id === id) ??
    (await api.transaction(book, id))
  );
}

/** Put a saved transaction everywhere it's cached. Confirmed ones leave the queue. */
function remember(book: string, saved: Transaction) {
  queryClient.setQueryData(keys.transaction(book, saved.id), saved);
  queryClient.setQueryData<Transaction[]>(keys.queue(book), (queue) =>
    queue?.flatMap((t) => (t.id !== saved.id ? [t] : saved.flag === "!" ? [saved] : []))
  );
  void queryClient.invalidateQueries({ queryKey: keys.books });
}

export function useEditTransaction(book: string, id: string) {
  const client = useQueryClient();
  return useMutation({
    scope: { id: `transaction:${book}:${id}` },
    mutationFn: async (changes: TransactionChanges) => {
      const current = await latest(book, id);
      return api.patch(book, id, changes, current.updated_at);
    },
    onSuccess: (saved) => remember(book, saved),
    onError: (error) => {
      if (error instanceof ApiError && error.conflict) {
        void client.invalidateQueries({ queryKey: keys.book(book) });
      }
    },
  });
}

export function useCreateAccount(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, kind }: { name: string; kind: AccountKind }) =>
      api.createAccount(book, name, kind),
    onSuccess: (account) => {
      client.setQueryData<Account[]>(
        keys.accounts(book),
        (accounts) => accounts && [...accounts.filter((a) => a.name !== account.name), account]
      );
      void client.invalidateQueries({ queryKey: keys.accounts(book) });
    },
  });
}

/** "Create account" for a book's pickers, once its accounts have loaded. */
export function useAccountCreation(book: string): AccountCreation | undefined {
  const accounts = useAccounts(book);
  const create = useCreateAccount(book);
  if (!accounts.data) return undefined;
  return {
    accounts: accounts.data,
    submit: (name, kind) => create.mutateAsync({ name, kind }),
  };
}

/** What went wrong, for display. Conflicts get a hint that the data has been refreshed. */
export function explain(error: unknown): string {
  if (error instanceof ApiError && error.conflict)
    return "This changed somewhere else; it's been reloaded.";
  return (error as Error).message;
}

const skippedKey = (book: string) => `fava-beans:skipped:${book}`;

/** Skipped IDs, last skipped last. They stay skipped for the browser session. */
export function readSkipped(book: string): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(skippedKey(book)) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function writeSkipped(book: string, ids: string[]) {
  sessionStorage.setItem(skippedKey(book), JSON.stringify(ids));
}

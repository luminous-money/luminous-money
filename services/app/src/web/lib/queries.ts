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
import type {
  Account,
  Book,
  AccountIn,
  Transaction,
  TransactionIn,
} from "@fava-beans/ledger-client";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { AccountCreation } from "../components/AccountPicker.js";
import { appApi, type CsvProfile } from "./appApi.js";
import { api, ApiError, type TransactionChanges } from "./ledger.js";
import { logIn, logOut, me, type User } from "./session.js";

/** A 401 from anywhere means the session is over: forget the user, and the app shows login. */
const onError = (error: unknown) => {
  if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(keys.me, null);
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    },
  },
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
});

export const keys = {
  me: ["me"] as const,
  books: ["books"] as const,
  book: (book: string) => ["book", book] as const,
  accounts: (book: string) => ["book", book, "accounts"] as const,
  summary: (book: string, accounts: string[]) => ["book", book, "summary", ...accounts] as const,
  stars: (book: string) => ["book", book, "stars"] as const,
  lastImports: (book: string) => ["book", book, "last-imports"] as const,
  ledger: (book: string, account: string) => ["book", book, "ledger", account] as const,
  profiles: (book: string, account: string) => ["book", book, "profiles", account] as const,
  queue: (book: string) => ["book", book, "queue"] as const,
  transaction: (book: string, id: string) => ["book", book, "transaction", id] as const,
};

// Session

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: me, staleTime: Infinity });
}

/** A new session (or none): forget everything cached for the old one, but keep the session
 * query itself, which the app is watching (removing it would leave the app watching a query
 * nothing updates any more). */
function switchSession(client: QueryClient, user: User | null) {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== keys.me[0] });
  client.setQueryData(keys.me, user);
}

export function useLogIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: logIn,
    onSuccess: (user: User) => switchSession(client, user),
  });
}

export function useLogOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: logOut,
    onSuccess: () => switchSession(client, null),
  });
}

// Books

export function useBooks() {
  return useQuery({ queryKey: keys.books, queryFn: api.books });
}

/** The book the app shows. M1 users have exactly one; M7 makes this a choice. */
export function useCurrentBook(): { book: Book | undefined; loading: boolean } {
  const books = useBooks();
  return { book: books.data?.[0], loading: books.isPending };
}

export function useCreateBook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createBook(name),
    onSuccess: (book) =>
      client.setQueryData<Book[]>(keys.books, (books) => [...(books ?? []), book]),
  });
}

export function useRenameBook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ book, name }: { book: Book; name: string }) =>
      api.renameBook(book.id, name, book.updated_at),
    onSuccess: (renamed) =>
      client.setQueryData<Book[]>(keys.books, (books) =>
        books?.map((b) => (b.id === renamed.id ? renamed : b))
      ),
    onError: (error) => {
      if (error instanceof ApiError && error.conflict)
        void client.invalidateQueries({ queryKey: keys.books });
    },
  });
}

// Money accounts, ledgers and imports

/** Accounts with their balances and opening-balance dates, in the order asked. */
export function useSummary(book: string, accounts: string[] | undefined) {
  return useQuery({
    queryKey: keys.summary(book, accounts ?? []),
    queryFn: () => (accounts!.length ? api.summary(book, accounts!) : []),
    enabled: !!accounts,
  });
}

export function useStars(book: string) {
  return useQuery({ queryKey: keys.stars(book), queryFn: () => appApi.stars(book) });
}

export function useSetStar(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ account, starred }: { account: string; starred: boolean }) =>
      appApi.setStar(book, account, starred),
    onSuccess: (stars) => client.setQueryData(keys.stars(book), stars),
  });
}

/** The user's starred accounts, summarized: the home page. */
export function useStarredAccounts(book: string) {
  const stars = useStars(book);
  const summary = useSummary(book, stars.data);
  return {
    data: summary.data,
    isPending: stars.isPending || summary.isPending,
    error: stars.error ?? summary.error,
  };
}

/** Add an account (with an optional opening balance), and star it. */
export function useAddAccount(book: string) {
  const create = useCreateAccount(book);
  const star = useSetStar(book);
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (account: AccountIn) => {
      const created = await create.mutateAsync(account);
      await star.mutateAsync({ account: created.name, starred: true });
      return created;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
  });
}

export function useLastImports(book: string | undefined) {
  return useQuery({
    queryKey: keys.lastImports(book ?? ""),
    queryFn: () => appApi.lastImports(book!),
    enabled: !!book,
  });
}

/** An account's ledger, newest first, 200 transactions a page, more as you scroll. */
export function useAccountLedger(book: string, account: string) {
  return useInfiniteQuery({
    queryKey: keys.ledger(book, account),
    queryFn: ({ pageParam }) => api.accountLedger(book, account, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
}

export function useCreateTransaction(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (transaction: TransactionIn) => api.createTransaction(book, transaction),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
  });
}

export function useProfiles(book: string, account: string | undefined) {
  return useQuery({
    queryKey: keys.profiles(book, account ?? ""),
    queryFn: () => appApi.profiles(book, account!),
    enabled: !!account,
  });
}

export function useSaveProfile(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      account,
      profile,
      mode,
    }: {
      account: string;
      profile: CsvProfile;
      mode: "replace" | "add";
    }) => appApi.saveProfile(book, account, profile, mode),
    onSuccess: (profiles, { account }) =>
      client.setQueryData(keys.profiles(book, account), profiles),
  });
}

export function useImport(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ account, file }: { account: string; file: File }) =>
      appApi.importFile(book, account, file),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
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
  void queryClient.invalidateQueries({ queryKey: ["book", book, "summary"] });
  void queryClient.invalidateQueries({ queryKey: ["book", book, "ledger"] });
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
    mutationFn: (account: AccountIn) => api.createAccount(book, account),
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
    submit: (name) => create.mutateAsync({ name, kind: "leaf" }),
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

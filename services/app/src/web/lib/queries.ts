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
  TradeIn,
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
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { AccountCreation } from "../components/AccountPicker.js";
import {
  appApi,
  type CsvProfile,
  type CategoryRule,
  type CategoryRuleIn,
  type ProposedMatch,
  type Schedule,
  type ScheduleIn,
  type SchedulePatch,
} from "./appApi.js";
import type { CategoryRulePatch } from "../../shared/rules.js";
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
  matches: (book: string) => ["book", book, "matches"] as const,
  proposals: (book: string) => ["book", book, "proposals"] as const,
  rules: (book: string) => ["book", book, "rules"] as const,
  schedules: (book: string) => ["book", book, "schedules"] as const,
  schedule: (book: string, id: string) => ["book", book, "schedules", id] as const,
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

/** The book the app shows. M1 users have exactly one; M6 makes this a choice. */
export function useCurrentBook(): { book: Book | undefined; loading: boolean } {
  const books = useBooks();
  return { book: books.data?.[0], loading: books.isPending };
}

/** The browser's time zone: a new book's, to start with. */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Create a book, in the browser's time zone. */
export function useCreateBook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const book = await api.createBook(name);
      await appApi.setTimeZone(book.id, browserTimeZone());
      return book;
    },
    onSuccess: (book) =>
      client.setQueryData<Book[]>(keys.books, (books) => [...(books ?? []), book]),
  });
}

export function useTimeZone(book: string) {
  return useQuery({
    queryKey: [...keys.book(book), "time-zone"],
    queryFn: () => appApi.timeZone(book),
  });
}

export function useSetTimeZone(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (zone: string) => appApi.setTimeZone(book, zone),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
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

/** Import rows whose match is up for review. */
export function useMatches(book: string) {
  return useQuery({ queryKey: keys.matches(book), queryFn: () => appApi.matches(book) });
}

/**
 * What review shows: pending transactions, plus transactions with a proposed match (which may
 * be confirmed already, like one entered by hand), oldest first, each with its matches.
 */
export function useReviewQueue(book: string) {
  const queue = useQueue(book);
  const matches = useMatches(book);
  const pending = new Set(queue.data?.map((t) => t.id));
  const extra = [...new Set(matches.data?.map((m) => m.transaction_id!) ?? [])].filter(
    (id) => id && !pending.has(id)
  );
  const fetched = useQueries({
    queries: extra.map((id) => ({
      queryKey: keys.transaction(book, id),
      queryFn: () => api.transaction(book, id),
    })),
  });
  const loading = queue.isPending || matches.isPending || fetched.some((q) => q.isPending);
  const items = loading
    ? undefined
    : [...(queue.data ?? []), ...fetched.flatMap((q) => (q.data ? [q.data] : []))]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((transaction) => ({
          transaction,
          matches: matches.data!.filter((m) => m.transaction_id === transaction.id),
        }));
  return { items, error: queue.error ?? matches.error };
}

/** After a match changes, everything showing transactions may have. */
function matchesChanged(book: string, matches: ProposedMatch[]) {
  queryClient.setQueryData(keys.matches(book), matches);
  void queryClient.invalidateQueries({ queryKey: keys.queue(book) });
  void queryClient.invalidateQueries({ queryKey: ["book", book, "ledger"] });
  void queryClient.invalidateQueries({ queryKey: ["book", book, "summary"] });
}

/** Set a row's transaction: a candidate (swapping if another row holds it), or null for new. */
export function useAssign(book: string) {
  return useMutation({
    mutationFn: ({ row, to }: { row: ProposedMatch; to: string | null }) =>
      appApi.assign(book, row, to),
    onSuccess: (matches) => matchesChanged(book, matches),
  });
}

export function useConfirmMatch(book: string) {
  return useMutation({
    mutationFn: (row: ProposedMatch) => appApi.confirmMatch(book, row),
    onSuccess: (matches) => matchesChanged(book, matches),
  });
}

// Investments

export function useHoldings(book: string, account: string, enabled = true) {
  return useQuery({
    queryKey: ["book", book, "holdings", account],
    queryFn: () => api.holdings(book, account),
    enabled,
  });
}

export function useCommodities(book: string) {
  return useQuery({
    queryKey: ["book", book, "commodities"],
    queryFn: () => api.commodities(book),
  });
}

export function useLastPriceFetch(book: string) {
  return useQuery({
    queryKey: ["book", book, "price-fetch"],
    queryFn: () => appApi.lastPriceFetch(book),
  });
}

/** Anything that changes prices or holdings: refresh everything in the book. */
function investmentMutation<T, R>(book: string, fn: (input: T) => Promise<R>) {
  return {
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.book(book) }),
  };
}

export const useSetCommodity = (book: string) =>
  useMutation(
    investmentMutation(book, (c: { currency: string } & Parameters<typeof api.setCommodity>[2]) =>
      api.setCommodity(book, c.currency, c)
    )
  );

export const useAddPrice = (book: string) =>
  useMutation(
    investmentMutation(book, (p: Parameters<typeof api.addPrice>[1]) => api.addPrice(book, p))
  );

export const useRevalue = (book: string, account: string) =>
  useMutation(
    investmentMutation(book, (r: Parameters<typeof api.revalue>[2]) =>
      api.revalue(book, account, r)
    )
  );

export const useSetAccount = (book: string, account: string) =>
  useMutation(
    investmentMutation(book, (p: Parameters<typeof api.setAccount>[2]) =>
      api.setAccount(book, account, p)
    )
  );

export const useTrade = (book: string, account: string) =>
  useMutation(investmentMutation(book, (t: TradeIn) => api.trade(book, account, t)));

export const useFetchPrices = (book: string) =>
  useMutation(investmentMutation(book, () => appApi.fetchPricesNow(book)));

// Categorization

/** Transaction ID to what categorization proposed, for the review queue. */
export function useProposals(book: string) {
  return useQuery({ queryKey: keys.proposals(book), queryFn: () => appApi.proposals(book) });
}

/** Apply the same change to several transactions, each a versioned PATCH, in turn: "also
 * categorize N similar", and Select mode. */
export function useBulkEdit(book: string) {
  return useMutation({
    mutationFn: async ({
      transactions,
      change,
    }: {
      /** Each one's current version is read before it's changed. */
      transactions: { id: string }[];
      change: (t: Transaction) => TransactionChanges | null;
    }) => {
      for (const t of transactions) {
        const current = await latest(book, t.id);
        const changes = change(current);
        if (changes) remember(book, await api.patch(book, t.id, changes, current.updated_at));
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.book(book) }),
  });
}

/** "Suggest categories" for pending transactions not yet categorized. */
export function useSuggest(book: string, account?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => appApi.suggest(book, account),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
  });
}

export function useRules(book: string) {
  return useQuery({ queryKey: keys.rules(book), queryFn: () => appApi.rules(book) });
}

export function useRule(book: string, id: string | undefined) {
  return useQuery({
    queryKey: [...keys.rules(book), id ?? ""],
    queryFn: () => appApi.rule(book, id!),
    enabled: !!id,
  });
}

export function useSaveRule(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rule }: { id?: string; rule: CategoryRuleIn | CategoryRulePatch }) =>
      appApi.saveRule(book, rule, id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.rules(book) }),
  });
}

export function useDeleteRule(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (rule: CategoryRule) => appApi.deleteRule(book, rule),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.rules(book) }),
  });
}

/** Re-apply a rule to the pending transactions it covers. */
export function useApplyRule(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => appApi.applyRule(book, id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
  });
}

export function useCategorizers(book: string) {
  return useQuery({
    queryKey: [...keys.rules(book), "categorizers"],
    queryFn: () => appApi.categorizers(book),
  });
}

// Schedules

export function useSchedules(book: string) {
  return useQuery({ queryKey: keys.schedules(book), queryFn: () => appApi.schedules(book) });
}

export function useSchedule(book: string, id: string | undefined) {
  return useQuery({
    queryKey: keys.schedule(book, id ?? ""),
    queryFn: () => appApi.schedule(book, id!),
    enabled: !!id,
  });
}

export function useUpcoming(book: string) {
  return useQuery({
    queryKey: [...keys.schedules(book), "upcoming"],
    queryFn: () => appApi.upcoming(book),
  });
}

/** Transaction ID to schedule ID, for marking scheduled transactions. */
export function useScheduled(book: string) {
  return useQuery({
    queryKey: [...keys.schedules(book), "occurrences"],
    queryFn: () => appApi.scheduled(book),
  });
}

/** Saving or deleting a schedule may stage transactions: refresh everything in the book. */
const schedulesChanged = (book: string) =>
  queryClient.invalidateQueries({ queryKey: keys.book(book) });

export function useSaveSchedule(book: string) {
  return useMutation({
    mutationFn: ({ id, schedule }: { id?: string; schedule: ScheduleIn | SchedulePatch }) =>
      id
        ? appApi.editSchedule(book, id, schedule as SchedulePatch)
        : appApi.createSchedule(book, schedule as ScheduleIn),
    onSuccess: () => schedulesChanged(book),
  });
}

export function useDeleteSchedule(book: string) {
  return useMutation({
    mutationFn: (schedule: Schedule) => appApi.deleteSchedule(book, schedule),
    onSuccess: () => schedulesChanged(book),
  });
}

/** "Not this time": delete a scheduled occurrence. It doesn't come back, since its schedule
 * already ran for that date. */
export function useDropOccurrence(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (t: Transaction) => api.deleteTransaction(book, t),
    onSuccess: (_, t) => {
      client.setQueryData<Transaction[]>(keys.queue(book), (queue) =>
        queue?.filter((q) => q.id !== t.id)
      );
      void client.invalidateQueries({ queryKey: keys.book(book) });
    },
  });
}

export function useTransaction(book: string, id: string) {
  return useQuery({
    queryKey: keys.transaction(book, id),
    queryFn: () => api.transaction(book, id),
    enabled: !!id,
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

/** Put a saved transaction everywhere it's cached. Confirmed ones leave the queue; one that
 * was pending has its proposal (if any) settled: was it kept? */
function remember(book: string, saved: Transaction) {
  const wasPending =
    queryClient.getQueryData<Transaction[]>(keys.queue(book))?.some((t) => t.id === saved.id) ||
    queryClient.getQueryData<Transaction>(keys.transaction(book, saved.id))?.flag === "!";
  if (saved.flag === "*" && wasPending) void appApi.settle(book, saved.id);
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

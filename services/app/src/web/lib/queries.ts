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
import { useEffect, useRef } from "react";

import type { AccountCreation } from "../components/AccountPicker.js";
import {
  accountChanges,
  appApi,
  bankFeeds,
  reconciling,
  type LinkRequest,
  type BookInfo,
  type BookInvite,
  type BreakdownOptions,
  type Role,
  type CsvProfile,
  type CategoryRule,
  type CategoryRuleIn,
  type ProposedMatch,
  type Schedule,
  type ScheduleIn,
  type SchedulePatch,
} from "./appApi.js";
import { today } from "./format.js";
import type { CategoryRulePatch } from "../../shared/rules.js";
import {
  api,
  ApiError,
  type BudgetBasis,
  type BudgetIn,
  type LedgerPageAt,
  type TransactionChanges,
} from "./ledger.js";
import {
  account,
  authConfig,
  keepFresh,
  LOGGED_OUT,
  logIn,
  logOut,
  me,
  signUp,
  type User,
} from "./session.js";

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

export function useSignUp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: signUp,
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

/** Follow the session: when it ends (and can't be refreshed), show Log in; while it lasts,
 * refresh it ahead of expiry. */
export function useSessionLifecycle(loggedIn: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    const ended = () => {
      if (client.getQueryData(keys.me)) switchSession(client, null);
    };
    window.addEventListener(LOGGED_OUT, ended);
    return () => window.removeEventListener(LOGGED_OUT, ended);
  }, [client]);
  useEffect(() => (loggedIn ? keepFresh() : undefined), [loggedIn]);
}

export function useAuthConfig() {
  return useQuery({ queryKey: ["auth-config"], queryFn: authConfig, staleTime: Infinity });
}

/** Account edits that change who's logged in (name, email) update the session's user. */
export function useUpdateAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: account.update,
    onSuccess: (user: User) => client.setQueryData(keys.me, user),
    onError: (error) => {
      if (error instanceof ApiError && error.conflict)
        void client.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useSessions() {
  return useQuery({ queryKey: ["account", "sessions"], queryFn: account.sessions });
}

export function useApiTokens() {
  return useQuery({ queryKey: ["account", "tokens"], queryFn: account.tokens });
}

/** An account change, refreshing what it touched. */
export function useAccountChange<A, R>(fn: (args: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: ["account"] }),
  });
}

/** Delete the account: everything goes, and nobody's logged in. */
export function useDeleteAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: account.delete,
    onSuccess: () => switchSession(client, null),
  });
}

// Books

/** The user's books, oldest first, with their time zones. */
export function useBooks() {
  const me = useMe();
  return useQuery({ queryKey: keys.books, queryFn: appApi.books, enabled: !!me.data });
}

/** The browser's time zone: a new book's, to start with. */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Create a book, in the browser's time zone; with `text` (an export), as a copy of it. */
export function useCreateBook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, text }: { name: string; text?: string }) =>
      appApi.createBook({ name, text, time_zone: browserTimeZone() }),
    onSuccess: (book) =>
      client.setQueryData<BookInfo[]>(keys.books, (books) => [...(books ?? []), book]),
  });
}

/** Delete a book and everything in it, and forget what was cached about it. */
export function useDeleteBook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (book: BookInfo) => appApi.deleteBook(book.id, book.updated_at),
    onSuccess: (_, book) => {
      client.removeQueries({ queryKey: keys.book(book.id) });
      client.setQueryData<BookInfo[]>(keys.books, (books) =>
        books?.filter((b) => b.id !== book.id)
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && error.conflict)
        void client.invalidateQueries({ queryKey: keys.books });
    },
  });
}

/** Give books without a time zone (made before every book got one) the browser's, once. */
export function useTimeZoneBackfill(books: BookInfo[] | undefined) {
  const client = useQueryClient();
  const done = useRef(new Set<string>());
  useEffect(() => {
    const missing = (books ?? []).filter((b) => !b.time_zone && !done.current.has(b.id));
    if (!missing.length) return;
    missing.forEach((b) => done.current.add(b.id));
    void Promise.all(missing.map((b) => appApi.setTimeZone(b.id, browserTimeZone()))).then(() =>
      client.invalidateQueries({ queryKey: keys.books })
    );
  }, [books, client]);
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
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.book(book) });
      void client.invalidateQueries({ queryKey: keys.books });
    },
  });
}

export function useRenameBook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ book, name }: { book: Book; name: string }) =>
      api.renameBook(book.id, name, book.updated_at),
    onSuccess: (renamed) =>
      client.setQueryData<BookInfo[]>(keys.books, (books) =>
        books?.map((b) => (b.id === renamed.id ? { ...b, ...renamed } : b))
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
/**
 * An account's ledger, newest first, 200 rows a page: from the newest (the full view), or from
 * `date` back (a partial view). Pages load older below (`fetchNextPage`) and newer above
 * (`fetchPreviousPage`), until the whole ledger is loaded.
 */
export const useAccountLedger = (
  book: string,
  account: string,
  date?: string,
  reconciled?: boolean
) =>
  usePages(
    [...keys.ledger(book, account), reconciled ?? null],
    (at) => api.accountLedger(book, account, at, reconciled),
    date
  );

/** The book's journal: every account's transactions, newest first, paged as a ledger is. */
export const useJournal = (book: string, date?: string, reconciled?: boolean) =>
  usePages(
    [...keys.book(book), "journal", reconciled ?? null],
    (at) => api.journal(book, at, reconciled),
    date
  );

/** Keyset pages loading either way: older below (`fetchNextPage`), newer above
 * (`fetchPreviousPage`), from the newest or from `date` back. */
function usePages<P extends { next_cursor: string | null; prev_cursor: string | null }>(
  key: readonly unknown[],
  fetch: (at: LedgerPageAt) => Promise<P>,
  date?: string
) {
  return useInfiniteQuery({
    queryKey: [...key, date ?? null],
    queryFn: ({ pageParam }) => fetch(pageParam),
    initialPageParam: (date ? { date } : {}) as LedgerPageAt,
    getNextPageParam: (page): LedgerPageAt | undefined =>
      page.next_cursor ? { cursor: page.next_cursor } : undefined,
    getPreviousPageParam: (page): LedgerPageAt | undefined =>
      page.prev_cursor ? { after: page.prev_cursor } : undefined,
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

/** Transfers paired in review (two imports made one), by their transaction. */
export function useTransfers(book: string) {
  return useQuery({
    queryKey: [...keys.book(book), "transfers"],
    queryFn: () => appApi.transfers(book),
  });
}

/** Reject a paired transfer: the two it was made of come back. */
export function useRejectTransfer(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => appApi.rejectTransfer(book, id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
  });
}

/** Import rows whose match is up for review. */
export function useMatches(book: string) {
  return useQuery({ queryKey: keys.matches(book), queryFn: () => appApi.matches(book) });
}

/**
 * What review shows: unconfirmed transactions, plus transactions with a proposed match (which may
 * be confirmed already, like one entered by hand), newest first, each with its matches.
 */
export function useReviewQueue(book: string) {
  const queue = useQueue(book);
  const matches = useMatches(book);
  const unconfirmed = new Set(queue.data?.map((t) => t.id));
  const extra = [...new Set(matches.data?.map((m) => m.transaction_id!) ?? [])].filter(
    (id) => id && !unconfirmed.has(id)
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
    : // The queue comes oldest first: reversed, the latest entered of a day comes first too.
      [...(queue.data ?? []), ...fetched.flatMap((q) => (q.data ? [q.data] : []))]
        .reverse()
        .sort((a, b) => b.date.localeCompare(a.date))
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

/** "Suggest categories" for unconfirmed transactions not yet categorized. */
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

/** Re-apply a rule to the unconfirmed transactions it covers. */
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
 * was unconfirmed has its proposal (if any) settled: was it kept? */
function remember(book: string, saved: Transaction) {
  const wasUnconfirmed =
    queryClient.getQueryData<Transaction[]>(keys.queue(book))?.some((t) => t.id === saved.id) ||
    queryClient.getQueryData<Transaction>(keys.transaction(book, saved.id))?.flag === "!";
  if (saved.flag === "*" && wasUnconfirmed) void appApi.settle(book, saved.id);
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

// Bank feeds

const bankKeys = {
  connections: ["bank-feeds"] as const,
  status: (book: string) => ["book", book, "bank-status"] as const,
};

export function useBankConnections() {
  return useQuery({ queryKey: bankKeys.connections, queryFn: bankFeeds.connections });
}

/** What each linked account's bank reports, by account. */
export function useBankStatus(book: string) {
  return useQuery({ queryKey: bankKeys.status(book), queryFn: () => bankFeeds.status(book) });
}

/** A bank-feed change: refresh the connections, and (it may have imported) the book. */
function useBankChange<A, R>(fn: (args: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: bankKeys.connections });
      void client.invalidateQueries({ queryKey: ["book"] });
    },
  });
}

export const useConnectBank = () => useBankChange(bankFeeds.connect);
export const useDisconnectBank = () => useBankChange(bankFeeds.disconnect);
export const useSyncBank = () => useBankChange(bankFeeds.sync);
export const useLinkBank = (book: string) =>
  useBankChange((link: LinkRequest) => bankFeeds.link(book, link));

/** The book's link attempts; polled while any is still fetching the bank's history. */
export function useBankAttempts(book: string) {
  return useQuery({
    queryKey: ["book", book, "bank-attempts"],
    queryFn: () => bankFeeds.attempts(book),
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.state === "fetching") ? 3000 : false,
  });
}

export const useAttemptLink = (book: string) =>
  useBankChange((link: LinkRequest) => bankFeeds.attempt(book, link));
export const useConfirmLink = (book: string) =>
  useBankChange((id: string) => bankFeeds.confirm(book, id));
export const useCancelLink = (book: string) =>
  useBankChange((id: string) => bankFeeds.cancel(book, id));
export const useUnlinkBank = (book: string) =>
  useBankChange((id: string) => bankFeeds.unlink(book, id));

// The chart of accounts

export function useAccountTree(book: string) {
  return useQuery({ queryKey: ["book", book, "tree"], queryFn: () => api.accountTree(book) });
}

/** A change to accounts: everything about the book may have moved. */
function useChartChange<A, R>(book: string, fn: (args: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
  });
}

// Sharing (M13)

/** The caller's role in the book (owner, manage, write, read), from the book list. */
export function useRole(book: string): Role | undefined {
  return (useBooks().data?.find((b) => b.id === book)?.role ?? undefined) as Role | undefined;
}

/** Whether the caller may change the book (write or more). Unknown yet counts as yes, so
 * nothing flickers away for the usual case. */
export const useCanWrite = (book: string) => {
  const role = useRole(book);
  return role === undefined || role !== "read";
};

export function useMembers(book: string) {
  return useQuery({
    queryKey: [...keys.book(book), "members"],
    queryFn: () => appApi.sharing.members(book),
  });
}

/** A change to who has the book: the members, and the book list (roles, books left). */
function useSharingChange<A, R>(book: string, fn: (args: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...keys.book(book), "members"] });
      void client.invalidateQueries({ queryKey: keys.books });
    },
  });
}

export const useSetRole = (book: string) =>
  useSharingChange(book, (a: { user: string; role: BookInvite["role"]; updatedAt: string }) =>
    appApi.sharing.setRole(book, a.user, a.role, a.updatedAt)
  );
export const useRemoveMember = (book: string) =>
  useSharingChange(book, (user: string) => appApi.sharing.remove(book, user));
export const useInvite = (book: string) =>
  useSharingChange(book, (a: { role: BookInvite["role"]; email: string; label: string }) =>
    appApi.sharing.invite(book, a)
  );
export const useRevokeInvite = (book: string) =>
  useSharingChange(book, (id: string) => appApi.sharing.revoke(book, id));

export function useInvitation(token: string) {
  return useQuery({
    queryKey: ["invitation", token],
    queryFn: () => appApi.sharing.invitation(token),
    retry: false,
  });
}

export function useAcceptInvitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => appApi.sharing.accept(token),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.books }),
  });
}

// Reports (M12): each refetches when anything in the book changes.

const reportKey = (book: string, name: string, ...rest: unknown[]) =>
  [...keys.book(book), "reports", name, today(), ...rest] as const;

export const useSpendingReport = (book: string) =>
  useQuery({
    queryKey: reportKey(book, "spending"),
    queryFn: () => appApi.reports.spending(book, today()),
  });

export const useCashFlowReport = (book: string) =>
  useQuery({
    queryKey: reportKey(book, "cash-flow"),
    queryFn: () => appApi.reports.cashFlow(book, today()),
  });

export const useBreakdownReport = (book: string, options: BreakdownOptions) =>
  useQuery({
    queryKey: reportKey(book, "breakdown", options),
    queryFn: () => appApi.reports.breakdown(book, today(), options),
    placeholderData: (previous) => previous, // keep the donut while the next level loads
  });

export const useLargestReport = (book: string) =>
  useQuery({
    queryKey: reportKey(book, "largest"),
    queryFn: () => appApi.reports.largest(book, today()),
  });

export const useNetWorthReport = (book: string) =>
  useQuery({
    queryKey: reportKey(book, "net-worth"),
    queryFn: () => appApi.reports.netWorth(book, today()),
  });

export const useTypicalReport = (book: string, account: string, enabled = true) =>
  useQuery({
    queryKey: reportKey(book, "typical", account),
    queryFn: () => appApi.reports.typical(book, today(), account),
    enabled,
  });

// Budgets (M11)

/** Every budget in force today: each over its own period, or all per month. */
export function useBudgetStatus(book: string, basis: BudgetBasis = "period") {
  const on = today();
  return useQuery({
    queryKey: [...keys.book(book), "budgets", basis, on],
    queryFn: () => api.budgetStatus(book, on, basis),
  });
}

/** Set (or, with 0, end) an account's budget from a period on. */
export const useSetBudget = (book: string, account: string) =>
  useChartChange(book, (b: BudgetIn) => api.setBudget(book, account, b));

/** The book's settings: its time zone, and the day its weeks start. */
export function useBookSettings(book: string) {
  return useQuery({
    queryKey: [...keys.book(book), "settings"],
    queryFn: () => appApi.settings(book),
  });
}

export function usePatchSettings(book: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof appApi.patchSettings>[1]) =>
      appApi.patchSettings(book, patch),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
  });
}

export const useSetDivided = (book: string, account: string) =>
  useChartChange(book, ({ divided, updated_at }: { divided: boolean; updated_at: string | null }) =>
    accountChanges.divided(book, account, divided, updated_at)
  );

// Reconciliation (M14)

const reconcileKey = (book: string, account: string) =>
  ["book", book, "reconcile", account] as const;

/** The Reconcile screen's view: the list runs to 14 days past `through`. */
export function useReconcileView(book: string, account: string, through?: string) {
  return useQuery({
    queryKey: [...reconcileKey(book, account), through ?? null],
    queryFn: () => reconciling.view(book, account, through),
    placeholderData: (previous) => previous, // keep the list while the date changes
  });
}

/** The account's reconciliations, newest first: what it's reconciled through, and any broken. */
export function useReconciliations(book: string, account: string, enabled = true) {
  return useQuery({
    queryKey: ["book", book, "reconciliations", account],
    queryFn: () => api.reconciliations(book, account),
    enabled,
  });
}

export function useSaveReconcileDraft(book: string, account: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: Parameters<typeof reconciling.saveDraft>[2]) =>
      reconciling.saveDraft(book, account, draft),
    onSettled: () => client.invalidateQueries({ queryKey: reconcileKey(book, account) }),
  });
}

export function useDiscardReconcileDraft(book: string, account: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => reconciling.discardDraft(book, account),
    onSuccess: () => client.invalidateQueries({ queryKey: reconcileKey(book, account) }),
  });
}

/** Finishing, or undoing the latest: either changes ledgers, balances and review. */
export function useFinishReconcile(book: string, account: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (statement: Parameters<typeof reconciling.finish>[2]) =>
      reconciling.finish(book, account, statement),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
  });
}

export function useUndoReconciliation(book: string, account: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (statementDate: string) => api.undoReconciliation(book, account, statementDate),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.book(book) }),
  });
}

export const useRenameAccount = (book: string, account: string) =>
  useChartChange(book, ({ to, updated_at }: { to: string; updated_at?: string }) =>
    accountChanges.rename(book, account, to, updated_at)
  );
export const useArchiveAccount = (book: string, account: string) =>
  useChartChange(book, (a: { date?: string; transfer_to?: string; updated_at?: string }) =>
    accountChanges.archive(book, account, a)
  );
export const useUnarchiveAccount = (book: string, account: string) =>
  useChartChange(book, () => accountChanges.unarchive(book, account));
export const useRemoveAccount = (book: string, account: string) =>
  useChartChange(book, (substitute: string | undefined) =>
    accountChanges.remove(book, account, substitute)
  );

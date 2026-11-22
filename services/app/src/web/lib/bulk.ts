/**
 * Select mode's bulk actions, built once for every page that selects transactions (review, an
 * account's ledger, Transactions), so they all offer the same: **Confirm** the selection,
 * **Categorize as…** an account (where the page knows how), **Edit tags…** (M17; a checklist
 * since 2026-11-22), **Fund…**, and **Suggest categories** (rules, history, and the book's AI when
 * it's set up). Each says why it can't run, when it can't. Each is one request for the whole
 * selection (`shared/bulk.ts`), shown as a toast while it runs that says what it did, or why it
 * couldn't, when it's done.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { AccountCreation } from "../components/AccountPicker.js";
import type { BulkAction } from "../components/SelectBar.js";
import { tagChangeSaid, type TagChange } from "../components/Tags.js";
import type { BulkChange, BulkResult } from "../../shared/bulk.js";
import { UNALLOCATED } from "../../shared/funds.js";
import { tagsOf } from "../../shared/tags.js";
import { aiCostSentence } from "./ai.js";
import { appApi } from "./appApi.js";
import { formatMoney } from "./decimal.js";
import { explain, useBulk, useFunds, useShort, useTags } from "./queries.js";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Picked = { id: string; updated_at: string };

/** Run a bulk edit as a toast: `doing` while it runs, then what `done` says it did, or the error. */
export function useBulkRun(book: string) {
  const bulk = useBulk(book);
  const run = (
    transactions: Picked[],
    change: BulkChange,
    doing: string,
    done: (result: BulkResult) => string,
    then?: (result: BulkResult) => void
  ) => {
    const id = toast.loading(doing);
    bulk.mutate(
      { ...change, transactions: transactions.map(({ id, updated_at }) => ({ id, updated_at })) },
      {
        onSuccess: (result) => {
          toast.success(done(result), { id });
          then?.(result);
        },
        onError: (e) => toast.error(explain(e), { id }),
      }
    );
  };
  return { run, busy: bulk.isPending };
}

/** What a tag change did, in words: "Added #italy and removed #work: 3 transactions changed." */
export const tagsSaid = (change: TagChange, result: BulkResult): string =>
  `${tagChangeSaid(change)}: ${plural(result.changed, "transaction")} changed` +
  (result.unchanged ? `, ${result.unchanged} already that way.` : ".");

export function useBulkActions({
  book,
  chosen,
  accounts,
  create,
  categorize,
  confirmBlocked,
  confirmMatches,
  onConfirmed,
}: {
  book: string;
  /** What's selected, with its version and tags: a row's, or a transaction's splits'. */
  chosen: {
    id: string;
    flag: string;
    updated_at: string;
    tags?: string[];
    postings?: { account: string; tags?: string[] | null }[];
  }[];
  /** Accounts to categorize as. */
  accounts?: string[];
  create?: AccountCreation;
  /** How the page categorizes: the other side of `own` (an account's ledger), or a two-split
   * transaction's category. Without it, the page doesn't. */
  categorize?: { own?: string };
  /** Why the selection can't be confirmed yet, if it can't. */
  confirmBlocked?: string | false;
  /** Confirm their proposed matches too (review). */
  confirmMatches?: boolean;
  onConfirmed?: () => void;
}) {
  const client = useQueryClient();
  const { run, busy } = useBulkRun(book);
  const n = chosen.length;
  const unconfirmed = chosen.filter((t) => t.flag === "!");
  const bookTags = useTags(book);
  // The tags the selection has, each with how many of them have it.
  const counts = new Map<string, number>();
  for (const t of chosen)
    for (const tag of t.tags ?? tagsOf(t.postings ?? []))
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const theirTags = [...counts].map(([name, transactions]) => ({ name, transactions }));
  const listing = useFunds(book).data;
  const activeFunds = listing?.funds.filter((f) => !f.archived) ?? [];

  const suggest = useMutation({
    mutationFn: () =>
      appApi.suggest(
        book,
        undefined,
        unconfirmed.map((t) => t.id)
      ),
    onSettled: () => client.invalidateQueries({ queryKey: ["book", book] }),
  });
  const suggestSaid = ({
    suggested,
    ai,
    ai_error,
    ai_cost,
  }: Awaited<ReturnType<typeof appApi.suggest>>) => {
    const of = `${suggested} of ${unconfirmed.length}`;
    const cost = typeof ai_cost === "number" ? ` ${aiCostSentence(ai_cost)}` : "";
    return (
      (ai_error
        ? `The book's AI couldn't answer: ${ai_error}. From rules and history: suggested categories for ${of}.`
        : ai
          ? `Suggested categories for ${of}, the book's AI included.`
          : `Suggested categories for ${of}: from rules and history (the book's AI isn't set up).`) +
      cost
    );
  };

  // A sale that takes shares no fund has can't be confirmed until it's given one (Funds B).
  const short = new Set((useShort(book).data ?? []).map((t) => t.id));
  const confirmable = unconfirmed.filter((t) => !short.has(t.id));
  const flagged = unconfirmed.length - confirmable.length;
  const actions: BulkAction[] = [
    {
      label: `Confirm ${n}`,
      disabled:
        confirmBlocked ||
        (!unconfirmed.length && !confirmMatches && "confirmed already") ||
        (unconfirmed.length > 0 &&
          !confirmable.length &&
          (flagged === 1 ? "it needs a fund first" : "they need a fund first")),
      run: () =>
        run(
          chosen,
          { op: "confirm", matches: !!confirmMatches },
          `Confirming ${n}…`,
          ({ skipped }) =>
            `Confirmed ${plural(n - skipped, "transaction")}` +
            (skipped
              ? `; skipped ${skipped} that ${skipped === 1 ? "needs" : "need"} a fund.`
              : "."),
          ({ skipped }) => !skipped && onConfirmed?.()
        ),
    },
    ...(categorize && accounts
      ? [
          {
            label: "Categorize as…",
            pick: { accounts, create },
            run: (account: string) =>
              run(
                chosen,
                { op: "categorize", account, ...categorize },
                `Categorizing ${n} as ${account}…`,
                ({ changed, unchanged, skipped }) =>
                  `Categorized ${plural(changed + unchanged, "transaction")} as ${account}` +
                  (skipped ? `; skipped ${plural(skipped, "one")} with more than two splits.` : ".")
              ),
          } satisfies BulkAction,
        ]
      : []),
    {
      label: "Edit tags…",
      editTags: { total: n, have: theirTags, choices: bookTags.data ?? [] },
      run: (change: TagChange) =>
        run(chosen, { op: "tags", ...change }, `Saving the tags of ${n}…`, (result) =>
          tagsSaid(change, result)
        ),
    } satisfies BulkAction,
    ...(activeFunds.length
      ? [
          {
            label: "Fund…",
            pickFund: {
              funds: activeFunds.map((f) => ({
                name: f.name,
                label: `${f.name} · ${formatMoney(f.value.number, f.value.currency)}`,
              })),
            },
            run: (fund: string) =>
              run(
                chosen,
                { op: "fund", fund },
                fund === UNALLOCATED ? `Clearing the funds of ${n}…` : `Setting the fund of ${n}…`,
                ({ changed, unchanged, skipped }) =>
                  (fund === UNALLOCATED
                    ? `Cleared the funds of ${plural(changed, "transaction")}` +
                      (unchanged ? `; ${unchanged} had none` : "")
                    : `Set the fund of ${plural(changed, "transaction")} to ${fund}` +
                      (unchanged ? `; ${unchanged} had it already` : "")) +
                  (skipped ? `; skipped ${skipped} whose amounts don't read.` : ".")
              ),
          } satisfies BulkAction,
        ]
      : []),
    {
      label: "Suggest categories",
      disabled: !unconfirmed.length && "only unconfirmed ones are categorized",
      run: () => {
        const id = toast.loading(`Suggesting categories for ${unconfirmed.length}…`);
        suggest.mutate(undefined, {
          onSuccess: (result) => toast.success(suggestSaid(result), { id }),
          onError: (e) => toast.error(explain(e), { id }),
        });
      },
    },
  ];
  return { actions, busy: busy || suggest.isPending };
}

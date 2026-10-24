/**
 * Select mode's bulk actions, built once for every page that selects transactions (review, an
 * account's ledger, Transactions), so they all offer the same: **Confirm** the selection,
 * **Categorize as…** an account (where the page knows how), and **Suggest categories** (rules,
 * history, and the book's AI when it's set up). Each says why it can't run, when it can't.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { Transaction } from "@luminous-money/ledger-client";

import type { AccountCreation } from "../components/AccountPicker.js";
import type { BulkAction } from "../components/SelectBar.js";
import { appApi } from "./appApi.js";
import type { TransactionChanges } from "./ledger.js";
import { explain, useBulkEdit } from "./queries.js";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function useBulkActions({
  book,
  chosen,
  accounts,
  create,
  categorize,
  confirmBlocked,
  afterConfirm,
  onConfirmed,
}: {
  book: string;
  /** What's selected. */
  chosen: { id: string; flag: string }[];
  /** Accounts to categorize as. */
  accounts?: string[];
  create?: AccountCreation;
  /** How to put one transaction in a category: its new postings, or null if it can't be (more
   * than two splits). Without it, the page doesn't categorize. */
  categorize?: (t: Transaction, account: string) => TransactionChanges | null;
  /** Why the selection can't be confirmed yet, if it can't. */
  confirmBlocked?: string | false;
  /** More to do once they're confirmed (review: their proposed matches). */
  afterConfirm?: () => Promise<void>;
  onConfirmed: () => void;
}) {
  const client = useQueryClient();
  const bulk = useBulkEdit(book);
  const [note, setNote] = useState<string | null>(null);
  const unconfirmed = chosen.filter((t) => t.flag === "!");
  const suggest = useMutation({
    mutationFn: () =>
      appApi.suggest(
        book,
        undefined,
        unconfirmed.map((t) => t.id)
      ),
    onSuccess: ({ suggested, ai }) => {
      setNote(
        `Suggested categories for ${suggested} of ${unconfirmed.length}` +
          (ai
            ? ", the book's AI included."
            : ": from rules and history (the book's AI isn't set up).")
      );
      return client.invalidateQueries({ queryKey: ["book", book] });
    },
    onError: (e) => setNote(explain(e)),
  });

  const actions: BulkAction[] = [
    {
      label: `Confirm ${chosen.length}`,
      disabled: confirmBlocked || (!unconfirmed.length && !afterConfirm && "confirmed already"),
      run: () => {
        setNote(null);
        bulk.mutate(
          { transactions: unconfirmed, change: () => ({ flag: "*" }) },
          {
            onSuccess: async () => {
              await afterConfirm?.();
              onConfirmed();
            },
            onError: (e) => setNote(explain(e)),
          }
        );
      },
    },
    ...(categorize && accounts
      ? [
          {
            label: "Categorize as…",
            pick: { accounts, create },
            run: (account: string) => {
              let skipped = 0;
              setNote(null);
              bulk.mutate(
                {
                  transactions: chosen,
                  change: (t) => {
                    const changes = categorize(t, account);
                    if (!changes) skipped++;
                    return changes;
                  },
                },
                {
                  onSuccess: () =>
                    setNote(
                      skipped
                        ? `Skipped ${plural(skipped, "one")} with more than two splits.`
                        : null
                    ),
                  onError: (e) => setNote(explain(e)),
                }
              );
            },
          } satisfies BulkAction,
        ]
      : []),
    {
      label: "Suggest categories",
      disabled: !unconfirmed.length && "only unconfirmed ones are categorized",
      run: () => {
        setNote(null);
        suggest.mutate();
      },
    },
  ];
  return { actions, busy: bulk.isPending || suggest.isPending, note, setNote };
}

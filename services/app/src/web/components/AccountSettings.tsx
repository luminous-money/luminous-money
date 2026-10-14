import type { AccountSummary } from "@fava-beans/ledger-client";
import { useState } from "react";

import { explain, useSetAccount } from "../lib/queries.js";

const METHODS = [
  ["", "The book's default (oldest first)"],
  ["FIFO", "Oldest lots first (FIFO)"],
  ["LIFO", "Newest lots first (LIFO)"],
  ["HIFO", "Highest cost first (HIFO)"],
  ["STRICT", "Lots I choose (specific identification)"],
  ["NONE", "Average cost"],
] as const;

/**
 * An account's settings: which lots sales draw on (match what the broker reports on the 1099-B),
 * and whether it's a revalued asset (a house, a car) and how often it should be revalued.
 */
export function AccountSettings({ book, account }: { book: string; account: AccountSummary }) {
  const set = useSetAccount(book, account.name);
  const [revalued, setRevalued] = useState(!!account.revalue_every);
  const [every, setEvery] = useState(String(account.revalue_every ?? 350));
  const save = (change: { booking?: string | null; revalue_every?: number | null }) =>
    set.mutate({ updated_at: account.updated_at!, ...change } as Parameters<typeof set.mutate>[0]);

  if (account.kind !== "leaf" || account.implicit || !account.updated_at) return null;
  return (
    <details className="account-settings">
      <summary className="small">Account settings</summary>
      <label>
        Sales draw on
        <select
          aria-label="Sales draw on"
          value={account.booking ?? ""}
          disabled={set.isPending}
          onChange={(e) => save({ booking: e.target.value || null })}
        >
          {METHODS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={revalued}
          onChange={(e) => {
            setRevalued(e.target.checked);
            save({ revalue_every: e.target.checked ? Number(every) || 350 : null });
          }}
        />
        Revalued periodically (a house, a car)
      </label>
      {revalued && (
        <label>
          Revalue every (days)
          <input
            inputMode="numeric"
            value={every}
            onChange={(e) => setEvery(e.target.value)}
            onBlur={() => Number(every) > 0 && save({ revalue_every: Number(every) })}
          />
        </label>
      )}
      {set.error && <p className="error">{explain(set.error)}</p>}
    </details>
  );
}

import { AccountPicker, type AccountCreation } from "./AccountPicker.js";

/**
 * Select mode's bar, sticky across the top of review and ledgers: how many are selected,
 * "Select all" (what's shown: a filtered list's rows, loaded so far), "Categorize as…" (where
 * that means something), "Confirm", and "Done".
 */
export function SelectBar({
  count,
  shown,
  onSelectAll,
  accounts,
  create,
  onCategorize,
  onConfirm,
  canConfirm,
  busy,
  note,
  onDone,
}: {
  count: number;
  /** How many are shown, for Select all. */
  shown: number;
  /** Select everything shown. */
  onSelectAll: () => void;
  /** Accounts to categorize as. */
  accounts?: string[];
  create?: AccountCreation;
  onCategorize?: (account: string) => void;
  onConfirm: () => void;
  /** Whether the selection can be confirmed (none uncategorized, say). */
  canConfirm: boolean;
  busy: boolean;
  /** A line under the bar: what the last action skipped, or an error. */
  note?: string | null;
  onDone: () => void;
}) {
  return (
    <div className="select-bar" role="toolbar" aria-label="Selected">
      <div className="select-bar-row">
        <span className="select-count">{count} selected</span>
        <button type="button" disabled={!shown || count === shown} onClick={onSelectAll}>
          Select all
        </button>
        {onCategorize && accounts && (
          <AccountPicker
            label="Categorize as"
            accounts={accounts}
            value=""
            create={create}
            onChange={onCategorize}
          />
        )}
        <button
          type="button"
          className="primary"
          disabled={!count || busy || !canConfirm}
          onClick={onConfirm}
        >
          Confirm {count || ""}
        </button>
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
      {note && (
        <p className="small muted" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}

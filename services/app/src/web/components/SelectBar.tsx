import { AccountPicker, type AccountCreation } from "./AccountPicker.js";

/**
 * Select mode's bar, sticky across the top of review and account ledgers: how many are
 * selected, "Categorize as…", "Confirm", and "Done".
 */
export function SelectBar({
  count,
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
  /** Accounts to categorize as. */
  accounts: string[];
  create?: AccountCreation;
  onCategorize: (account: string) => void;
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
        <AccountPicker
          label="Categorize as"
          accounts={accounts}
          value=""
          create={create}
          onChange={onCategorize}
        />
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

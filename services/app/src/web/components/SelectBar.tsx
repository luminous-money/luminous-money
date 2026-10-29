import { useState } from "react";

import { usePopover } from "../lib/popover.js";
import { AccountPicker, type AccountCreation } from "./AccountPicker.js";
import { TagInput, type TagChoice } from "./Tags.js";

/** Something Select mode can do to what's selected. Disabled, it says why. */
export type BulkAction = {
  label: string;
  /** Why it can't be done now, if it can't. */
  disabled?: string | false;
} & (
  | { run: () => void; pick?: undefined; pickTag?: undefined }
  /** One that needs an account first ("Categorize as…"): the bar shows a picker. */
  | {
      pick: { accounts: string[]; create?: AccountCreation; prefer?: string[] };
      pickTag?: undefined;
      run: (account: string) => void;
    }
  /** One that needs a tag first ("Add tag…", M17): the bar shows a tag picker. */
  | {
      pickTag: { choices: TagChoice[]; allowNew: boolean };
      pick?: undefined;
      run: (tag: string) => void;
    }
);

/**
 * Select mode's bar, sticky across the top of review and ledgers: how many are selected,
 * "Select all" (what's shown: a filtered list's rows, loaded so far), the **Actions** menu (what
 * the page can do in bulk: confirm, categorize, tag, suggest categories…), and "Done". An action
 * that needs an account or a tag opens a picker in the bar.
 */
export function SelectBar({
  count,
  shown,
  onSelectAll,
  actions,
  busy,
  note,
  onDone,
}: {
  count: number;
  /** How many are shown, for Select all. */
  shown: number;
  /** Select everything shown. */
  onSelectAll: () => void;
  actions: BulkAction[];
  busy: boolean;
  /** A line under the bar: what the last action did or skipped, or an error. */
  note?: string | null;
  onDone: () => void;
}) {
  const menu = usePopover();
  const [picking, setPicking] = useState<BulkAction | null>(null);
  return (
    <div className="select-bar" role="toolbar" aria-label="Selected">
      <div className="select-bar-row">
        <span className="select-count">{count} selected</span>
        <button type="button" disabled={!shown || count === shown} onClick={onSelectAll}>
          Select all
        </button>
        <div className="menu bulk-actions" ref={menu.ref}>
          <button
            type="button"
            className="primary"
            aria-expanded={menu.open}
            disabled={!count || busy}
            onClick={() => menu.setOpen((o) => !o)}
          >
            Actions ▾
          </button>
          {menu.open && (
            <div className="menu-panel" role="menu" aria-label="Actions">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  disabled={!!action.disabled}
                  title={action.disabled || undefined}
                  onClick={() => {
                    menu.setOpen(false);
                    if (action.pick || action.pickTag) setPicking(action);
                    else action.run();
                  }}
                >
                  {action.label}
                  {action.disabled && <span className="small muted"> ({action.disabled})</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
      {picking?.pickTag && (
        <div className="select-bar-row">
          <TagInput
            label={picking.label.replace(/…$/, "")}
            value={[]}
            choices={picking.pickTag.choices}
            allowNew={picking.pickTag.allowNew}
            autoFocus
            onChange={([tag]) => {
              setPicking(null);
              if (tag) picking.run(tag);
            }}
          />
          <button type="button" className="plain" onClick={() => setPicking(null)}>
            Cancel
          </button>
        </div>
      )}
      {picking?.pick && (
        <div className="select-bar-row">
          <AccountPicker
            label={picking.label.replace(/…$/, "")}
            accounts={picking.pick.accounts}
            prefer={picking.pick.prefer}
            value=""
            create={picking.pick.create}
            initiallyOpen
            onChange={(account) => {
              setPicking(null);
              picking.run(account);
            }}
          />
          <button type="button" className="plain" onClick={() => setPicking(null)}>
            Cancel
          </button>
        </div>
      )}
      {note && (
        <p className="small muted" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}

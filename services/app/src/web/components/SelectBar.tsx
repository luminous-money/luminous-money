import { useState } from "react";

import { UNALLOCATED } from "../../shared/funds.js";
import { usePopover } from "../lib/popover.js";
import { AccountPicker, type AccountCreation } from "./AccountPicker.js";
import { TagInput, type TagChoice } from "./Tags.js";

/** Something Select mode can do to what's selected. Disabled, it says why. */
export type BulkAction = {
  label: string;
  /** Why it can't be done now, if it can't. */
  disabled?: string | false;
} & (
  | { run: () => void; pick?: undefined; pickTag?: undefined; pickFund?: undefined }
  /** One that needs an account first ("Categorize as…"): the bar shows a picker. */
  | {
      pick: { accounts: string[]; create?: AccountCreation; prefer?: string[] };
      pickTag?: undefined;
      pickFund?: undefined;
      run: (account: string) => void;
    }
  /** One that needs a tag first ("Add tag…", M17): the bar shows a tag picker. */
  | {
      pickTag: { choices: TagChoice[]; allowNew: boolean };
      pick?: undefined;
      pickFund?: undefined;
      run: (tag: string) => void;
    }
  /** One that needs a fund first ("Fund…", Funds A): the bar shows a select of Unallocated and
   * the funds. Unallocated is run as UNALLOCATED. */
  | {
      pickFund: { funds: { name: string; label: string }[] };
      pick?: undefined;
      pickTag?: undefined;
      run: (fund: string) => void;
    }
);

/**
 * Select mode's bar, sticky across the top of review and ledgers: how many are selected,
 * "Select all" (what's shown: a filtered list's rows, loaded so far), the **Actions** menu (what
 * the page can do in bulk: confirm, categorize, tag, fund, suggest categories…), and "Done". An
 * action that needs an account, a tag or a fund opens a picker in the bar.
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
                    if (action.pick || action.pickTag || action.pickFund) setPicking(action);
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
      {picking?.pickFund && (
        <div className="select-bar-row">
          <select
            aria-label="Fund"
            className="fund-pick"
            value=""
            autoFocus
            onChange={(e) => {
              setPicking(null);
              picking.run(e.target.value);
            }}
          >
            <option value="" disabled>
              Choose a fund…
            </option>
            <option value={UNALLOCATED}>Unallocated (no fund)</option>
            {picking.pickFund.funds.map((f) => (
              <option key={f.name} value={f.name}>
                {f.label}
              </option>
            ))}
          </select>
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

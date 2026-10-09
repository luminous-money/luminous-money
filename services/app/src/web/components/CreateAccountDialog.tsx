import type { Account } from "@fava-beans/ledger-client";
import { useId, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

import { checkNewAccount, TYPE_LABELS } from "../lib/accounts.js";
import type { AccountKind } from "../lib/ledger.js";

type Props = {
  initialName: string;
  /** The book's chart of accounts, to check the name against. */
  accounts: Account[];
  /** Creates the account; rejects with a readable error. */
  submit: (name: string, kind: AccountKind) => Promise<Account>;
  onCreated: (account: Account) => void;
  onCancel: () => void;
};

/** Events inside the dialog must not reach the card it was opened from (a portal still bubbles
 * through React's tree): a tap here isn't the start of a swipe. */
const contain = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Create an account by its fully qualified name, prefilled from the search and freely editable.
 * The root sets the type; whether it holds transactions (a leaf) or sub-accounts (a node) is
 * chosen here. Full screen on phones.
 */
export function CreateAccountDialog({ initialName, accounts, submit, onCreated, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<AccountKind>("leaf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const nameId = useId();
  const check = checkNewAccount(name.trim(), kind, accounts);

  const create = async () => {
    if (!check.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await submit(name.trim(), kind));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="dialog-backdrop"
      onPointerDown={contain}
      onPointerMove={contain}
      onPointerUp={contain}
      onClick={contain}
      onKeyDown={(e) => {
        contain(e);
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Create account</h2>
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor={nameId}>
              Account
            </label>
            <input
              id={nameId}
              autoFocus
              autoCapitalize="words"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
              // Start at the end, where the new part of the name goes.
              onFocus={(e) => e.currentTarget.setSelectionRange(name.length, name.length)}
              aria-invalid={!check.ok}
              aria-describedby={`${nameId}-hint`}
            />
            <p id={`${nameId}-hint`} className={`small ${check.ok ? "muted" : "error"}`}>
              {check.ok
                ? `${check.type ? `${TYPE_LABELS[check.type]} account` : "Account"}${
                    check.adds.length ? ` · also adds ${check.adds.join(", ")} to hold it` : ""
                  }`
                : check.message}
            </p>
          </div>

          <fieldset className="choice">
            <legend>Holds</legend>
            <label>
              <input
                type="radio"
                name="kind"
                checked={kind === "leaf"}
                onChange={() => setKind("leaf")}
              />
              <span>
                Transactions <span className="muted">· leaf</span>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="kind"
                checked={kind === "node"}
                onChange={() => setKind("node")}
              />
              <span>
                Sub-accounts <span className="muted">· node</span>
              </span>
            </label>
          </fieldset>

          {error && <p className="error">{error}</p>}

          <div className="actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!check.ok || busy}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

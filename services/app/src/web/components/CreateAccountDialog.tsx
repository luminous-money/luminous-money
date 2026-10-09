import type { Account } from "@fava-beans/ledger-client";
import { useId, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

import { isSegment, TYPE_LABELS } from "../lib/accounts.js";
import type { AccountKind } from "../lib/ledger.js";
import { AccountName, AccountPicker } from "./AccountPicker.js";

type Props = {
  initialName: string;
  initialParent: string;
  parents: Account[];
  prefer?: string[];
  /** Creates the account; rejects with a readable error. */
  submit: (name: string, kind: AccountKind) => Promise<Account>;
  onCreated: (account: Account) => void;
  onCancel: () => void;
};

/** Events inside the dialog must not reach the card it was opened from (a portal still bubbles
 * through React's tree): a tap here isn't the start of a swipe. */
const contain = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Create an account: a name, a parent (a node, which also sets the account's type), and whether
 * it holds transactions (a leaf) or sub-accounts (a node). Full screen on phones.
 */
export function CreateAccountDialog({
  initialName,
  initialParent,
  parents,
  prefer,
  submit,
  onCreated,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialName);
  const [parent, setParent] = useState(initialParent);
  const [kind, setKind] = useState<AccountKind>("leaf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  const parentAccount = parents.find((p) => p.name === parent);
  const validName = isSegment(name);
  const full = parent && name ? `${parent}:${name}` : "";
  const ready = validName && !!parentAccount && !busy;

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await submit(full, kind));
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
          <label>
            Name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!name && !validName}
            />
          </label>
          {name && !validName && (
            <p className="error small">
              Start with a capital letter or digit; then letters, digits and dashes.
            </p>
          )}

          <div className="field">
            <span className="field-label">Parent</span>
            <AccountPicker
              label="Parent"
              accounts={parents.map((p) => p.name)}
              value={parent}
              onChange={setParent}
              prefer={prefer}
            />
            {parentAccount?.type && (
              <p className="muted small">{TYPE_LABELS[parentAccount.type]} account</p>
            )}
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

          {full && validName && (
            <p className="preview">
              Creates <AccountName name={full} />
            </p>
          )}
          {error && <p className="error">{error}</p>}

          <div className="actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!ready}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

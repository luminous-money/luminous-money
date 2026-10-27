import type { Account } from "@luminous-money/ledger-client";
import { useId, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

import { checkNewAccount } from "../lib/accounts.js";
import { NewAccountField } from "./NewAccountField.js";

type Props = {
  initialName: string;
  /** The book's chart of accounts, to check and complete the name against. */
  accounts: Account[];
  /** Creates the leaf (and any nodes on the way); rejects with a readable error. */
  submit: (name: string) => Promise<Account>;
  onCreated: (account: Account) => void;
  onCancel: () => void;
};

/** Events inside the dialog must not reach the card it was opened from (a portal still bubbles
 * through React's tree): a tap here isn't the start of a swipe. */
const contain = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Create a leaf account by its fully qualified name (see `NewAccountField`), prefilled from the
 * search and freely editable. Full screen on phones.
 */
export function CreateAccountDialog({ initialName, accounts, submit, onCreated, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const check = checkNewAccount(name, accounts);

  const create = async () => {
    if (!check.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await submit(name));
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
            // React carries a portal's events up its own tree: without this, the form the
            // picker is in (a transaction's editor) would be submitted too.
            e.stopPropagation();
            void create();
          }}
        >
          <NewAccountField name={name} onName={setName} accounts={accounts} autoFocus />

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

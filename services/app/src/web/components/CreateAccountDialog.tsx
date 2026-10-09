import type { Account } from "@fava-beans/ledger-client";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";

import { checkNewAccount, completeWith, completions, typed, TYPE_LABELS } from "../lib/accounts.js";
import { AccountName } from "./AccountPicker.js";

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
 * Create a leaf account by its fully qualified name, prefilled from the search and freely
 * editable. Full screen on phones.
 *
 * - Typing fixes the name up as Beancount needs it: spaces become dashes, parts start capitalized.
 * - Node accounts that continue what's typed are suggested underneath. Tab (or tapping one)
 *   fills in its next portion, through the next colon; while more still match, again fills the
 *   next. The arrow keys choose which suggestion Tab uses.
 * - The name is checked against the ledger's rules as it's typed. Levels on the way that don't
 *   exist yet are created as nodes.
 */
export function CreateAccountDialog({ initialName, accounts, submit, onCreated, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const nameId = useId();
  const listId = useId();
  const check = checkNewAccount(name, accounts);
  const suggestions = completions(name, accounts).slice(0, 8);

  // After a fill, the cursor belongs at the end, ready for the next part. Setting the value
  // doesn't reliably put it there, so it's moved once the new value has rendered.
  const caretToEnd = useRef(true); // also on opening, after the prefilled name
  useLayoutEffect(() => {
    const el = field.current;
    if (!caretToEnd.current || !el) return;
    caretToEnd.current = false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [name]);

  const fill = (account: string) => {
    caretToEnd.current = true;
    setName(completeWith(name, account));
    setActive(0);
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const next = typed(el.value);
    if (next !== el.value) {
      // Same length, so the cursor can stay exactly where it was.
      const [start, end] = [el.selectionStart, el.selectionEnd];
      el.value = next;
      el.setSelectionRange(start, end);
    }
    setName(next);
    setActive(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab" && !e.shiftKey && suggestions[active]) fill(suggestions[active]);
    else if (e.key === "ArrowDown" && suggestions.length)
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    else if (e.key === "ArrowUp" && suggestions.length) setActive((i) => Math.max(i - 1, 0));
    else return;
    e.preventDefault();
  };
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
            void create();
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor={nameId}>
              Account
            </label>
            <input
              ref={field}
              id={nameId}
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-invalid={!check.ok}
              aria-describedby={`${nameId}-hint`}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={name}
              onChange={onChange}
              onKeyDown={onKeyDown}
            />
            <p id={`${nameId}-hint`} className={`small ${check.ok ? "muted" : "error"}`}>
              {check.ok
                ? `${check.type ? `${TYPE_LABELS[check.type]} account` : "Account"}${
                    check.creates.length ? ` · also creates ${check.creates.join(", ")}` : ""
                  }`
                : check.message}
            </p>
            {suggestions.length > 0 && (
              <ul
                id={listId}
                role="listbox"
                aria-label="Accounts to continue into"
                className="completions"
              >
                {suggestions.map((account, i) => (
                  <li
                    key={account}
                    role="option"
                    aria-selected={i === active}
                    // mousedown, not click: keep the name field focused.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      fill(account);
                    }}
                  >
                    <AccountName name={account} />
                    {i === active && <kbd className="muted small">Tab</kbd>}
                  </li>
                ))}
              </ul>
            )}
          </div>

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

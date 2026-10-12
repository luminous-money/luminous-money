import type { Account } from "@fava-beans/ledger-client";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import { checkNewAccount, completeWith, completions, typed, TYPE_LABELS } from "../lib/accounts.js";
import { AccountName } from "./AccountPicker.js";

type Props = {
  label?: string;
  name: string;
  onName: (name: string) => void;
  /** The book's chart of accounts, to check and complete the name against. */
  accounts: Account[];
  /** Focus the field on mount, with the cursor after any prefilled name. */
  autoFocus?: boolean;
};

/**
 * A new account's fully qualified name, freely editable.
 *
 * - Typing fixes the name up as Beancount needs it: spaces become dashes, parts start capitalized.
 * - Node accounts that continue what's typed are suggested underneath. Tab (or tapping one)
 *   fills in its next portion, through the next colon; while more still match, again fills the
 *   next. The arrow keys choose which suggestion Tab uses.
 * - The name is checked against the ledger's rules as it's typed. Levels on the way that don't
 *   exist yet are created as nodes.
 */
export function NewAccountField({ label = "Account", name, onName, accounts, autoFocus }: Props) {
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const listId = useId();
  const check = checkNewAccount(name, accounts);
  const suggestions = completions(name, accounts).slice(0, 8);

  // After a fill, the cursor belongs at the end, ready for the next part. Setting the value
  // doesn't reliably put it there, so it's moved once the new value has rendered.
  const caretToEnd = useRef(!!autoFocus); // also on mount, after a prefilled name
  useLayoutEffect(() => {
    const el = field.current;
    if (!caretToEnd.current || !el) return;
    caretToEnd.current = false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [name]);

  const fill = (account: string) => {
    caretToEnd.current = true;
    onName(completeWith(name, account));
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
    onName(next);
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

  return (
    <div className="field">
      <label className="field-label" htmlFor={nameId}>
        {label}
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
  );
}

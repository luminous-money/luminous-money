import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { search } from "../lib/accounts.js";

type Props = {
  accounts: string[];
  value: string;
  onChange: (account: string) => void;
  /** Roots listed first before anything is typed. */
  prefer?: string[];
  label: string;
  disabled?: boolean;
};

/** A searchable account picker: tap to open, type any part of the name, pick with tap or Enter. */
export function AccountPicker({ accounts, value, onChange, prefer, label, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () => search(accounts, query, prefer).slice(0, 50),
    [accounts, query, prefer]
  );

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const choose = (account: string) => {
    close();
    if (account !== value) onChange(account);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, results.length - 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter" && results[active]) choose(results[active]);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
  };

  if (!open) {
    return (
      <button
        type="button"
        className="picker-value"
        aria-label={`${label}: ${value || "none"}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {value ? <AccountName name={value} /> : <span className="muted">Choose an account</span>}
      </button>
    );
  }

  return (
    <div className="picker">
      <input
        ref={input}
        autoFocus
        role="combobox"
        aria-label={label}
        aria-expanded="true"
        aria-controls={listId}
        placeholder="Search accounts"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      <ul id={listId} role="listbox">
        {results.map((name, i) => (
          <li
            key={name}
            role="option"
            aria-selected={i === active}
            // mousedown, not click: it fires before the input's blur closes the list.
            onMouseDown={(e) => {
              e.preventDefault();
              choose(name);
            }}
          >
            <AccountName name={name} />
          </li>
        ))}
        {results.length === 0 && <li className="muted">No matching accounts</li>}
      </ul>
    </div>
  );
}

/** An account name with its root de-emphasized: Expenses:Food:Restaurant. */
export function AccountName({ name }: { name: string }) {
  const [root, ...rest] = name.split(":");
  return (
    <span className="account" title={name}>
      <span className="account-root">{root}:</span>
      {rest.join(":")}
    </span>
  );
}

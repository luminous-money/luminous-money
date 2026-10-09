import type { Account } from "@fava-beans/ledger-client";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { search, suggestName } from "../lib/accounts.js";
import type { AccountKind } from "../lib/ledger.js";
import { CreateAccountDialog } from "./CreateAccountDialog.js";

/** Offering "Create account" at the bottom of the picker. */
export type AccountCreation = {
  /** The book's chart of accounts. */
  accounts: Account[];
  submit: (name: string, kind: AccountKind) => Promise<Account>;
};

type Props = {
  accounts: string[];
  value: string;
  onChange: (account: string) => void;
  /** Roots listed first before anything is typed; the first also prefixes new account names. */
  prefer?: string[];
  label: string;
  disabled?: boolean;
  create?: AccountCreation;
};

const CREATE = Symbol("create");

/**
 * A searchable account picker: tap to open, type any part of the name, pick with tap or Enter.
 *
 * With `create`, the last option is always "Create account", which opens the creation dialog
 * prefilled from the search. While the dialog is open the picker stays open underneath, search
 * and all, so cancelling lands right back where you were. A created leaf is picked; a created
 * node can't hold transactions, so the search moves into it instead, ready for a leaf under it.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  prefer,
  label,
  disabled,
  create,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const creatingNow = useRef(false); // read during blur, before state catches up
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(
    () => search(accounts, query, prefer).slice(0, 50),
    [accounts, query, prefer]
  );
  const options: (string | typeof CREATE)[] = create ? [...matches, CREATE] : matches;

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const choose = (option: string | typeof CREATE) => {
    if (option === CREATE) {
      creatingNow.current = true;
      setCreating(true);
      return;
    }
    close();
    if (option !== value) onChange(option);
  };
  const stopCreating = () => {
    creatingNow.current = false;
    setCreating(false);
    setTimeout(() => input.current?.focus());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, options.length - 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter" && options[active] !== undefined) choose(options[active]);
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
        onBlur={() => !creatingNow.current && close()}
      />
      <ul id={listId} role="listbox" aria-label={label}>
        {options.map((option, i) => (
          <li
            key={option === CREATE ? "create" : option}
            role="option"
            aria-selected={i === active}
            className={option === CREATE ? "create" : undefined}
            // mousedown, not click: it fires before the input's blur closes the list.
            onMouseDown={(e) => {
              e.preventDefault();
              choose(option);
            }}
          >
            {option === CREATE ? (
              <span>+ Create account{query.trim() ? ` “${query.trim()}”` : ""}</span>
            ) : (
              <AccountName name={option} />
            )}
          </li>
        ))}
        {!create && matches.length === 0 && <li className="muted">No matching accounts</li>}
      </ul>
      {creating && create && (
        <CreateAccountDialog
          initialName={suggestName(query, create.accounts, prefer?.[0] ?? "Expenses")}
          accounts={create.accounts}
          submit={create.submit}
          onCancel={stopCreating}
          onCreated={(account) => {
            creatingNow.current = false;
            setCreating(false);
            if (account.kind === "leaf") return choose(account.name);
            setQuery(`${account.name}:`);
            setActive(0);
            setTimeout(() => input.current?.focus());
          }}
        />
      )}
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

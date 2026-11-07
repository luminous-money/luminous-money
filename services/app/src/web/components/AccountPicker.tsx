import type { Account } from "@luminous-money/ledger-client";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { search, suggestName } from "../lib/accounts.js";
import { CreateAccountDialog } from "./CreateAccountDialog.js";

/** Offering "Create account" at the bottom of the picker. */
export type AccountCreation = {
  /** The book's chart of accounts. */
  accounts: Account[];
  /** Creates a leaf by its full name, with any nodes it needs on the way. */
  submit: (name: string) => Promise<Account>;
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
  /** Start open, searching (a picker that appears because someone asked for it). */
  initiallyOpen?: boolean;
  /** "Create account"'s name when nothing's been typed (renaming one not made yet). */
  suggest?: string;
  /** What it says with no account chosen. */
  placeholder?: string;
};

const CREATE = Symbol("create");

/**
 * A searchable account picker: tap to open, type any part of the name, pick with tap or Enter.
 * Opened on a chosen account, the search starts as its name, selected: typing replaces it, and
 * it can be edited instead (`…:Kitchen:Tools` to `…:Kitchen:Organizers`) to create one beside it.
 * Until it's changed, everything is listed, the chosen account first. Tab fills the search with
 * the highlighted account's name, to edit from.
 *
 * With `create`, the last option is always "Create account", which opens the creation dialog
 * prefilled from the search. While the dialog is open the picker stays open underneath, search
 * and all, so cancelling lands right back where you were. The created account is picked.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  prefer,
  label,
  disabled,
  create,
  initiallyOpen = false,
  suggest,
  placeholder = "Choose an account",
}: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const [query, setQuery] = useState(value);
  // Whether the search has been changed since it opened (until then, it's the chosen account).
  const [edited, setEdited] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const creatingNow = useRef(false); // read during blur, before state catches up
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const searching = edited ? query : "";
  const matches = useMemo(() => {
    const found = search(accounts, searching, prefer);
    const first = !edited && value && accounts.includes(value);
    return (first ? [value, ...found.filter((a) => a !== value)] : found).slice(0, 50);
  }, [accounts, searching, prefer, edited, value]);
  const options: (string | typeof CREATE)[] = create ? [...matches, CREATE] : matches;
  useEffect(() => {
    if (open) input.current?.select();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setEdited(false);
    setActive(0);
  };
  const reopen = () => {
    setQuery(value);
    setEdited(false);
    setOpen(true);
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
    else if (
      e.key === "Tab" &&
      !e.shiftKey &&
      typeof options[active] === "string" &&
      options[active] !== query
    ) {
      setQuery(options[active]);
      setEdited(true);
      setActive(0);
    } else if (e.key === "Escape") close();
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
        onClick={reopen}
      >
        {value ? <AccountName name={value} /> : <span className="muted">{placeholder}</span>}
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
          setEdited(true);
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
              <span>+ Create account{searching.trim() ? ` “${searching.trim()}”` : ""}</span>
            ) : (
              <AccountName name={option} />
            )}
          </li>
        ))}
        {!create && matches.length === 0 && <li className="muted">No matching accounts</li>}
      </ul>
      {creating && create && (
        <CreateAccountDialog
          initialName={
            !searching.trim() && suggest
              ? suggest
              : suggestName(searching, create.accounts, prefer?.[0] ?? "Expenses")
          }
          accounts={create.accounts}
          submit={create.submit}
          onCancel={stopCreating}
          onCreated={(account) => {
            creatingNow.current = false;
            setCreating(false);
            choose(account.name);
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

import type { Account } from "@fava-beans/ledger-client";
import { useState } from "react";

import { checkNewAccount, shown } from "../lib/accounts.js";
import { isDecimal } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import { explain, useAccounts, useAddAccount } from "../lib/queries.js";
import { NewAccountField } from "./NewAccountField.js";

/**
 * Add an account, and star it so it's on the home page: its full name (anything the ledger's
 * rules allow), and optionally its balance on a date, from a statement. The balance becomes an
 * opening balance on that date, so the account is right from the start; imported rows on or
 * before that date are skipped as already counted.
 *
 * The balance is entered as it's shown: for a liability or income account, positive is what's
 * owed or earned, and it's stored with the sign flipped.
 */
export function AddAccountForm({
  book,
  onAdded,
  submitLabel = "Add account",
}: {
  book: string;
  onAdded: (a: Account) => void;
  submitLabel?: string;
}) {
  const add = useAddAccount(book);
  const accounts = useAccounts(book);
  const [name, setName] = useState("Assets:");
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(today());
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);

  const check = checkNewAccount(name, accounts.data ?? []);
  const type = check.ok ? check.type : undefined;
  const amount = balance.trim().replace(/,/g, "");
  const valid =
    check.ok &&
    (amount === "" ||
      (isDecimal(amount) && /^[A-Z][A-Z0-9'._-]{1,22}$/.test(currency) && asOf !== ""));

  const submit = async () => {
    setError(null);
    try {
      onAdded(
        await add.mutateAsync({
          name,
          kind: "leaf",
          opening_balance: amount ? { amount: shown(amount, type), currency, date: asOf } : null,
        })
      );
    } catch (e) {
      setError(explain(e));
    }
  };

  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void submit();
      }}
    >
      <NewAccountField name={name} onName={setName} accounts={accounts.data ?? []} autoFocus />
      <div className="row-fields">
        <label>
          Balance <span className="muted">(optional)</span>
          <input
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
        </label>
        <label className="currency-field">
          Currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </label>
      </div>
      {amount && (
        <>
          <label>
            Balance as of
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} required />
          </label>
          <p className="muted small">
            The balance at the end of that day, as the statement shows it (for a card, what's owed).
            Imported transactions from that day or earlier are skipped, since the balance already
            includes them.
          </p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={!valid || add.isPending}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

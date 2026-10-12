import type { MoneyAccount } from "@fava-beans/ledger-client";
import { useState } from "react";

import { checkNewAccount, toSegment } from "../lib/accounts.js";
import { isDecimal } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import { explain, useAccounts, useCreateMoneyAccount } from "../lib/queries.js";
import { NewAccountField } from "./NewAccountField.js";

/**
 * Add a bank account: its name, the institution (optional), and its current balance with the
 * date it was that balance. The balance becomes an opening balance on that date, so the account
 * is right from the start; imported rows on or before that date are skipped as already counted.
 *
 * Where it's kept in the ledger follows the name (`Assets:Bank:<Name>`) until it's edited; then
 * it's any account the ledger's rules allow.
 */
export function AddAccountForm({
  book,
  onAdded,
  submitLabel = "Add account",
}: {
  book: string;
  onAdded: (a: MoneyAccount) => void;
  submitLabel?: string;
}) {
  const create = useCreateMoneyAccount(book);
  const accounts = useAccounts(book);
  const [name, setName] = useState("");
  const [edited, setEdited] = useState<string | null>(null);
  const [institution, setInstitution] = useState("");
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(today());
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);

  const amount = balance.trim().replace(/,/g, "") || "0";
  const path = edited ?? `Assets:Bank:${toSegment(name.trim())}`;
  const valid =
    name.trim() !== "" &&
    checkNewAccount(path, accounts.data ?? []).ok &&
    isDecimal(amount) &&
    /^[A-Z][A-Z0-9'._-]{1,22}$/.test(currency) &&
    asOf !== "";

  const submit = async () => {
    setError(null);
    try {
      onAdded(
        await create.mutateAsync({
          display_name: name.trim(),
          name: path,
          money: "bank",
          institution: institution.trim() || null,
          balance: amount,
          currency,
          as_of: asOf,
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
      <label>
        Account name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. PNC Checking"
          autoFocus
          required
        />
      </label>
      {name.trim() && (
        <NewAccountField
          label="Kept in the ledger as"
          name={path}
          onName={setEdited}
          accounts={accounts.data ?? []}
        />
      )}
      <label>
        Bank <span className="muted">(optional)</span>
        <input
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          placeholder="e.g. PNC"
        />
      </label>
      <div className="row-fields">
        <label>
          Current balance
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
      <label>
        Balance as of
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} required />
      </label>
      <p className="muted small">
        The balance at the end of that day. Imported transactions from that day or earlier are
        skipped, since the balance already includes them.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={!valid || create.isPending}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

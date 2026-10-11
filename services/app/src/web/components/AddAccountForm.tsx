import type { MoneyAccount } from "@fava-beans/ledger-client";
import { useState } from "react";

import { toSegment } from "../lib/accounts.js";
import { isDecimal } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import { explain, useCreateMoneyAccount } from "../lib/queries.js";

/**
 * Add a bank account: its name, the institution (optional), and its current balance with the
 * date it was that balance. The balance becomes an opening balance on that date, so the account
 * is right from the start; imported rows on or before that date are skipped as already counted.
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
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(today());
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);

  const amount = balance.trim().replace(/,/g, "") || "0";
  const valid =
    name.trim() !== "" &&
    isDecimal(amount) &&
    /^[A-Z][A-Z0-9'._-]{1,22}$/.test(currency) &&
    asOf !== "";
  const path = name.trim() ? `Assets:Bank:${toSegment(name.trim())}` : "";

  const submit = async () => {
    setError(null);
    try {
      onAdded(
        await create.mutateAsync({
          display_name: name.trim(),
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
      {path && <p className="muted small">Kept in the ledger as {path}</p>}
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

import type { Account } from "@luminous-money/ledger-client";
import { useState } from "react";

import { checkNewAccount, shown } from "../lib/accounts.js";
import { isDecimal } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import { explain, useAccounts, useAddAccount } from "../lib/queries.js";
import { Info } from "./Info.js";
import { NewAccountField } from "./NewAccountField.js";

/**
 * Add an account: a leaf (it holds transactions) or a group of accounts (a node), its full name
 * (anything the ledger's rules allow), whether it's starred for the home page (`star`: checked
 * to start with), and for a leaf, optionally its balance on a date, from a statement. The balance becomes an
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
  under,
  star = true,
  kinds = true,
}: {
  book: string;
  onAdded: (a: Account) => void;
  submitLabel?: string;
  /** Start the name under this node ("Add under …" in the chart). */
  under?: string;
  /** Whether "Show on the home page" starts checked. */
  star?: boolean;
  /** Whether a group of accounts can be made (not in setup: its first account holds money). */
  kinds?: boolean;
}) {
  const add = useAddAccount(book);
  const [kind, setKind] = useState<"leaf" | "node">("leaf");
  const [starred, setStarred] = useState(star);
  const node = kind === "node";
  const accounts = useAccounts(book);
  const [name, setName] = useState(under ? `${under}:` : "Assets:");
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(today());
  const [currency, setCurrency] = useState("USD");
  const [revalued, setRevalued] = useState(false);
  const [every, setEvery] = useState("350");
  const [holdings, setHoldings] = useState<{ commodity: string; units: string; cost: string }[]>(
    []
  );
  const [error, setError] = useState<string | null>(null);

  const check = checkNewAccount(name, accounts.data ?? []);
  const type = check.ok ? check.type : undefined;
  const amount = balance.trim().replace(/,/g, "");
  const held = holdings.filter((h) => h.commodity.trim() || h.units.trim());
  const opening = !node && (amount !== "" || held.length > 0);
  const valid =
    check.ok &&
    (!opening ||
      ((amount === "" || isDecimal(amount)) &&
        /^[A-Z][A-Z0-9'._-]{1,22}$/.test(currency) &&
        asOf !== "")) &&
    held.every(
      (h) =>
        h.commodity.trim() &&
        isDecimal(h.units.trim()) &&
        (!h.cost.trim() || isDecimal(h.cost.trim()))
    ) &&
    (node || !revalued || Number(every) > 0);

  const submit = async () => {
    setError(null);
    try {
      onAdded(
        await add.mutateAsync({
          star: starred,
          name,
          kind,
          opening_balance: opening
            ? { amount: shown(amount || "0", type), currency, date: asOf }
            : null,
          opening_holdings: (node ? [] : held).map((h) => ({
            commodity: h.commodity.trim().toUpperCase(),
            units: h.units.trim(),
            cost: h.cost.trim() || null,
          })),
          revalue_every: !node && revalued ? Number(every) : null,
          booking: null,
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
      {kinds && (
        <div className="with-info">
          <div className="segmented account-kind" role="radiogroup" aria-label="Kind of account">
            {(["leaf", "node"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className={kind === k ? "on" : ""}
                onClick={() => setKind(k)}
              >
                {k === "leaf" ? "An account" : "A group of accounts"}
              </button>
            ))}
          </div>
          <Info label="Accounts and groups">
            <p>
              <strong>An account</strong> holds transactions: a bank account, a card, groceries.
            </p>
            <p>
              <strong>A group</strong> holds other accounts and no transactions of its own: Food,
              with Groceries and Restaurants under it. Its balance is theirs, added up.
            </p>
          </Info>
        </div>
      )}
      <NewAccountField name={name} onName={setName} accounts={accounts.data ?? []} autoFocus />
      {!node && (
        <>
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
          {opening && (
            <>
              <label>
                Balance as of
                <input
                  type="date"
                  value={asOf}
                  onChange={(e) => setAsOf(e.target.value)}
                  required
                />
              </label>
              <p className="muted small">
                The balance at the end of that day, as the statement shows it (for a card, what's
                owed). Imported transactions from that day or earlier are skipped, since the balance
                already includes them.
              </p>
            </>
          )}
          <fieldset className="rule">
            <legend>Holdings (shares, funds)</legend>
            {holdings.map((h, i) => (
              <div className="holding-fields" key={i}>
                <input
                  aria-label="Commodity"
                  placeholder="VTI"
                  value={h.commodity}
                  onChange={(e) =>
                    setHoldings(
                      holdings.map((x, j) =>
                        j === i ? { ...x, commodity: e.target.value.toUpperCase() } : x
                      )
                    )
                  }
                />
                <input
                  aria-label="Units"
                  placeholder="units"
                  inputMode="decimal"
                  value={h.units}
                  onChange={(e) =>
                    setHoldings(
                      holdings.map((x, j) => (j === i ? { ...x, units: e.target.value } : x))
                    )
                  }
                />
                <input
                  aria-label="Total cost"
                  placeholder="total cost"
                  inputMode="decimal"
                  value={h.cost}
                  onChange={(e) =>
                    setHoldings(
                      holdings.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x))
                    )
                  }
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setHoldings([...holdings, { commodity: "", units: "", cost: "" }])}
            >
              + Add a holding
            </button>
            <p className="muted small">
              As of the date above. Leave the cost blank if you don&apos;t know it: that day&apos;s
              price is used, marked as estimated.
            </p>
          </fieldset>
          <label className="check">
            <input
              type="checkbox"
              checked={revalued}
              onChange={(e) => setRevalued(e.target.checked)}
            />
            Revalued periodically (a house, a car)
          </label>
          {revalued && (
            <label>
              Revalue every (days)
              <input inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} />
            </label>
          )}
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={starred} onChange={(e) => setStarred(e.target.checked)} />
        Show it on the home page (starred)
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={!valid || add.isPending}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

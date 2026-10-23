import type { AccountSummary } from "@luminous-money/ledger-client";

import { shown } from "../lib/accounts.js";
import { formatMoney, isNegative } from "../lib/decimal.js";
import { today } from "../lib/format.js";

/** An account's headline figure: its value in the book's currency when it holds anything else
 * (shares, funds), else its balance (as shown: a card's is what's owed). */
export function headline(account: AccountSummary): string {
  const priced = account.balance.some((b) => b.currency !== account.value?.currency);
  if (account.value && priced)
    return formatMoney(shown(account.value.number, account.type), account.value.currency);
  return account.balance.length
    ? account.balance.map((b) => formatMoney(shown(b.number, account.type), b.currency)).join(" · ")
    : formatMoney("0.00", account.currencies?.[0] ?? "USD");
}

/** What's under the headline: unrealized gain or loss, how old the prices or the value are,
 * and whether that's stale. Nothing for a plain cash account. */
export function AccountValueNote({ account }: { account: AccountSummary }) {
  const gain = account.gain;
  const priced = account.balance.some((b) => b.currency !== account.value?.currency);
  if (!gain && !priced && !account.revalue_every) return null;
  return (
    <p className="small value-note">
      {gain && (
        <span className={`amount ${isNegative(gain.number) ? "out" : "in"}`}>
          {isNegative(gain.number) ? "" : "+"}
          {formatMoney(gain.number, gain.currency)} unrealized
        </span>
      )}
      {priced && !account.value && <span className="muted">Some holdings have no price</span>}
      {priced && account.value_as_of && account.value_as_of !== today() && (
        <span className="muted">prices as of {account.value_as_of}</span>
      )}
      {account.revalue_every && (
        <span className="muted">
          {account.revalued_on ? `valued ${account.revalued_on}` : "never valued"}
        </span>
      )}
      {account.stale && (
        <span className="pill stale">
          {account.revalue_every ? "Needs a new value" : "Stale prices"}
        </span>
      )}
    </p>
  );
}

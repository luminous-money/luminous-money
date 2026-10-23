import type { Account } from "@luminous-money/ledger-client";

import { shown } from "../lib/accounts.js";
import type { BankStatus } from "../lib/appApi.js";
import { formatMoney, isNegative, negate } from "../lib/decimal.js";
import { formatDay, formatReported } from "../lib/format.js";

/** A synced account's bank balance, under the books' own: "Reported today 6:00am: $13,234.56"
 * (as shown: a card's is what's owed), and whether the books agree with the bank (M14): "Off
 * from the bank by $12.40 since Sep 20". */
export function ReportedLine({
  status,
  type,
}: {
  status: BankStatus;
  type: Account["type"] | undefined;
}) {
  const { balance, currency, balance_date } = status.reported;
  const compared = status.comparison;
  return (
    <>
      <p className="small muted reported">
        Reported {formatReported(balance_date)}: {formatMoney(shown(balance, type), currency)}
      </p>
      {compared && !compared.off_by && (
        <p className="small muted">
          <span className="reconciled-mark" aria-hidden="true">
            ✓
          </span>{" "}
          Matches the bank
        </p>
      )}
      {compared?.off_by && (
        <p className="small error" role="status">
          Off from the bank by {formatMoney(abs(compared.off_by), currency)}
          {compared.since ? ` since ${formatDay(compared.since)}` : ""}
        </p>
      )}
    </>
  );
}

const abs = (n: string) => (isNegative(n) ? negate(n) : n);

/** What went wrong with an account's bank feed, in plain words. */
export function BankErrors({ status }: { status: BankStatus }) {
  if (!status.errors.length) return null;
  return (
    <ul className="bank-errors" aria-label="Bank feed problems">
      {status.errors.map((e, i) => (
        <li key={i} className={`small ${e.notice ? "muted" : "error"}`} title={e.code}>
          {e.explained}{" "}
          {e.code.startsWith("con.auth") && (
            <a href="https://bridge.simplefin.org/" target="_blank" rel="noreferrer">
              Open SimpleFIN Bridge
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

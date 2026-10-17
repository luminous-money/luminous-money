import type { Account } from "@fava-beans/ledger-client";
import { Link } from "wouter";

import { partOf, reconciledItself } from "../../shared/divided.js";
import { displayName } from "../lib/accounts.js";
import { formatMoney, isNegative, negate } from "../lib/decimal.js";
import { formatDay } from "../lib/format.js";
import { useReconciliations } from "../lib/queries.js";

/**
 * An account's reconciliation, as its page heads it (M14): what it's reconciled through, and a
 * balance check the books no longer agree with ("Off by $12.40 since Sep 30's statement"). A
 * part of a divided account says which, since that's what's reconciled.
 */
export function ReconcileStatus({
  book,
  account,
  accounts,
}: {
  book: string;
  account: string;
  accounts: Account[];
}) {
  const itself = reconciledItself(accounts, account);
  const history = useReconciliations(book, account, itself);
  const whole = partOf(accounts, account);
  if (whole) {
    const found = accounts.find((a) => a.name === whole);
    return (
      <p className="small muted">
        Part of{" "}
        <Link href={`/books/${book}/accounts/${encodeURIComponent(whole)}`}>
          {displayName(found ?? { name: whole })}
        </Link>
        , a divided account: it's reconciled with it.
      </p>
    );
  }
  if (!itself || !history.data) return null;
  const latest = history.data.reconciliations.find((r) => r.statement);
  const broken = history.data.reconciliations.find((r) => r.off_by);
  return (
    <>
      {latest && (
        <p className="small muted">
          <span className="reconciled-mark" aria-hidden="true">
            ✓
          </span>{" "}
          Reconciled through {formatDay(latest.statement_date)}
          {latest.automatic && " with the bank"}
        </p>
      )}
      {broken?.off_by && (
        <p className="small error" role="status">
          Off by{" "}
          {formatMoney(
            isNegative(broken.off_by.number) ? negate(broken.off_by.number) : broken.off_by.number,
            broken.off_by.currency
          )}{" "}
          since {formatDay(broken.statement_date)}'s{" "}
          {broken.statement ? "statement" : "balance check"}
        </p>
      )}
    </>
  );
}

import type { Account } from "@luminous-money/ledger-client";
import { useState } from "react";

import { toSegment } from "../../shared/names.js";
import type { LoanView } from "../../shared/loans.js";
import {
  explain,
  useAccountCreation,
  useAccounts,
  useCountAsSpending,
  useCreateAccount,
} from "../lib/queries.js";
import { leavesUnder, PickerField } from "./Loans.js";

/**
 * Counting an asset or liability as spending (Loans step 2, outflows): what's paid into it counts
 * as spending, as an expense account, in budgets, home and Reports; what's paid out of it for
 * expenses isn't counted again. An account editor's card.
 */
export function OutflowCard({ book, account }: { book: string; account: Account }) {
  const chart = useAccounts(book);
  const create = useAccountCreation(book);
  const count = useCountAsSpending(book);
  const [as, setAs] = useState(account.outflow ?? "");
  const save = (outflow: string | null) =>
    count
      .mutateAsync([{ account: account.name, updated_at: account.updated_at!, outflow }])
      .catch(() => undefined);
  return (
    <section className="card editor" aria-label="Counts as spending">
      <h2 className="section-title">Counts as spending</h2>
      <p className="small muted">
        {account.type === "liability"
          ? "What's paid into it (a loan's principal) counts as spending, as the expense account below: in budgets, home and Reports' outflows."
          : "What's paid into it (escrow) counts as spending, as the expense account below, and the expenses paid out of it (the tax bill) aren't counted again: in budgets, home and Reports' outflows."}
      </p>
      <PickerField
        label="Counts as"
        accounts={leavesUnder(chart.data, ["Expenses"])}
        value={as}
        onChange={setAs}
        prefer={["Expenses"]}
        {...(create ? { create } : {})}
      />
      <div className="actions">
        {account.outflow && (
          <button type="button" disabled={count.isPending} onClick={() => void save(null)}>
            Stop counting it
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={!as || as === account.outflow || count.isPending}
          onClick={() => void save(as)}
        >
          {account.outflow ? "Save" : "Count it as spending"}
        </button>
      </div>
      {count.error && <p className="error small">{explain(count.error)}</p>}
    </section>
  );
}

/** Where a loan's payments count as spending, beside its interest: `Expenses:Housing:Mortgage-
 * Principal`, `Expenses:Housing:Mortgage-Escrow`. */
export function spendingAccount(loan: string, interest: string, part: string): string {
  const parent = interest.split(":").slice(0, -1).join(":") || "Expenses";
  return `${parent}:${toSegment(`${loan} ${part}`)}`;
}

/** The accounts a loan's payments go into that aren't expenses: what's owed, and each other's
 * asset or liability (escrow). */
export function loanSpendingAccounts(loan: LoanView): { account: string; part: string }[] {
  const others = [...new Map(loan.others.map((o) => [o.account, o])).values()]
    .filter((o) => /^(Assets|Liabilities):/.test(o.account))
    .map((o) => ({ account: o.account, part: o.name }));
  return [{ account: loan.accounts.liability, part: "Principal" }, ...others];
}

/** Count what a loan's payments put into its liability and escrow as spending, opening the
 * expense accounts they count as. */
export function useCountLoan(book: string) {
  const chart = useAccounts(book);
  const createAccount = useCreateAccount(book);
  const count = useCountAsSpending(book);
  return {
    pending: count.isPending || createAccount.isPending,
    error: count.error ?? createAccount.error,
    run: async (loan: LoanView, accounts: Account[]) => {
      const known = new Set((chart.data ?? accounts).map((a) => a.name));
      const changes = [];
      for (const { account, part } of loanSpendingAccounts(loan)) {
        const found = accounts.find((a) => a.name === account);
        if (!found?.updated_at || found.outflow) continue;
        const target = spendingAccount(loan.name, loan.accounts.interest, part);
        if (!known.has(target)) await createAccount.mutateAsync({ name: target, kind: "leaf" });
        changes.push({ account, updated_at: found.updated_at, outflow: target });
      }
      if (changes.length) await count.mutateAsync(changes);
    },
  };
}

/** A loan's card: whether its payments count as spending, and one press to make them. */
export function LoanSpending({ book, loan }: { book: string; loan: LoanView }) {
  const chart = useAccounts(book);
  const counting = useCountLoan(book);
  const [error, setError] = useState<string | null>(null);
  const accounts = chart.data ?? [];
  const rows = loanSpendingAccounts(loan).map((r) => ({
    ...r,
    outflow: accounts.find((a) => a.name === r.account)?.outflow ?? null,
  }));
  const missing = rows.filter((r) => !r.outflow);
  return (
    <section className="card" aria-label="As spending">
      <h2 className="section-title">As spending</h2>
      <p className="small muted">
        {missing.length
          ? "Its principal (and escrow) aren't expenses in the books. Counted as spending, the whole payment shows in budgets, home and Reports each month, and what escrow pays isn't counted again."
          : "The whole payment counts as spending in budgets, home and Reports' outflows."}
      </p>
      <ul className="loan-changes">
        {rows.map((r) => (
          <li key={r.account}>
            {r.account}: {r.outflow ? `counts as ${r.outflow}` : "not counted"}
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <button
          type="button"
          disabled={counting.pending || !chart.data}
          onClick={async () => {
            setError(null);
            try {
              await counting.run(loan, accounts);
            } catch (e) {
              setError(explain(e));
            }
          }}
        >
          Count the payments as spending
        </button>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

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
import { inChart, leavesUnder, PickerField, planned } from "./Loans.js";

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

/** What a loan's account suggests counting as, as spending: `Expenses:Financing:<part>:<its
 * last part>` (`Expenses:Financing:Principal:123-Main-St`), as New loan names them. */
export function spendingAccount(account: string, part: string): string {
  return `Expenses:Financing:${toSegment(part) || "Other"}:${account.split(":").at(-1)}`;
}

/** The accounts a loan's payments go into that aren't expenses: what's owed, and each other's
 * asset or liability (escrow). */
export function loanSpendingAccounts(loan: LoanView): { account: string; part: string }[] {
  const others = [...new Map(loan.others.map((o) => [o.account, o])).values()]
    .filter((o) => /^(Assets|Liabilities):/.test(o.account))
    .map((o) => ({ account: o.account, part: o.name }));
  return [{ account: loan.accounts.liability, part: "Principal" }, ...others];
}

/**
 * A loan's card: whether what its payments put into its liability and escrow counts as spending,
 * and, for what doesn't yet, what to count it as (suggested; opened when it's counted).
 */
export function LoanSpending({ book, loan }: { book: string; loan: LoanView }) {
  const chart = useAccounts(book);
  const createAccount = useCreateAccount(book);
  const count = useCountAsSpending(book);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const accounts = chart.data ?? [];
  const rows = loanSpendingAccounts(loan).map((r) => ({
    ...r,
    outflow: accounts.find((a) => a.name === r.account)?.outflow ?? null,
    as: chosen[r.account] ?? spendingAccount(r.account, r.part),
  }));
  const missing = rows.filter((r) => !r.outflow);
  const run = async () => {
    setError(null);
    try {
      const changes = [];
      for (const r of missing) {
        const found = accounts.find((a) => a.name === r.account);
        if (!found?.updated_at) continue;
        if (!inChart(accounts, r.as)) await createAccount.mutateAsync({ name: r.as, kind: "leaf" });
        changes.push({ account: r.account, updated_at: found.updated_at, outflow: r.as });
      }
      if (changes.length) await count.mutateAsync(changes);
    } catch (e) {
      setError(explain(e));
    }
  };
  return (
    <section className="card editor" aria-label="As spending">
      <h2 className="section-title">As spending</h2>
      <p className="small muted">
        {missing.length
          ? "Principal (and escrow) aren't expenses in the books. Counted as spending, the whole payment shows in budgets, home and Reports each month, and what escrow pays isn't counted again."
          : "The whole payment counts as spending in budgets, home and Reports' outflows."}
      </p>
      <ul className="loan-changes">
        {rows
          .filter((r) => r.outflow)
          .map((r) => (
            <li key={r.account}>
              {r.account} counts as {r.outflow}
            </li>
          ))}
      </ul>
      {missing.map((r) => (
        <PickerField
          key={r.account}
          label={`${r.part} counts as`}
          accounts={
            inChart(accounts, r.as)
              ? leavesUnder(accounts, ["Expenses"])
              : [...leavesUnder(accounts, ["Expenses"]), r.as]
          }
          value={r.as}
          onChange={(as) => setChosen((c) => ({ ...c, [r.account]: as }))}
          prefer={["Expenses"]}
          create={planned(accounts)}
          {...(!inChart(accounts, r.as) ? { suggest: r.as } : {})}
        />
      ))}
      {missing.length > 0 && (
        <div>
          <button
            type="button"
            disabled={count.isPending || createAccount.isPending || !chart.data}
            onClick={() => void run()}
          >
            Count the payments as spending
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

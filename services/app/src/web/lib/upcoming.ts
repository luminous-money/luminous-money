import type { Amount } from "@luminous-money/ledger-client";

import type { UpcomingOccurrence } from "./appApi.js";
import { add, negate } from "./decimal.js";

/** An upcoming occurrence as one account's ledger shows it, with the projected balance after it. */
export type UpcomingRow = {
  key: string;
  date: string;
  schedule_id: string;
  label: string;
  amount: Amount | null;
  balance: Amount | null;
};

/** The account's change in an occurrence: its split's amount, or, for the blank split, what
 * balances the others (one currency). Null if it can't be told. */
function change(o: UpcomingOccurrence, account: string): Amount | null {
  const split = o.template.postings.find((p) => p.account === account);
  if (!split) return null;
  if (split.units) return split.units;
  const others = o.template.postings.filter((p) => p !== split);
  const currency = others[0]?.units?.currency;
  if (!currency || others.some((p) => p.units?.currency !== currency)) return null;
  return {
    number: negate(others.reduce((sum, p) => add(sum, p.units!.number), "0")),
    currency,
  };
}

/**
 * The upcoming occurrences that touch `account`, newest first (as the ledger reads), each with
 * the balance projected from `current` through it. Projection needs one currency; otherwise
 * the balance is left out.
 */
export function upcomingFor(
  occurrences: UpcomingOccurrence[],
  account: string,
  current: Amount[]
): UpcomingRow[] {
  const touching = occurrences.filter((o) =>
    o.template.postings.some((p) => p.account === account)
  );
  // An empty balance is zero in whatever currency comes; more than one can't be projected.
  let running: Amount | null | undefined = current.length > 1 ? undefined : (current[0] ?? null);
  const rows = touching.map((o) => {
    const amount = change(o, account);
    if (running !== undefined) {
      running =
        amount && (running === null || running.currency === amount.currency)
          ? { number: add(running?.number ?? "0", amount.number), currency: amount.currency }
          : undefined; // once it can't be told, it stays unknown
    }
    return {
      key: `${o.schedule_id}:${o.nominal}`,
      date: o.date,
      schedule_id: o.schedule_id,
      label: o.template.payee || o.template.narration || o.name,
      amount,
      balance: running ?? null,
    };
  });
  return rows.reverse();
}

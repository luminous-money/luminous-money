import type { Transaction } from "@luminous-money/ledger-client";

import { payeeKey } from "../../shared/payees.js";
import type { ProposalSummary } from "./appApi.js";
import { simple, UNCATEGORIZED } from "./split.js";

/** Whether an unconfirmed transaction's category is still undecided: uncategorized, or exactly what
 * was proposed for it (the user hasn't touched it). */
export function undecided(t: Transaction, proposal: ProposalSummary | undefined): boolean {
  const view = simple(t);
  if (!view) return false;
  const account = view.counterpart.account;
  return (
    account === UNCATEGORIZED ||
    account === "Income:Uncategorized" ||
    (proposal?.accounts.length === 1 && proposal.accounts[0] === account)
  );
}

/**
 * The other unconfirmed transactions like `t`: in the same account (the active account), with the
 * same payee key, and their category still undecided. What "Also categorize N similar" covers.
 */
export function similarUnconfirmed(
  t: Transaction,
  queue: Transaction[],
  proposals: Record<string, ProposalSummary> = {}
): Transaction[] {
  const view = simple(t);
  const key = payeeKey(t.narration || t.payee || "");
  if (!view || !key) return [];
  return queue.filter(
    (o) =>
      o.id !== t.id &&
      o.flag === "!" &&
      simple(o)?.anchor.account === view.anchor.account &&
      payeeKey(o.narration || o.payee || "") === key &&
      undecided(o, proposals[o.id])
  );
}

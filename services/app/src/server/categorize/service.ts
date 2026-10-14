/**
 * Categorization beyond imports: suggesting categories for transactions already pending,
 * re-applying a changed rule, and settling proposals once their transactions are confirmed
 * (acceptance tracking, and feedback to providers that want it).
 *
 * A pending transaction is **open to categorizing** when it's simple (two postings) and the
 * user hasn't decided its category: its other side is uncategorized, or still exactly what was
 * proposed for it. Its first posting is its own side (where it came from), as imports and
 * schedules stage them.
 */
import type { Transaction } from "@fava-beans/ledger-client";

import type { FeedbackRequest, IncomingTransaction } from "../../shared/categorizer-api.js";
import type { CategoryRule } from "../../shared/rules.js";
import type { AppDb, StoredProposal } from "../db.js";
import { UNCATEGORIZED } from "../imports.js";
import type { LedgerPort } from "../ledger.js";
import { categorize, stagedPostings } from "./chain.js";
import { buildRequest } from "./context.js";
import { matches } from "./rules.js";
import type { Categorizer, Chosen } from "./types.js";

const FALLBACKS = new Set([UNCATEGORIZED.out, UNCATEGORIZED.in]);

/** The pending transaction as a categorizer sees it, if it's open to categorizing. */
function openToCategorizing(t: Transaction, proposal: StoredProposal | undefined) {
  if (t.postings.length !== 2) return undefined;
  const [own, other] = t.postings as [Transaction["postings"][0], Transaction["postings"][0]];
  if (!own.units) return undefined;
  const untouched =
    FALLBACKS.has(other.account) ||
    (proposal?.postings?.length === 1 && proposal.postings[0]!.account === other.account);
  if (!untouched) return undefined;
  const incoming: IncomingTransaction = {
    id: t.id,
    date: t.date,
    account: own.account,
    amount: own.units,
    description: t.narration || t.payee || "",
    payee: t.payee ?? null,
  };
  return incoming;
}

type Services = { db: AppDb; ledger: LedgerPort; book: { id: string; name: string } };

/** Write a decision to a pending transaction, and record the proposal. */
async function apply(
  { db, ledger, book }: Services,
  t: Transaction,
  incoming: IncomingTransaction,
  category: Chosen | undefined,
  payee: Chosen | undefined,
  requestId: string
) {
  if (!category && !payee) return false;
  const fallback = t.postings[1]!.account;
  await ledger.patch(
    book.id,
    t.id,
    {
      postings: stagedPostings(incoming.account, incoming.amount, category, fallback),
      ...(payee?.payee ? { payee: payee.payee } : {}),
      ...(category?.auto_confirm ? { flag: "*" } : {}),
    },
    t.updated_at
  );
  const { auto_confirm: _a, rule_id: _r, categorizer: _c, ...given } = category ?? ({} as Chosen);
  db.saveProposals([
    {
      transaction_id: t.id,
      book_id: book.id,
      request_id: requestId,
      incoming_id: incoming.id,
      categorizer: category?.categorizer ?? null,
      confidence: category?.confidence ?? null,
      reason: category?.reason ?? payee?.reason ?? null,
      postings: category?.postings ?? null,
      payee: payee?.payee ?? null,
      payee_categorizer: payee?.categorizer ?? null,
      proposal: category ? given : null,
    },
  ]);
  return true;
}

/** "Suggest categories": run the chain over the pending transactions open to categorizing
 * (those from `account` or its subaccounts, if given). Returns how many got a proposal. */
export async function suggestPending(
  services: Services & { categorizers: Categorizer[]; account?: string }
): Promise<number> {
  const { db, ledger, book, categorizers, account } = services;
  const pending = await ledger.pending(book.id);
  const inScope = (name: string) => !account || name === account || name.startsWith(`${account}:`);
  const open = pending.flatMap((t) => {
    const incoming = openToCategorizing(t, db.proposal(book.id, t.id));
    return incoming && inScope(incoming.account) ? [{ t, incoming }] : [];
  });
  if (!open.length || !categorizers.length) return 0;
  const request = await buildRequest(
    ledger,
    book,
    open.map((o) => o.incoming)
  );
  const decisions = await categorize(categorizers, request);
  const uses = new Map<string, number>();
  let n = 0;
  for (const { t, incoming } of open) {
    const { category, payee } = decisions.get(t.id) ?? {};
    if (await apply(services, t, incoming, category, payee, request.request_id)) n++;
    if (category?.rule_id) uses.set(category.rule_id, (uses.get(category.rule_id) ?? 0) + 1);
  }
  db.countRuleUses(uses);
  return n;
}

/** The pending transactions a rule covers that are open to categorizing (not already its). */
export async function coveredBy(services: Services, rule: CategoryRule) {
  const { db, ledger, book } = services;
  return (await ledger.pending(book.id)).flatMap((t) => {
    const incoming = openToCategorizing(t, db.proposal(book.id, t.id));
    if (!incoming || !matches(rule, incoming)) return [];
    if (t.postings[1]!.account === rule.account && (!rule.payee || t.payee === rule.payee))
      return [];
    return [{ t, incoming }];
  });
}

/** Re-apply a rule to the pending transactions it covers that the user hasn't touched. */
export async function applyRule(services: Services, rule: CategoryRule): Promise<number> {
  const covered = await coveredBy(services, rule);
  for (const { t, incoming } of covered) {
    const proposal: Chosen = {
      id: t.id,
      postings: [{ account: rule.account }],
      ...(rule.payee ? { payee: rule.payee } : {}),
      confidence: 1,
      reason: `Rule "${rule.name}"`,
      auto_confirm: rule.auto_confirm,
      rule_id: rule.id,
      categorizer: "rules",
    };
    await apply(services, t, incoming, proposal, rule.payee ? proposal : undefined, "rule");
  }
  services.db.countRuleUses(new Map([[rule.id, covered.length]]));
  return covered.length;
}

/**
 * Once a transaction with a proposal is confirmed, record whether the proposal was kept: its
 * postings (the other side) and its payee. Tell the categorizer if it wants to know.
 */
export async function settle(
  services: Services & { categorizers: Categorizer[]; transaction: string }
): Promise<StoredProposal | undefined> {
  const { db, ledger, book, categorizers, transaction } = services;
  const proposal = db.proposal(book.id, transaction);
  if (!proposal || proposal.accepted !== null) return proposal;
  const t = await ledger.transaction(book.id, transaction);
  if (t.flag !== "*") return proposal;
  const others = t.postings
    .slice(1)
    .map((p) => p.account)
    .sort();
  const proposed = (proposal.postings ?? []).map((p) => p.account).sort();
  const accepted = proposal.postings ? JSON.stringify(others) === JSON.stringify(proposed) : false;
  const payeeAccepted = proposal.payee === null ? null : t.payee === proposal.payee;
  db.settleProposal(transaction, accepted, payeeAccepted);

  const provider = categorizers.find((c) => c.name === proposal.categorizer);
  if (provider?.feedback && proposal.proposal) {
    const feedback: FeedbackRequest = {
      api_version: "1",
      book,
      outcomes: [
        {
          request_id: proposal.request_id,
          id: proposal.incoming_id,
          proposal: proposal.proposal as FeedbackRequest["outcomes"][0]["proposal"],
          final: {
            payee: t.payee ?? null,
            postings: t.postings
              .slice(1)
              .map((p) => ({ account: p.account, amount: p.units ?? null })),
          },
          accepted,
        },
      ],
    };
    await provider
      .feedback(feedback)
      .catch((error: unknown) =>
        console.warn(`categorizer ${provider.name}: feedback failed:`, error)
      );
  }
  return db.proposal(book.id, transaction);
}

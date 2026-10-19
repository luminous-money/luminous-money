/**
 * Categorization beyond imports: suggesting categories for transactions already unconfirmed,
 * re-applying a changed rule, and settling proposals once their transactions are confirmed
 * (acceptance tracking, and feedback to providers that want it).
 *
 * An unconfirmed transaction is **open to categorizing** when it has splits still to place:
 * flagged `!` (proposed, not chosen by the user: M16) or uncategorized. Its first posting is its
 * own side (where it came from), as imports, schedules and receipts stage them; transactions
 * with lots or prices aren't categorized.
 */
import type { Transaction } from "@fava-beans/ledger-client";

import type { FeedbackRequest } from "../../shared/categorizer-api.js";
import { isUncategorized } from "../../shared/accounts.js";
import { negate } from "../../shared/decimal.js";
import type { CategoryRule } from "../../shared/rules.js";
import type { AppDb, StoredProposal } from "../db.js";
import type { LedgerPort } from "../ledger.js";
import { categorize, placed, representative } from "./chain.js";
import { buildRequest } from "./context.js";
import { matches } from "./rules.js";
import type { Categorizer, Chosen, Decision, Incoming } from "./types.js";

/** The unconfirmed transaction as a categorizer sees it, if it's open to categorizing. */
export function openToCategorizing(t: Transaction): Incoming | undefined {
  const [own, ...rest] = t.postings;
  if (!own?.units || t.postings.some((p) => p.cost || p.price)) return undefined;
  const splits = rest.flatMap((p, i) => {
    if (p.flag !== "!" && !isUncategorized(p.account)) return [];
    // A bank row's other side has no amount of its own: it's the rest.
    const amount =
      p.units ?? (rest.length === 1 ? { ...own.units!, number: negate(own.units!.number) } : null);
    const memo = typeof p.meta?.["memo"] === "string" ? (p.meta["memo"] as string) : null;
    return amount ? [{ index: i + 1, amount, memo }] : [];
  });
  if (!splits.length) return undefined;
  return {
    id: t.id,
    date: t.date,
    account: own.account,
    amount: own.units,
    description: t.narration || t.payee || "",
    payee: t.payee ?? null,
    splits,
  };
}

type Services = { db: AppDb; ledger: LedgerPort; book: { id: string; name: string } };

/** What's stored of a decision for a transaction (review shows it; acceptance is measured
 * against it): the proposal standing for its category, and its payee's. */
export function proposalRecord(
  ids: { transaction: string; book: string; request: string; incoming: string },
  lead: Chosen | undefined,
  payee: Chosen | undefined
): Parameters<AppDb["saveProposals"]>[0][number] {
  const { auto_confirm: _a, rule_id: _r, categorizer: _c, ...given } = lead ?? ({} as Chosen);
  return {
    transaction_id: ids.transaction,
    book_id: ids.book,
    request_id: ids.request,
    incoming_id: ids.incoming,
    categorizer: lead?.categorizer ?? null,
    confidence: lead?.confidence ?? null,
    reason: lead?.reason ?? payee?.reason ?? null,
    postings: lead?.postings ?? null,
    payee: payee?.payee ?? null,
    payee_categorizer: payee?.categorizer ?? null,
    proposal: lead ? given : null,
  };
}

/** Receipts never confirm automatically, whatever a rule says: you land on them in review. */
const mayAutoConfirm = (t: Pick<Transaction, "meta">) => t.meta?.["source"] !== "receipt";

/** Write a decision to an unconfirmed transaction, and record the proposal. */
async function apply(
  { db, ledger, book }: Services,
  t: Transaction,
  incoming: Incoming,
  decision: Decision,
  requestId: string
) {
  const { payee } = decision;
  const postings = placed(t.postings, incoming, decision);
  const lead = representative(decision, postings, incoming);
  if (!lead && !payee) return false;
  await ledger.patch(
    book.id,
    t.id,
    {
      postings: postings as Transaction["postings"],
      ...(payee?.payee ? { payee: payee.payee } : {}),
      ...(lead?.auto_confirm && mayAutoConfirm(t) ? { flag: "*" } : {}),
    },
    t.updated_at
  );
  db.saveProposals([
    proposalRecord(
      { transaction: t.id, book: book.id, request: requestId, incoming: incoming.id },
      lead,
      payee
    ),
  ]);
  return true;
}

/** "Suggest categories": run the chain over the unconfirmed transactions open to categorizing
 * (those from `account` or its subaccounts, if given). Returns how many got a proposal. */
export async function suggestUnconfirmed(
  services: Services & { categorizers: Categorizer[]; account?: string }
): Promise<number> {
  const { db, ledger, book, categorizers, account } = services;
  const unconfirmed = await ledger.unconfirmed(book.id);
  const inScope = (name: string) => !account || name === account || name.startsWith(`${account}:`);
  const open = unconfirmed.flatMap((t) => {
    const incoming = openToCategorizing(t);
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
    const decision = decisions.get(t.id) ?? {};
    if (await apply(services, t, incoming, decision, request.request_id)) n++;
    const rule = decision.category?.rule_id;
    if (rule) uses.set(rule, (uses.get(rule) ?? 0) + 1);
  }
  db.countRuleUses(uses);
  return n;
}

/** A rule's proposal for a transaction. */
const ruleProposal = (rule: CategoryRule, t: Transaction): Chosen => ({
  id: t.id,
  postings: [{ account: rule.account }],
  ...(rule.payee ? { payee: rule.payee } : {}),
  confidence: 1,
  reason: `Rule "${rule.name}"`,
  auto_confirm: rule.auto_confirm,
  rule_id: rule.id,
  categorizer: "rules",
  ...(rule.part ? { part: rule.part } : {}),
});

/** The unconfirmed transactions a rule covers that are open to categorizing, and that it would
 * change. */
export async function coveredBy(services: Services, rule: CategoryRule) {
  const { ledger, book } = services;
  return (await ledger.unconfirmed(book.id)).flatMap((t) => {
    const incoming = openToCategorizing(t);
    if (!incoming || !matches(rule, incoming)) return [];
    const after = placed(t.postings, incoming, { category: ruleProposal(rule, t) });
    const unchanged =
      after.length === t.postings.length &&
      after.every((p, i) => p.account === t.postings[i]!.account) &&
      (!rule.payee || t.payee === rule.payee);
    return unchanged ? [] : [{ t, incoming }];
  });
}

/** Re-apply a rule to the unconfirmed transactions it covers that the user hasn't decided. */
export async function applyRule(services: Services, rule: CategoryRule): Promise<number> {
  const covered = await coveredBy(services, rule);
  for (const { t, incoming } of covered) {
    const proposal = ruleProposal(rule, t);
    await apply(
      services,
      t,
      incoming,
      { category: proposal, ...(rule.payee ? { payee: proposal } : {}) },
      "rule"
    );
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

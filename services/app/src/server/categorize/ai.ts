/**
 * The `ai` categorizer (M16): the book's AI, through the ai service, placing each split still to
 * place, with a fallback for the transaction, and (with the book's account creation on) the
 * accounts it would open. It sees the history that bears on the transactions asked about: the
 * confirmed ones from the same payees, the most recent first; and, with `imported` (a book
 * whose migration turned the reference on), the reference's entries for payees like the
 * batch's, worked out from the imported history and the book's own (migrate/reference.ts).
 * Receipts and Suggest categories call it; imports and bank feeds don't (yet).
 *
 * **Tags** (HSA tracking; Tags, more): it's offered the book's tags (its context's) and
 * `hsa-fsa-eligible`, which every book is, and its history carries each split's tags. Only tags
 * it was offered are kept from its answer; the ai service drops them all when the book's
 * "Suggest tags" is off.
 */
import type { AiCost, BookTag, CategorizeHistory } from "@luminous-money/ai-api";

import { buildReference, entriesFor, seenInBook, type Seen } from "../migrate/reference.js";

import { UNKNOWN } from "../../shared/accounts.js";
import { payeeKey } from "../../shared/payees.js";
import { HSA_FSA_ELIGIBLE } from "../../shared/tags.js";
import type { AiPort } from "../ai.js";
import type { Categorizer, InternalProposal, Request } from "./types.js";

/** The tags it's offered: the book's (its context's), and `hsa-fsa-eligible` whether the book has
 * it yet or not (Kael, 2026-11-19: the one exception to Tags, more's decision 7). */
export function offered(request: Request): BookTag[] {
  const tags = request.context.tags ?? [];
  const today = new Date().toISOString().slice(0, 10);
  return tags.some((t) => t.name === HSA_FSA_ELIGIBLE)
    ? tags
    : [...tags, { name: HSA_FSA_ELIGIBLE, count: 0, first: today, last: today }];
}

/** At most this much history goes with a request. */
const HISTORY = 60;
/** Transactions per request: a big selection is asked about in batches, so each call stays well
 * inside app's time limit for the ai service (and Claude's for an answer). */
export const BATCH = 20;

/**
 * `opens`: whether the book lets it open accounts (its answer's others are dropped if not).
 * `onFailure` hears why it couldn't answer (no credit, say), for the person to be told; what
 * earlier batches proposed still counts. `onCost` hears what each batch cost, answered or not.
 */
export function aiCategorizer(
  ai: AiPort,
  book: string,
  {
    currency,
    opens,
    onFailure,
    onCost,
    imported,
  }: {
    currency: string;
    opens: boolean;
    onFailure?: (reason: string) => void;
    onCost?: (cost: AiCost) => void;
    imported?: Seen[];
  }
): Categorizer {
  /** The reference, for a request: none without imported history. */
  const referenceOf = (request: Request) => {
    if (!imported) return null;
    const accounts = request.context.accounts;
    const sides = new Set(
      accounts.filter((a) => a.type === "asset" || a.type === "liability").map((a) => a.name)
    );
    const leaves = new Set(
      accounts.filter((a) => a.kind === "leaf" && !a.close && a.name !== UNKNOWN).map((a) => a.name)
    );
    return buildReference([...imported, ...seenInBook(request.context.history)], {
      today: new Date().toISOString().slice(0, 10),
      balanceSheet: (a) => sides.has(a) || /^(Assets|Liabilities):/.test(a),
      usable: (a) => leaves.has(a),
    });
  };

  /** One batch's request to the ai service. */
  const ask = (
    request: Request,
    transactions: Request["transactions"],
    reference: ReturnType<typeof referenceOf>
  ) => {
    const payees = new Set(transactions.map((t) => payeeKey(t.payee || t.description)));
    const history: CategorizeHistory[] = request.context.history
      .filter((t) => t.flag === "*" && payees.has(payeeKey(t.payee || t.narration || "")))
      .slice(-HISTORY)
      .map((t) => ({
        date: t.date,
        payee: t.payee,
        narration: t.narration,
        postings: t.postings.map((p) => ({
          account: p.account,
          amount: p.amount?.number ?? null,
          memo: p.memo ?? null,
          ...(p.tags?.length ? { tags: p.tags } : {}),
        })),
      }));
    return ai.categorize(book, {
      transactions: transactions.map((t) => ({
        id: t.id,
        date: t.date,
        payee: t.payee,
        narration: t.description || null,
        known: [{ account: t.account, amount: t.amount.number }],
        splits: t.splits.map((s) => ({
          index: s.index,
          amount: s.amount.number,
          memo: [s.memo, s.description].filter(Boolean).join(": ") || null,
        })),
      })),
      accounts: request.context.accounts
        .filter((a) => a.kind === "leaf" && !a.close && a.name !== UNKNOWN)
        .map((a) => ({
          name: a.name,
          type: a.type,
          display_name: a.display_name ?? null,
          description: a.description ?? null,
        })),
      history,
      ...(reference
        ? {
            reference: entriesFor(
              reference,
              transactions.flatMap((t) => [t.description, t.payee ?? ""])
            ).map(({ key: _k, weight: _w, ...entry }) => entry),
          }
        : {}),
      tags: offered(request),
      currency,
    });
  };

  return {
    name: "ai",
    async categorize(request: Request) {
      const proposals: InternalProposal[] = [];
      const reference = referenceOf(request);
      const names = new Set(offered(request).map((t) => t.name));
      const only = (tags?: string[]) => {
        const kept = (tags ?? []).filter((tag) => names.has(tag));
        return kept.length ? { tags: kept } : {};
      };
      for (let i = 0; i < request.transactions.length; i += BATCH) {
        const answer = await ask(request, request.transactions.slice(i, i + BATCH), reference);
        const cost = "ok" in answer ? answer.ok.cost : answer.cost;
        if (cost) onCost?.(cost);
        if ("failed" in answer) {
          console.warn(`categorizer ai: ${answer.failed}`);
          onFailure?.(answer.failed);
          break;
        }
        const proposed = new Set(answer.ok.new_accounts);
        const allowed = (account: string) => opens || !proposed.has(account);
        for (const p of answer.ok.proposals) {
          const splits = p.splits
            .filter((s) => allowed(s.account))
            .map(({ tags, ...s }) => ({ ...s, ...only(tags) }));
          const fallback = p.fallback && allowed(p.fallback) ? p.fallback : null;
          const used = [...splits.map((s) => s.account), ...(fallback ? [fallback] : [])];
          const opening = [...proposed].filter((name) => opens && used.includes(name));
          proposals.push({
            id: p.id,
            ...(splits.length ? { splits } : {}),
            ...(fallback ? { postings: [{ account: fallback }] } : {}),
            ...(opening.length ? { opens: opening } : {}),
            ...only(p.tags),
            confidence: p.confidence,
            reason: p.reason,
          });
        }
      }
      return { proposals };
    },
  };
}

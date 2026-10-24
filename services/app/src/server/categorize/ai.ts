/**
 * The `ai` categorizer (M16): the book's AI, through the ai service, placing each split still to
 * place, with a fallback for the transaction, and (with the book's account creation on) the
 * accounts it would open. It sees the history that bears on the transactions asked about: the
 * confirmed ones from the same payees, the most recent first. For receipts, for now; whether
 * imports call it is M19's to decide.
 */
import type { CategorizeHistory } from "@luminous-money/ai-api";

import { UNKNOWN } from "../../shared/accounts.js";
import { payeeKey } from "../../shared/payees.js";
import type { AiPort } from "../ai.js";
import type { Categorizer, InternalProposal, Request } from "./types.js";

/** At most this much history goes with a request. */
const HISTORY = 60;
/** Transactions per request: a big selection is asked about in batches, so each call stays well
 * inside app's time limit for the ai service (and Claude's for an answer). */
export const BATCH = 20;

/**
 * `opens`: whether the book lets it open accounts (its answer's others are dropped if not).
 * `onFailure` hears why it couldn't answer (no credit, say), for the person to be told; what
 * earlier batches proposed still counts.
 */
export function aiCategorizer(
  ai: AiPort,
  book: string,
  currency: string,
  opens: boolean,
  onFailure?: (reason: string) => void
): Categorizer {
  /** One batch's request to the ai service. */
  const ask = (request: Request, transactions: Request["transactions"]) => {
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
        .map((a) => ({ name: a.name, type: a.type, display_name: null })),
      history,
      currency,
    });
  };

  return {
    name: "ai",
    async categorize(request: Request) {
      const proposals: InternalProposal[] = [];
      for (let i = 0; i < request.transactions.length; i += BATCH) {
        const answer = await ask(request, request.transactions.slice(i, i + BATCH));
        if ("failed" in answer) {
          console.warn(`categorizer ai: ${answer.failed}`);
          onFailure?.(answer.failed);
          break;
        }
        const proposed = new Set(answer.ok.new_accounts);
        const allowed = (account: string) => opens || !proposed.has(account);
        for (const p of answer.ok.proposals) {
          const splits = p.splits.filter((s) => allowed(s.account));
          const fallback = p.fallback && allowed(p.fallback) ? p.fallback : null;
          const used = [...splits.map((s) => s.account), ...(fallback ? [fallback] : [])];
          const opening = [...proposed].filter((name) => opens && used.includes(name));
          proposals.push({
            id: p.id,
            ...(splits.length ? { splits } : {}),
            ...(fallback ? { postings: [{ account: fallback }] } : {}),
            ...(opening.length ? { opens: opening } : {}),
            confidence: p.confidence,
            reason: p.reason,
          });
        }
      }
      return { proposals };
    },
  };
}

/**
 * The `ai` categorizer (M16): the book's AI, through the ai service, placing each split still to
 * place, with a fallback for the transaction, and (with the book's account creation on) the
 * accounts it would open. It sees the history that bears on the transactions asked about: the
 * confirmed ones from the same payees, the most recent first. For receipts, for now; whether
 * imports call it is M19's to decide.
 */
import type { CategorizeHistory } from "@fava-beans/ai-api";

import { UNKNOWN } from "../../shared/accounts.js";
import { payeeKey } from "../../shared/payees.js";
import type { AiPort } from "../ai.js";
import type { Categorizer, InternalProposal, Request } from "./types.js";

/** At most this much history goes with a request. */
const HISTORY = 60;

/** `opens`: whether the book lets it open accounts (its answer's others are dropped if not). */
export function aiCategorizer(
  ai: AiPort,
  book: string,
  currency: string,
  opens: boolean
): Categorizer {
  return {
    name: "ai",
    async categorize(request: Request) {
      const payees = new Set(request.transactions.map((t) => payeeKey(t.payee || t.description)));
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
      const answer = await ai.categorize(book, {
        transactions: request.transactions.map((t) => ({
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
      if ("failed" in answer) throw new Error(answer.failed);
      const proposed = new Set(answer.ok.new_accounts);
      const allowed = (account: string) => opens || !proposed.has(account);
      const proposals: InternalProposal[] = answer.ok.proposals.map((p) => {
        const splits = p.splits.filter((s) => allowed(s.account));
        const fallback = p.fallback && allowed(p.fallback) ? p.fallback : null;
        const used = [...splits.map((s) => s.account), ...(fallback ? [fallback] : [])];
        const opening = [...proposed].filter((name) => opens && used.includes(name));
        return {
          id: p.id,
          ...(splits.length ? { splits } : {}),
          ...(fallback ? { postings: [{ account: fallback }] } : {}),
          ...(opening.length ? { opens: opening } : {}),
          confidence: p.confidence,
          reason: p.reason,
        };
      });
      return { proposals };
    },
  };
}

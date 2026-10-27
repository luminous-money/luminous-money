/**
 * The `ai` categorizer (M16): the book's AI, through the ai service, placing each split still to
 * place, with a fallback for the transaction, and (with the book's account creation on) the
 * accounts it would open. It sees the history that bears on the transactions asked about: the
 * confirmed ones from the same payees, the most recent first; and, with `imported` (a book
 * whose migration turned the reference on), the reference's entries for payees like the
 * batch's, worked out from the imported history and the book's own (migrate/reference.ts).
 * Receipts and Suggest categories call it; imports and bank feeds don't (yet).
 */
import type { AiCost, CategorizeHistory } from "@luminous-money/ai-api";

import { buildReference, entriesFor, seenInBook, type Seen } from "../migrate/reference.js";

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
      currency,
    });
  };

  return {
    name: "ai",
    async categorize(request: Request) {
      const proposals: InternalProposal[] = [];
      const reference = referenceOf(request);
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

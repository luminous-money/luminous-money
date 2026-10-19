/**
 * The `items` categorizer (M16): what the same item was categorized as before, for a receipt's
 * splits. A split with a memo (its line, "EGGS HPPY 18") takes the account the same item's
 * confirmed splits used most: at the same payee first, else at any, for less. No setup.
 *
 * - **Confidence:** as history's, the winning share discounted for little history
 *   (`share × n / (n + 1)`), and by a fifth at another payee.
 * - One proposal per split, since each has its own confidence.
 */
import { payeeKey } from "../../shared/payees.js";
import type { Categorizer, InternalProposal, Request } from "./types.js";

/** Accounts staging falls back to, and the balance sheet: never learned as an item's account. */
const UNLEARNED = /^(Assets|Liabilities|Equity):|^(Expenses|Income):Uncategorized$/;

/** An item's key: its words, lowercased, whatever the punctuation and spacing. */
export const itemKey = (memo: string) =>
  memo
    .toLowerCase()
    .replace(/[^\p{L}\p{Nd}]+/gu, " ")
    .trim();

type Past = { item: string; payee: string; account: string; date: string };

function learned(history: Request["context"]["history"]): Past[] {
  return history.flatMap((t) =>
    t.flag !== "*"
      ? []
      : t.postings.flatMap((p) =>
          p.memo && !UNLEARNED.test(p.account)
            ? [
                {
                  item: itemKey(p.memo),
                  payee: payeeKey(t.payee || t.narration || ""),
                  account: p.account,
                  date: t.date,
                },
              ]
            : []
        )
  );
}

export const items: Categorizer = {
  name: "items",
  async categorize(request: Request) {
    const past = learned(request.context.history);
    if (!past.length) return { proposals: [] };
    const proposals: InternalProposal[] = request.transactions.flatMap((t) => {
      const payee = payeeKey(t.payee || t.description);
      return t.splits.flatMap((s) => {
        const item = s.memo ? itemKey(s.memo) : "";
        if (!item) return [];
        const same = past.filter((p) => p.item === item);
        const here = same.filter((p) => p.payee === payee);
        const [found, factor] = here.length ? [here, 1] : [same, 0.8];
        if (!found.length) return [];
        const votes = new Map<string, { n: number; last: string }>();
        for (const p of found) {
          const v = votes.get(p.account) ?? { n: 0, last: "" };
          votes.set(p.account, { n: v.n + 1, last: p.date > v.last ? p.date : v.last });
        }
        const [account, { n }] = [...votes].sort(
          ([, a], [, b]) => b.n - a.n || b.last.localeCompare(a.last)
        )[0]!;
        const total = found.length;
        return [
          {
            id: t.id,
            splits: [{ index: s.index, account }],
            confidence: Number(((n / total) * (total / (total + 1)) * factor).toFixed(3)),
            reason: `${n} of ${total} past "${s.memo}" → ${account}`,
          },
        ];
      });
    });
    return { proposals };
  },
};

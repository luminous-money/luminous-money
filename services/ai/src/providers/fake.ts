/**
 * The fake provider (test stacks only): answers without a model, so everything around reading
 * and categorizing can be exercised end to end.
 *
 * - **Extract:** "Fake Store", today, 12.34 charged to the Visa ending 4242, in two lines that
 *   add up to it.
 * - **Categorize:** every split to the chart's first expense account that isn't uncategorized
 *   (with account creation on, the first split to `Expenses:Fake-Store`, proposed to open), and
 *   that account as the fallback.
 */
import type { CategorizeOut, ExtractIn, ReceiptFacts } from "@luminous-money/ai-api";

import type { CategorizeInput, Provider } from "./types.js";

export const FAKE_CARD = { brand: "visa", last_four: "4242" } as const;

export const fake: Provider = {
  name: "fake",
  async extract(input: ExtractIn): Promise<ReceiptFacts> {
    return {
      payee: "Fake Store",
      date: input.today,
      currency: null,
      total: "12.34",
      total_evidence: "TOTAL 12.34",
      refund: false,
      payment: { method: "card", ...FAKE_CARD },
      lines: [
        { text: "FIRST ITEM", description: "First item", amount: "6.17" },
        { text: "SECOND ITEM", description: "Second item", amount: "6.17" },
      ],
      difference: null,
      note: "Read by the fake provider",
    };
  },
  async categorize(input: CategorizeInput): Promise<CategorizeOut> {
    const category =
      input.accounts.find((a) => a.type === "expense" && !a.name.endsWith(":Uncategorized"))
        ?.name ?? null;
    const created = input.creation ? "Expenses:Fake-Store" : null;
    return {
      proposals: input.transactions.map((t) => ({
        id: t.id,
        splits: t.splits.flatMap((s, i) => {
          const account = i === 0 && created ? created : category;
          return account ? [{ index: s.index, account }] : [];
        }),
        fallback: category,
        confidence: 0.8,
        reason: "The fake provider's guess",
      })),
      new_accounts: created ? [created] : [],
    };
  },
};

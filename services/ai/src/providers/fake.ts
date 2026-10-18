/**
 * The fake provider (test stacks only): answers without a model, from the hints and the chart,
 * so everything around reading a receipt can be exercised end to end. Its total is the hint's,
 * else 12.34 spent; itemized, it splits the total in two.
 */
import type { ReceiptReading } from "@fava-beans/ai-api";

import type { Provider, ReadInput } from "./types.js";

const cents = (decimal: string) => Math.round(Number(decimal) * 100);
const decimal = (c: number) =>
  `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

export const fake: Provider = {
  name: "fake",
  async read(input: ReadInput): Promise<ReceiptReading> {
    const of = (type: string) => input.accounts.filter((a) => a.type === type).map((a) => a.name);
    const account = input.hints.account ?? of("liability")[0] ?? of("asset")[0] ?? null;
    const total = input.hints.total ?? "-12.34";
    const spent = -cents(total);
    const category = of("expense").find((n) => !n.endsWith(":Uncategorized")) ?? null;
    const created = input.creation ? "Expenses:Fake-Store" : null;
    const first = created ?? category ?? "Expenses:Uncategorized";
    const half = Math.trunc(spent / 2);
    const splits = input.itemize
      ? [
          { account: first, amount: decimal(half), memo: "First item" },
          { account: category ?? first, amount: decimal(spent - half), memo: "Second item" },
        ]
      : [{ account: first, amount: decimal(spent), memo: null }];
    return {
      account,
      total,
      currency: input.currency,
      date: input.hints.date ?? input.today,
      payee: input.hints.payee ?? "Fake Store",
      narration: input.hints.note ?? `Receipt: ${input.file.filename ?? "receipt"}`,
      category,
      splits,
      new_accounts: created ? [created] : [],
      note: "Read by the fake provider",
    };
  },
};

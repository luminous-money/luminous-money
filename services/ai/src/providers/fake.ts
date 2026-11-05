/**
 * The fake provider (test stacks only): answers without a model, so everything around reading
 * and categorizing can be exercised end to end.
 *
 * - **Extract:** "Fake Store", today, 12.34 charged to the Visa ending 4242, in two lines that
 *   add up to it.
 * - **Categorize:** every split to the chart's first expense account that isn't uncategorized
 *   (with account creation on, the first split to `Expenses:Fake-Store`, proposed to open), and
 *   that account as the fallback. A transaction whose payee or narration contains a reference
 *   entry's payee (ignoring case) goes to that entry's most usual account instead, with "From
 *   the reference" as its reason.
 * - **A loan's table:** twelve payments of a made-up $12,000 loan at 6%, first due on the 1st
 *   of next January, with $100.00 of escrow each.
 * - **Cost:** each operation is one made-up call, `FAKE_CALL` ($0.0042), so costs can be shown
 *   and summed in tests.
 */
import type {
  CategorizeOut,
  ExtractIn,
  LoanTableFacts,
  ReceiptFacts,
} from "@luminous-money/ai-api";

import type { CategorizeInput, Meter, Provider } from "./types.js";

export const FAKE_CARD = { brand: "visa", last_four: "4242" } as const;

export const FAKE_CALL = {
  model: "fake",
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  usd: 0.0042,
};

export const fake: Provider = {
  name: "fake",
  async extract(
    input: ExtractIn,
    _credential: string | null,
    meter?: Meter
  ): Promise<ReceiptFacts> {
    meter?.(FAKE_CALL);
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
  async categorize(
    input: CategorizeInput,
    _credential: string | null,
    meter?: Meter
  ): Promise<CategorizeOut> {
    meter?.(FAKE_CALL);
    const category =
      input.accounts.find((a) => a.type === "expense" && !a.name.endsWith(":Uncategorized"))
        ?.name ?? null;
    const created = input.creation ? "Expenses:Fake-Store" : null;
    const leaves = new Set(input.accounts.map((a) => a.name));
    const referenced = (text: string) =>
      input.reference?.find(
        (r) =>
          r.accounts[0] &&
          leaves.has(r.accounts[0].account) &&
          text.toLowerCase().includes(r.payee.toLowerCase())
      )?.accounts[0]!.account;
    return {
      proposals: input.transactions.map((t) => {
        const known = referenced(`${t.payee ?? ""} ${t.narration ?? ""}`);
        if (known)
          return {
            id: t.id,
            splits: t.splits.map((s) => ({ index: s.index, account: known })),
            fallback: known,
            confidence: 0.85,
            reason: "From the reference",
          };
        return {
          id: t.id,
          splits: t.splits.flatMap((s, i) => {
            const account = i === 0 && created ? created : category;
            return account ? [{ index: s.index, account }] : [];
          }),
          fallback: category,
          confidence: 0.8,
          reason: "The fake provider's guess",
        };
      }),
      new_accounts: created ? [created] : [],
    };
  },
  async loanTable(_input, _credential, meter?: Meter): Promise<LoanTableFacts> {
    meter?.(FAKE_CALL);
    const year = new Date().getUTCFullYear() + 1;
    const rows: LoanTableFacts["rows"] = [];
    let owed = 1200000; // cents
    const payment = 103279; // $12,000 at 6% over 12 months
    for (let n = 1; n <= 12; n++) {
      const interest = Math.round(owed * 0.005);
      const principal = n === 12 ? owed : payment - interest;
      owed -= principal;
      const money = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
      rows.push({
        number: n,
        date: `${year}-${String(n).padStart(2, "0")}-01`,
        principal: money(principal),
        interest: money(interest),
        escrow: "100.00",
        balance: money(owed),
      });
    }
    return {
      lender: "Fake Lender",
      amount: "12000.00",
      rate: "6",
      payments: 12,
      first: `${year}-01-01`,
      rows,
      note: "Read by the fake provider",
    };
  },
};

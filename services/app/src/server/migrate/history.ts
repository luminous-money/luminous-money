/**
 * Another system's imported history, as the categorizers read it: the history categorizer as
 * past transactions (confirmed: the person's own choices there), the reference as what it saw.
 */
import type { History } from "../categorize/types.js";
import type { OldTransaction } from "./gnucash.js";
import type { Seen } from "./reference.js";

export const historyFrom = (old: OldTransaction[]): History =>
  old.map((t, i) => ({
    id: t.source_id ?? `imported-${i}`,
    date: t.date,
    flag: "*",
    payee: null,
    narration: t.description,
    postings: t.postings.map((p) => ({
      account: p.account,
      amount: { number: p.amount, currency: p.currency },
      memo: p.memo,
    })),
  }));

export const seenFrom = (old: OldTransaction[]): Seen[] =>
  old.map((t) => ({
    date: t.date,
    description: t.description,
    postings: t.postings.map((p) => ({ account: p.account, amount: p.amount })),
  }));

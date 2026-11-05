/**
 * Reading a lender's amortization schedule (a PDF or an image) with the book's AI: what it
 * transcribes becomes a table's rows, checked by the PWA before it's saved (rowProblems), as a
 * CSV's are.
 */
import type { LoanTableOut } from "@luminous-money/ai-api";

import { cents, money, type LoanRead, type LoanRow } from "../shared/loans.js";
import type { AiPort } from "./ai.js";
import { normalized, type FileIn } from "./images.js";
import { LoanProblem } from "./loans.js";

/** A month after `date`, on the same day (clamped to a short month's end). */
function monthAfter(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/** The schedule's rows as a table's: numbered and dated in order where it didn't say. */
export function tableRows(read: Pick<LoanTableOut, "rows" | "first">): LoanRow[] {
  let date = read.first;
  return read.rows.map((r, i) => {
    date = r.date ?? (i && date ? monthAfter(date) : date);
    return {
      number: r.number ?? i + 1,
      date: date ?? "",
      principal: money(cents(r.principal)),
      interest: money(cents(r.interest)),
      balance: money(cents(r.balance)),
    };
  });
}

/** The most usual escrow in the rows, if they show any. */
function usualEscrow(rows: LoanTableOut["rows"]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows)
    if (r.escrow && cents(r.escrow) > 0n) {
      const amount = money(cents(r.escrow));
      counts.set(amount, (counts.get(amount) ?? 0) + 1);
    }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function readLoanTable({
  ai,
  book,
  file,
  currency,
}: {
  ai: AiPort | undefined;
  book: string;
  file: FileIn;
  currency: string;
}): Promise<LoanRead> {
  const settings = ai ? await ai.settings(book) : null;
  if (!ai || !settings) throw new LoanProblem(422, "AI isn't available right now");
  if (!settings.ready) throw new LoanProblem(422, "The book's AI isn't set up (Menu → AI)");
  const kept = await normalized(file);
  const answer = await ai.loanTable(book, {
    file: {
      data: Buffer.from(kept.bytes).toString("base64"),
      media_type: kept.type,
      filename: kept.name,
    },
    currency,
  });
  if ("failed" in answer) throw new LoanProblem(422, `It couldn't be read: ${answer.failed}`);
  const read = answer.ok;
  return {
    rows: tableRows(read),
    lender: read.lender,
    terms: { amount: read.amount, rate: read.rate, payments: read.payments, first: read.first },
    escrow: usualEscrow(read.rows),
    note: read.note,
    ai_cost: read.cost?.usd ?? null,
  };
}

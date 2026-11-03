/**
 * Funds (Funds A) where the server writes them: a rule's fund on what it categorizes. A rule names
 * a fund; the transaction gets a line for all of it, the way it goes (from the fund for money out,
 * to it for money in, for it on a transfer). A fund that's archived or gone is left off rather
 * than failing the import.
 */
import type { LedgerPort } from "./ledger.js";
import type { Decision } from "./categorize/types.js";
import { shapeOf, wholeLine, type FundLine } from "../shared/funds.js";

/** The funds a staged transaction may name (the active ones), and the book's currency. */
export type FundChoices = { active: Set<string>; currency: string };

/** What funds can be named, if any of `named` is one (decisions' funds): read once per batch. */
export async function fundChoices(
  ledger: LedgerPort,
  book: string,
  named: (string | null | undefined)[]
): Promise<FundChoices | undefined> {
  if (!named.some(Boolean)) return undefined;
  const listing = await ledger.funds(book);
  return {
    active: new Set(listing.funds.filter((f) => !f.archived).map((f) => f.name)),
    currency: listing.currency,
  };
}

type PostingLike = Parameters<typeof shapeOf>[0][number];

/** A decision's fund as the transaction's line, when the fund is active and the transaction's
 * shape can be read. */
export function decidedLines(
  decision: Decision,
  postings: PostingLike[],
  choices: FundChoices | undefined
): FundLine[] | undefined {
  const fund = decision.category?.fund;
  if (!fund || !choices?.active.has(fund)) return undefined;
  const line = wholeLine(shapeOf(postings, choices.currency), fund);
  return line ? [line] : undefined;
}
